/**
 * Ease-curve UI for the `structural.ease` param (§13.9). Replaces the bare
 * <select> — which showed only a name like `power2.out` that nobody remembers —
 * with a drawn curve on the node plus a picker. The plot is sampled with the
 * compiler's `sampleEase`, so it shows exactly what the shader runs.
 *
 * The custom editor is a multi-keyframe point editor built on the conventions
 * artists already have from Unity, Blender and After Effects, because none of
 * the off-the-shelf web curve editors do multi-point *and* tangent handles
 * under a permissive licence (they are either a single cubic-bezier or a whole
 * AGPL studio). The load-bearing UX decisions:
 *
 *   • Hovering the pad shows a ghost point riding the curve at the cursor's x.
 *     The ghost is drawn exactly where a click would insert, and only while a
 *     click *would* insert — the affordance and the hit test are the same
 *     thing, so "click the curve to add a point" needs no explaining.
 *   • Every point's handles are visible at rest, faint, and all of them are
 *     grabbable. An editor whose controls only appear after you select
 *     something looks inert.
 *   • Presets collapse out of the way once a custom curve exists, instead of
 *     taking two thirds of the panel.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CurveModal } from './CurveModal';
import {
  CURVE_MAX_KEYS,
  curveFromEase,
  EASE_KEYS,
  formatCurve,
  isCustomEase,
  moveCurveHandle,
  moveCurveKey,
  normalizeCurve,
  parseCurve,
  removeCurveKey,
  sampleCurve,
  sampleEase,
  splitCurveAt,
  type CurveKey,
} from '@pylinka/compiler';

const ACCENT = '#a78bfa';
// vertical view range — headroom so overshooting curves (back.out, anticipating
// beziers) stay visible instead of clipping at the unit box.
const V_MIN = -0.35;
const V_MAX = 1.35;
/** How far from the curve a click still counts as "insert here", in pixels. */
const INSERT_BAND = 26;
/** Shift-drag snaps to this grid. */
const SNAP = 0.05;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/** Short human label for an ease key. */
export function easeLabel(key: string): string {
  const keys = parseCurve(key);
  if (keys) return `custom · ${keys.length} pts`;
  return isCustomEase(key) ? 'custom' : key;
}

// map curve space (t∈[0,1], v∈[V_MIN,V_MAX]) → svg pixels within a padded box
function makeMap(w: number, h: number, pad: number) {
  const iw = w - 2 * pad;
  const ih = h - 2 * pad;
  return {
    x: (t: number) => pad + t * iw,
    y: (v: number) => pad + (1 - (v - V_MIN) / (V_MAX - V_MIN)) * ih,
    invX: (px: number) => clamp((px - pad) / iw, 0, 1),
    invY: (py: number) => V_MIN + (1 - (py - pad) / ih) * (V_MAX - V_MIN),
  };
}

/** Pure SVG plot of an ease curve. Reused on the node and in picker thumbnails. */
export function CurvePlot({
  easeKey,
  w,
  h,
  stroke = ACCENT,
  faint = false,
}: {
  easeKey: string;
  w: number;
  h: number;
  stroke?: string;
  faint?: boolean;
}) {
  const pad = Math.max(4, Math.round(Math.min(w, h) * 0.12));
  const m = makeMap(w, h, pad);
  const N = 44;
  let d = '';
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    d += `${i === 0 ? 'M' : 'L'}${m.x(t).toFixed(1)},${m.y(sampleEase(easeKey, t)).toFixed(1)} `;
  }
  const gridColor = 'color-mix(in oklab, var(--color-muted-foreground) 22%, transparent)';
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      {/* unit box guide (0,0)→(1,1) */}
      <rect
        x={m.x(0)}
        y={m.y(1)}
        width={m.x(1) - m.x(0)}
        height={m.y(0) - m.y(1)}
        fill="none"
        stroke={gridColor}
        strokeDasharray="2 2"
      />
      <line x1={m.x(0)} y1={m.y(0)} x2={m.x(1)} y2={m.y(0)} stroke={gridColor} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={faint ? 1.25 : 1.75} strokeLinejoin="round" />
    </svg>
  );
}

// ───────────────────────────── the point editor ────────────────────────────

type Drag = { kind: 'key' | 'in' | 'out'; index: number };

const W = 384;
const H = 292;
const PAD = 26;

