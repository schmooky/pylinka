/**
 * A knob, as a node on the canvas.
 *
 * Knobs used to be a list in a side tab, one step removed from the graph that
 * read them: you saw a `param.ref` node saying "windPower" and had to go
 * somewhere else to find out what windPower currently was, or to move it. The
 * knob IS the node now — its name, range and live value are all on the face of
 * it, and dragging the readout scrubs the running effect.
 *
 * The live value is deliberately NOT part of the project: it goes to the
 * preview's knob bus, the same path a game would use at runtime. Name, min, max
 * and default are the definition and do go through the store, so they undo.
 */
import { memo, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useEditor } from '../store';
import { usePreview } from '../previewStore';
import { NS_TINT } from '../nsMeta';

const WIDTH = 210;

/** Drag anywhere on the readout to scrub; the range decides how fast. */
function useScrub(value: number, min: number, max: number, onChange: (v: number) => void) {
  const from = useRef<{ x: number; v: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      from.current = { x: e.clientX, v: value };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!from.current) return;
      e.stopPropagation();
      // a full node-width drag covers the whole range, so a knob with a tight
      // range stays controllable and a wide one is still reachable
      const span = (max - min) / WIDTH;
      const next = from.current.v + (e.clientX - from.current.x) * span;
      onChange(Math.min(max, Math.max(min, next)));
    },
    onPointerUp: (e: React.PointerEvent) => {
      from.current = null;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    },
  };
}

function ParamNodeInner({ data, selected }: NodeProps) {
  const nodeId = (data as { nodeId: string }).nodeId;
  const node = useEditor((s) => s.system().graph.nodes.find((n) => n.id === nodeId));
  const params = useEditor((s) => s.project.params);
  const updateParam = useEditor((s) => s.updateParam);
  const deleteNode = useEditor((s) => s.deleteNode);
  const setStructural = useEditor((s) => s.setStructural);
  const knobs = usePreview((s) => s.knobs);
  const setKnob = usePreview((s) => s.setKnob);

  const param = params.find((p) => p.id === node?.structural?.param);
  const tint = NS_TINT.param ?? 'var(--color-foreground)';

  const min = param?.min ?? 0;
  const max = param?.max ?? 1;
  const fallback = param?.default.t === 'f32' ? param.default.v : 0;
  const value = param ? (knobs[param.name] ?? fallback) : 0;
  const scrub = useScrub(value, min, max, (v) => param && setKnob(param.name, v));
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  if (!node) return null;

  return (
    <div
      className="group/node rounded-lg border bg-card text-[11px] shadow-lg"
      style={{
        width: WIDTH,
        borderColor: selected ? tint : 'var(--color-border)',
        boxShadow: selected ? `0 0 0 1px ${tint}` : undefined,
      }}>
      <div
        className="flex items-center gap-2 rounded-t-lg px-2.5 py-1.5"
        style={{
          background: `linear-gradient(90deg, color-mix(in oklab, ${tint} 18%, var(--color-card)), var(--color-card))`,
          borderBottom: `1px solid color-mix(in oklab, ${tint} 26%, var(--color-border))`,
        }}>
        <span className="shrink-0 text-[10px] opacity-70">◆</span>
        {param ? (
          <input
            className="nodrag min-w-0 flex-1 bg-transparent font-medium outline-none"
            value={param.name}
            title="Knob name — this is what setKnob() takes at runtime"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => updateParam(param.id, { name: e.target.value })}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">no knob</span>
        )}
        <button
          className="nodrag hidden h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-black/20 hover:text-foreground group-hover/node:flex"
          title="Delete node"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => deleteNode(node.id)}>
          ✕
        </button>
      </div>

      <div className="px-2.5 py-2">
        {param === undefined ? (
          <select
            className="nodrag sel w-full"
            value=""
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setStructural(node.id, 'param', e.target.value)}>
            <option value="">pick a knob…</option>
            {params.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <>
            {/* the readout IS the control — drag it to scrub the running effect */}
            <div
              {...scrub}
              className="nodrag relative h-7 cursor-ew-resize select-none overflow-hidden rounded border border-border"
              title="Drag to scrub — this drives the live preview, not the saved project">
              <div
                className="absolute inset-y-0 left-0"
                style={{ width: `${pct}%`, background: `color-mix(in oklab, ${tint} 22%, transparent)` }}
              />
              {/* the range used to be printed here too — it is a row below now */}
              <div className="relative flex h-full items-center px-2">
                <span className="font-mono text-[12px]">{value.toFixed(rangeDigits(min, max))}</span>
              </div>
            </div>

            {/*
              One field per row, always shown. These three numbers decide what
              the knob even means; hiding them behind a disclosure made the node
              look configured when it was not, and a grid of three cramped
              inputs made them read as one setting rather than three.
            */}
            <div className="mt-2 flex flex-col">
              <Num label="min" v={min} on={(v) => updateParam(param.id, { min: v })} />
              <Num label="max" v={max} on={(v) => updateParam(param.id, { max: v })} />
              <Num
                label="default"
                v={fallback}
                on={(v) => updateParam(param.id, { default: { t: 'f32', v } })}
              />
            </div>
          </>
        )}

        <div className="mt-2 flex items-center justify-end gap-1.5">
          <span className="text-muted-foreground">out</span>
          <span className="inline-block h-1 w-1 rounded-full" style={{ background: 'var(--t-f32)' }} />
        </div>
      </div>

      <Handle type="source" position={Position.Right} id="out" style={{ bottom: 14, top: 'auto', background: 'var(--t-f32)' }} />
    </div>
  );
}

/** Enough decimals to see a drag move, without a jittering wall of digits. */
function rangeDigits(min: number, max: number): number {
  const span = Math.abs(max - min);
  return span >= 100 ? 0 : span >= 10 ? 1 : span >= 1 ? 2 : 3;
}

function Num({ label, v, on }: { label: string; v: number; on(v: number): void }) {
  return (
    <label className="flex items-center justify-between gap-2" style={{ height: 24 }}>
      <span className="text-muted-foreground">{label}</span>
      <input
        className="nodrag num"
        style={{ width: 76 }}
        type="number"
        value={v}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => Number.isFinite(Number(e.target.value)) && on(Number(e.target.value))}
      />
    </label>
  );
}

export const ParamNode = memo(ParamNodeInner);
