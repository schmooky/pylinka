/**
 * Ease-curve UI for the `structural.ease` param (§13.9). Replaces the bare
 * <select> — which showed only a name like `power2.out` that nobody remembers —
 * with a drawn curve on the node plus a picker: all presets as live thumbnails
 * and a draggable cubic-bezier editor for custom curves. The plot is sampled
 * with the compiler's `sampleEase`, so it shows exactly what the shader runs.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EASE_KEYS, parseCubicBezier, sampleEase } from '@pylinka/compiler';

const ACCENT = '#a78bfa';
// vertical view range — headroom so overshooting curves (back.out, anticipating
// beziers) stay visible instead of clipping at the unit box.
const V_MIN = -0.35;
const V_MAX = 1.35;
const DEFAULT_CUSTOM = 'cubic-bezier(0.25,0.1,0.25,1)'; // CSS "ease"

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/** Short human label for an ease key. */
export function easeLabel(key: string): string {
  return parseCubicBezier(key) ? 'custom' : key;
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

/** Draggable two-handle cubic-bezier authoring pad. Live-updates its own plot;
 *  commits `cubic-bezier(...)` via onCommit on pointer-up (structural writes
 *  recompile, so we don't thrash mid-drag). */
function BezierEditor({ seed, onCommit }: { seed: string; onCommit(key: string): void }) {
  const parsed = parseCubicBezier(seed) ?? parseCubicBezier(DEFAULT_CUSTOM)!;
  const [cp, setCp] = useState(parsed);
  // reseed when an external bezier value arrives (e.g. typed in the field)
  useEffect(() => {
    const p = parseCubicBezier(seed);
    if (p) setCp(p);
  }, [seed]);

  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<1 | 2 | null>(null);
  const W = 220;
  const H = 200;
  const pad = 22;
  const m = makeMap(W, H, pad);
  const key = `cubic-bezier(${round3(cp.x1)},${round3(cp.y1)},${round3(cp.x2)},${round3(cp.y2)})`;

  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const x = m.invX(e.clientX - r.left);
    const y = clamp(m.invY(e.clientY - r.top), V_MIN, V_MAX);
    setCp((c) => (drag.current === 1 ? { ...c, x1: x, y1: y } : { ...c, x2: x, y2: y }));
  };
  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    drag.current = null;
    onCommit(key);
  };

  const p1 = [m.x(cp.x1), m.y(cp.y1)] as const;
  const p2 = [m.x(cp.x2), m.y(cp.y2)] as const;
  const handle = (n: 1 | 2, pt: readonly [number, number]) => (
    <g>
      <line x1={n === 1 ? m.x(0) : m.x(1)} y1={n === 1 ? m.y(0) : m.y(1)} x2={pt[0]} y2={pt[1]} stroke={ACCENT} strokeOpacity={0.5} />
      <circle
        cx={pt[0]}
        cy={pt[1]}
        r={7}
        fill={ACCENT}
        style={{ cursor: 'grab' }}
        onPointerDown={(e) => {
          e.stopPropagation();
          drag.current = n;
          (e.currentTarget as unknown as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
      />
    </g>
  );

  return (
    <div>
      <svg
        ref={svgRef}
        width={W}
        height={H}
        style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerDown={(e) => e.stopPropagation()}>
        <CurvePlotInner easeKey={key} m={m} />
        {handle(1, p1)}
        {handle(2, p2)}
      </svg>
      <div className="mt-1 text-center text-[9px] text-muted-foreground">
        drag the two dots — endpoints are locked to (0,0) and (1,1)
      </div>
    </div>
  );
}

// shared curve/grid drawing given a prebuilt mapping (used inside the editor svg)
function CurvePlotInner({ easeKey, m }: { easeKey: string; m: ReturnType<typeof makeMap> }) {
  const N = 60;
  let d = '';
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    d += `${i === 0 ? 'M' : 'L'}${m.x(t).toFixed(1)},${m.y(sampleEase(easeKey, t)).toFixed(1)} `;
  }
  const grid = 'color-mix(in oklab, var(--color-muted-foreground) 22%, transparent)';
  return (
    <>
      <rect x={m.x(0)} y={m.y(1)} width={m.x(1) - m.x(0)} height={m.y(0) - m.y(1)} fill="none" stroke={grid} strokeDasharray="3 3" />
      <line x1={m.x(0)} y1={m.y(0)} x2={m.x(1)} y2={m.y(0)} stroke={grid} />
      <path d={d} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" />
    </>
  );
}

/** The on-node ease control: a drawn curve you click to open the picker. */
export function EaseControl({ value, onChange }: { value: string; onChange(key: string): void }) {
  const [open, setOpen] = useState(false);
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
        <CurvePickerPopover anchor={rect} value={value} onChange={onChange} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function CurvePickerPopover({
  anchor,
  value,
  onChange,
  onClose,
}: {
  anchor: DOMRect;
  value: string;
  onChange(key: string): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.right + 8, top: anchor.top });
  const isCustom = parseCubicBezier(value) !== null;

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
  }, [anchor]);

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
        width: 300,
        background: 'var(--color-card)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-foreground)',
      }}
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">Ease curve</span>
        <button className="text-muted-foreground hover:text-foreground" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {EASE_KEYS.map((k) => {
          const active = k === value;
          return (
            <button
              key={k}
              className="flex flex-col items-center gap-0.5 rounded-md border p-1 hover:bg-black/20"
              style={{ borderColor: active ? ACCENT : 'var(--color-border)', background: active ? 'color-mix(in oklab, #a78bfa 16%, transparent)' : 'transparent' }}
              title={k}
              onClick={() => onChange(k)}>
              <CurvePlot easeKey={k} w={54} h={36} stroke={active ? ACCENT : 'var(--color-muted-foreground)'} faint={!active} />
              <span className="w-full truncate text-center text-[8px] leading-tight text-muted-foreground">{k}</span>
            </button>
          );
        })}
      </div>

      <div className="my-2 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="h-px flex-1" style={{ background: 'var(--color-border)' }} />
        custom
        <span className="h-px flex-1" style={{ background: 'var(--color-border)' }} />
      </div>

      <div className="flex flex-col items-center">
        <div
          className="rounded-md border p-1"
          style={{ borderColor: isCustom ? ACCENT : 'var(--color-border)' }}>
          <BezierEditor seed={isCustom ? value : DEFAULT_CUSTOM} onCommit={onChange} />
        </div>
        <input
          className="num mt-2 w-full text-center"
          value={value}
          spellCheck={false}
          title="Ease key — a preset name or cubic-bezier(x1,y1,x2,y2)"
          onChange={(e) => onChange(e.target.value.trim())}
        />
      </div>
    </div>,
    document.body,
  );
}