export function CurveEditor({
  seed,
  onCommit,
  onPreview,
  width = W,
  height = H,
}: {
  seed: string;
  /** Structural write — recompiles, so this fires on pointer-up only. */
  onCommit(key: string): void;
  /** Every intermediate value, for a live preview that can take them cheaply. */
  onPreview?: (key: string) => void;
  width?: number;
  height?: number;
}) {
  const [keys, setKeys] = useState<CurveKey[]>(() => curveFromEase(seed));
  const [sel, setSel] = useState<number | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);

  // What we last pushed outwards. This is the only reseed path: an ease that
  // came from somewhere else (a preset click, the raw text field) refits the
  // points, while our own commits are recognised and left alone. Remounting on
  // the value instead would also fire the first time a commit turns a preset
  // into a curve — dropping the selection the artist had just made.
  const mine = useRef<string>(formatCurve(curveFromEase(seed)));
  useEffect(() => {
    if (seed === mine.current) return;
    mine.current = seed;
    setKeys(curveFromEase(seed));
    setSel(null);
  }, [seed]);

  const svgRef = useRef<SVGSVGElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const m = makeMap(width, height, PAD);

  // Push every in-progress shape outwards. Held in a ref so a caller passing an
  // inline arrow does not re-fire the effect on each render.
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  useEffect(() => {
    previewRef.current?.(formatCurve(keys));
  }, [keys]);

  const commit = (next: CurveKey[]) => {
    const key = formatCurve(next);
    mine.current = key;
    onCommit(key);
  };

  const at = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const snap = (n: number) => (e.shiftKey ? Math.round(n / SNAP) * SNAP : n);
    return { px, py, x: snap(m.invX(px)), y: snap(clamp(m.invY(py), V_MIN, V_MAX)) };
  };

  const full = keys.length >= CURVE_MAX_KEYS;

  /** Where a click would insert, or null when it would not. Drives both the
   *  ghost marker and the click itself, so they can never disagree. */
  const insertPoint = (px: number, py: number): { x: number; y: number } | null => {
    if (full) return null;
    const x = m.invX(px);
    if (x <= 0.001 || x >= 0.999) return null;
    if (keys.some((k) => Math.abs(k.x - x) < 0.02)) return null;
    const y = sampleCurve(keys, x);
    if (Math.abs(m.y(y) - py) > INSERT_BAND) return null;
    return { x, y };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const { px, py, x, y } = at(e);
    if (!d) {
      setGhost(insertPoint(px, py));
      return;
    }
    // The shaping rules (endpoint pinning, neighbour clamping, handle
    // mirroring) live with the curve model, where they are unit-tested, rather
    // than inside a pointer handler where they are not.
    setKeys((prev) =>
      d.kind === 'key'
        ? moveCurveKey(prev, d.index, x, y)
        : moveCurveHandle(prev, d.index, d.kind, x, y, { broken: e.altKey }),
    );
  };

  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    (e.currentTarget as unknown as HTMLElement).releasePointerCapture?.(e.pointerId);
    drag.current = null;
    commit(keys);
  };

  const startDrag = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation();
    drag.current = d;
    setSel(d.index);
    setGhost(null);
    // Focus explicitly rather than relying on click-to-focus: the pad lives in
    // a portal over the node canvas and the default is eaten upstream. Without
    // this the Delete shortcut silently does nothing.
    padRef.current?.focus();
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  /** Click in the insert band → a new keyframe on the curve, already selected
   *  so its handles are right there to drag. */
  const onPadDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    padRef.current?.focus();
    const { px, py } = at(e);
    const spot = insertPoint(px, py);
    if (!spot) {
      setSel(null);
      return;
    }
    const next = splitCurveAt(keys, spot.x);
    if (next === keys) return;
    let nearest = 0;
    for (let i = 1; i < next.length; i++) {
      if (Math.abs(next[i]!.x - spot.x) < Math.abs(next[nearest]!.x - spot.x)) nearest = i;
    }
    setKeys(next);
    setSel(nearest);
    setGhost(null);
    commit(next);
  };

  const removeAt = (index: number) => {
    const next = removeCurveKey(keys, index);
    if (next === keys) return;
    setKeys(next);
    setSel(null);
    commit(next);
  };

  /** Edit the selected point through the numeric fields. */
  const setField = (which: 'x' | 'y', raw: number) => {
    if (sel === null || !Number.isFinite(raw)) return;
    const next = keys.map((k) => ({ ...k }));
    const k = next[sel]!;
    if (which === 'x') {
      if (sel === 0 || sel === next.length - 1) return; // endpoints own their x
      k.x = clamp(raw, next[sel - 1]!.x + 1e-3, next[sel + 1]!.x - 1e-3);
    } else k.y = raw;
    const norm = normalizeCurve(next);
    setKeys(norm);
    commit(norm);
  };

  const selKey = sel !== null ? keys[sel] : undefined;
  const isEnd = sel === 0 || sel === keys.length - 1;

  return (
    <div
      ref={padRef}
      tabIndex={0}
      className="outline-none"
      onKeyDown={(e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && sel !== null) {
          e.preventDefault();
          removeAt(sel);
        }
        if (e.key === 'Escape' && sel !== null) {
          e.preventDefault();
          e.stopPropagation(); // don't let the popover close out from under us
          setSel(null);
        }
      }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{
          display: 'block',
          touchAction: 'none',
          cursor: ghost ? 'copy' : 'default',
          borderRadius: 6,
          background: 'color-mix(in oklab, var(--color-muted) 24%, transparent)',
        }}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerLeave={() => setGhost(null)}
        onPointerDown={onPadDown}>
        <Grid m={m} />
        <path d={curvePath(keys, m)} fill="none" stroke={ACCENT} strokeWidth={2.25} strokeLinejoin="round" />

        {/* every point's handles, so the pad reads as editable at rest */}
        {keys.map((k, i) => (
          <Handles
            key={`h${i}`}
            k={k}
            index={i}
            last={keys.length - 1}
            m={m}
            active={i === sel}
            onDrag={startDrag}
          />
        ))}

        {keys.map((k, i) => {
          const active = i === sel;
          return (
            <circle
              key={i}
              cx={m.x(k.x)}
              cy={m.y(k.y)}
              r={active ? 6.5 : 5}
              fill={active ? ACCENT : 'var(--color-card)'}
              stroke={ACCENT}
              strokeWidth={2}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => startDrag(e, { kind: 'key', index: i })}
              onDoubleClick={(e) => {
                e.stopPropagation();
                removeAt(i);
              }}>
              <title>{`t ${round3(k.x)} · value ${round3(k.y)}`}</title>
            </circle>
          );
        })}

        {/* the ghost is drawn exactly where a click inserts, and only then */}
        {ghost && (
          <g pointerEvents="none">
            <line
              x1={m.x(ghost.x)}
              y1={m.y(ghost.y)}
              x2={m.x(ghost.x)}
              y2={m.y(0)}
              stroke={ACCENT}
              strokeOpacity={0.35}
              strokeDasharray="3 3"
            />
            <circle cx={m.x(ghost.x)} cy={m.y(ghost.y)} r={7} fill="none" stroke={ACCENT} strokeDasharray="3 2" />
            <path
              d={`M${m.x(ghost.x) - 3.5},${m.y(ghost.y)}h7M${m.x(ghost.x)},${m.y(ghost.y) - 3.5}v7`}
              stroke={ACCENT}
              strokeWidth={1.5}
            />
          </g>
        )}
      </svg>

      <div className="mt-2 flex items-center gap-2 text-[10px]">
        <span className="text-muted-foreground">point</span>
        <NumField
          label="t"
          value={selKey ? round3(selKey.x) : null}
          disabled={selKey === undefined || isEnd}
          onCommit={(v) => setField('x', v)}
        />
        <NumField
          label="value"
          value={selKey ? round3(selKey.y) : null}
          disabled={selKey === undefined}
          onCommit={(v) => setField('y', v)}
        />
        <button
          className="ml-auto rounded border px-1.5 py-0.5 leading-tight text-muted-foreground hover:text-foreground disabled:opacity-30"
          style={{ borderColor: 'var(--color-border)' }}
          disabled={sel === null || isEnd}
          title="Remove the selected point (or double-click it, or press Delete)"
          onClick={() => sel !== null && removeAt(sel)}>
          remove
        </button>
        <span className="tabular-nums text-muted-foreground">
          {keys.length}/{CURVE_MAX_KEYS}
        </span>
      </div>
      <div className="mt-1 text-[9px] text-muted-foreground">
        {full
          ? 'point limit reached — remove one to add another'
          : 'click the curve to add a point · drag handles to shape it · alt = break the pair · shift = snap'}
      </div>
    </div>
  );
}

/** A labelled numeric field for the selected point. Commits on blur/Enter so
 *  half-typed numbers never reach a structural param (each write recompiles). */
function NumField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onCommit(v: number): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? '' : String(value));
  return (
    <label className="flex items-center gap-1">
      <span className="text-muted-foreground">{label}</span>
      <input
        className="num w-14 text-center disabled:opacity-40"
        value={shown}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) onCommit(Number(draft));
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(null);
          e.stopPropagation(); // typing "-" must not reach the pad's shortcuts
        }}
      />
    </label>
  );
}

/** One keyframe's bezier handles. Faint until its point is selected, but
 *  always grabbable — needing to select first is a wasted click. */
function Handles({
  k,
  index,
  last,
  m,
  active,
  onDrag,
}: {
  k: CurveKey;
  index: number;
  last: number;
  m: ReturnType<typeof makeMap>;
  active: boolean;
  onDrag(e: React.PointerEvent, d: Drag): void;
}) {
  const cx = m.x(k.x);
  const cy = m.y(k.y);
  // The first key has nothing behind it and the last nothing ahead, so those
  // handles do not exist rather than sitting uselessly on top of the point.
  const shown: ('in' | 'out')[] = [];
  if (index > 0) shown.push('in');
  if (index < last) shown.push('out');
  return (
    <g opacity={active ? 1 : 0.4}>
      {shown.map((which) => {
        const hx = m.x(k.x + (which === 'in' ? k.ix : k.ox));
        const hy = m.y(k.y + (which === 'in' ? k.iy : k.oy));
        return (
          <g key={which}>
            <line x1={cx} y1={cy} x2={hx} y2={hy} stroke={ACCENT} strokeOpacity={0.7} />
            <rect
              x={hx - (active ? 4.5 : 3.5)}
              y={hy - (active ? 4.5 : 3.5)}
              width={active ? 9 : 7}
              height={active ? 9 : 7}
              rx={1.5}
              fill="var(--color-card)"
              stroke={ACCENT}
              strokeWidth={1.5}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => onDrag(e, { kind: which, index })}
            />
          </g>
        );
      })}
    </g>
  );
}

/** Sampled SVG path for a keyframe list. */
function curvePath(keys: CurveKey[], m: ReturnType<typeof makeMap>): string {
  const N = 120;
  let d = '';
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    d += `${i === 0 ? 'M' : 'L'}${m.x(t).toFixed(1)},${m.y(sampleCurve(keys, t)).toFixed(1)} `;
  }
  return d;
}

/** Unit box, quarter gridlines and value labels — you cannot shape a curve you
 *  cannot read values off. */
function Grid({ m }: { m: ReturnType<typeof makeMap> }) {
  const faint = 'color-mix(in oklab, var(--color-muted-foreground) 16%, transparent)';
  const solid = 'color-mix(in oklab, var(--color-muted-foreground) 34%, transparent)';
  return (
    <g pointerEvents="none">
      {[0.25, 0.5, 0.75].map((t) => (
        <line key={`v${t}`} x1={m.x(t)} y1={m.y(V_MAX)} x2={m.x(t)} y2={m.y(V_MIN)} stroke={faint} />
      ))}
      {[0.25, 0.5, 0.75].map((v) => (
        <line key={`h${v}`} x1={m.x(0)} y1={m.y(v)} x2={m.x(1)} y2={m.y(v)} stroke={faint} />
      ))}
      <rect
        x={m.x(0)}
        y={m.y(1)}
        width={m.x(1) - m.x(0)}
        height={m.y(0) - m.y(1)}
        fill="none"
        stroke={solid}
        strokeDasharray="3 3"
      />
      {[0, 0.5, 1].map((v) => (
        <text
          key={`t${v}`}
          x={m.x(0) - 5}
          y={m.y(v) + 3}
          textAnchor="end"
          fontSize={8}
          fill="var(--color-muted-foreground)">
          {v}
        </text>
      ))}
      <text x={m.x(0)} y={m.y(V_MIN) + 8} fontSize={8} fill="var(--color-muted-foreground)">
        0
      </text>
      <text x={m.x(1)} y={m.y(V_MIN) + 8} textAnchor="end" fontSize={8} fill="var(--color-muted-foreground)">
        time 1
      </text>
    </g>
  );
}

/** The §13.9 preset set as live thumbnails. */
export function PresetGrid({
  value,
  onChange,
  cols,
}: {
  value: string;
  onChange(key: string): void;
  cols: number;
}) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {EASE_KEYS.map((k) => {
        const active = k === value;
        return (
          <button
            key={k}
            className="flex flex-col items-center gap-0.5 rounded-md border p-1 hover:bg-black/20"
            style={{
              borderColor: active ? ACCENT : 'var(--color-border)',
              background: active ? 'color-mix(in oklab, #a78bfa 16%, transparent)' : 'transparent',
            }}
            title={k}
            onClick={() => onChange(k)}>
            <CurvePlot easeKey={k} w={50} h={32} stroke={active ? ACCENT : 'var(--color-muted-foreground)'} faint={!active} />
            <span className="w-full truncate text-center text-[8px] leading-tight text-muted-foreground">{k}</span>
          </button>
        );
      })}
    </div>
  );
}

// ──────────────────────────── node control + panel ─────────────────────────

/** The on-node ease control: a drawn curve you click to open the picker. */
export function EaseControl({
  value,
  onChange,
  nodeId,
  nodeLabel,
}: {
  value: string;
  onChange(key: string): void;
  nodeId: string;
  nodeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const openPicker = () => {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        className="nodrag flex w-full items-center gap-2 rounded-md border px-1.5 py-1 text-left hover:border-[color:var(--accent,#a78bfa)]"
        style={{ borderColor: 'var(--color-border)', background: 'color-mix(in oklab, var(--color-card) 60%, transparent)' }}
        title="Click to pick or customize the ease curve"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={openPicker}>
        <CurvePlot easeKey={value} w={54} h={38} />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">ease</span>
          <span className="truncate text-[10px]">{easeLabel(value)}</span>
        </span>
        <span className="ml-auto text-[9px] text-muted-foreground">▸</span>
      </button>
      {open && rect && (
        <CurvePickerPopover
          anchor={rect}
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
          onExpand={() => {
            setOpen(false);
            setExpanded(true);
          }}
        />
      )}
      {expanded && (
        <CurveModal
          nodeId={nodeId}
          nodeLabel={nodeLabel}
          value={value}
          onChange={onChange}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}

function CurvePickerPopover({
  anchor,
  value,
  onChange,
  onClose,
  onExpand,
}: {
  anchor: DOMRect;
  value: string;
  onChange(key: string): void;
  onClose(): void;
  onExpand(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.right + 8, top: anchor.top });
  const isCustom = isCustomEase(value);
  // Presets lead when one is in use and get out of the way once a custom curve
  // exists — at that point the pad is what the artist came for.
  const [showPresets, setShowPresets] = useState(!isCustom);

  // keep the panel on-screen
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = anchor.right + 8;
    let top = anchor.top;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, anchor.left - r.width - 8);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [anchor, showPresets]);

  // close on outside click / Escape
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] rounded-lg border p-3 text-[11px] shadow-2xl"
      style={{
        left: pos.left,
        top: pos.top,
        width: W + 24,
        background: 'var(--color-card)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-foreground)',
      }}
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-medium">Ease curve</span>
        <button
          className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          style={{ borderColor: 'var(--color-border)' }}
          onClick={() => setShowPresets((v) => !v)}>
          <span>{showPresets ? '▾' : '▸'}</span> presets
        </button>
        <span className="min-w-0 flex-1 truncate text-right text-[10px] text-muted-foreground">
          {easeLabel(value)}
        </span>
        <button
          className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          style={{ borderColor: 'var(--color-border)' }}
          onClick={onExpand}
          title="Open the full editor with a live preview of the effect">
          ⤢ live
        </button>
        <button className="text-muted-foreground hover:text-foreground" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {showPresets && (
        <div className="mb-3">
          <PresetGrid value={value} onChange={onChange} cols={5} />
        </div>
      )}

      <CurveEditor seed={value} onCommit={onChange} />

      <input
        className="num mt-2 w-full text-center"
        value={value}
        spellCheck={false}
        title="Ease key — a preset name, cubic-bezier(x1,y1,x2,y2), or curve(...)"
        onChange={(e) => onChange(e.target.value.trim())}
      />
    </div>,
    document.body,
  );
}
