import { memo, useMemo, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Literal, PortType } from '@pylinka/graph';
import { getSchema, V1_CATALOG } from '@pylinka/graph';
import { useEditor } from '../store';
import { NS_TINT } from '../nsMeta';
import { useDiagnostics } from '../diagnostics';
import { usePreview } from '../previewStore';
import { isInterpreted } from '@pylinka/core/webgl';
import { EaseControl } from './CurvePicker';

const HEADER_H = 30;
const ROW_H = 26;
const STRUCT_H = 30;
const EASE_H = 56; // taller structural row: the `ease` param draws its curve inline
const WIDTH = 210;

/** Structural rows are fixed-height except `ease`, which shows a curve plot. */
const structuralRowH = (key: string) => (key === 'ease' ? EASE_H : STRUCT_H);
const structuralTotalH = (specs: readonly { key: string }[]) =>
  specs.reduce((a, s) => a + structuralRowH(s.key), 0);

const typeColor: Record<PortType, string> = {
  f32: 'var(--t-f32)',
  vec2: 'var(--t-vec2)',
  vec4: 'var(--t-vec4)',
  color: 'var(--t-vec4)',
  bool: 'var(--t-bool)',
};

/** Port label that scrubs its f32 value on horizontal drag (shift = fine). */
function ScrubLabel({ label, dotColor, value, onChange }: {
  label: string;
  dotColor: string;
  value: number;
  onChange(v: number): void;
}) {
  const start = useRef<{ x: number; v: number } | null>(null);
  return (
    <span
      className="nodrag flex cursor-ew-resize select-none items-center gap-1.5 text-muted-foreground hover:text-foreground"
      title="Drag to scrub — hold Shift for fine steps"
      onPointerDown={(e) => {
        e.stopPropagation();
        start.current = { x: e.clientX, v: value };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const step = Math.max(0.01, Math.abs(start.current.v) / 150) * (e.shiftKey ? 0.1 : 1);
        const next = start.current.v + (e.clientX - start.current.x) * step;
        onChange(Math.round(next * 1000) / 1000);
      }}
      onPointerUp={(e) => {
        start.current = null;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      }}>
      <span className="inline-block h-1 w-1 rounded-full" style={{ background: dotColor }} />
      {label}
      <span className="text-[8px] opacity-0 transition-opacity group-hover/row:opacity-60">↔</span>
    </span>
  );
}

function ValueEditor({ nodeId, portId, type, value }: { nodeId: string; portId: string; type: PortType; value: Literal | undefined }) {
  const setValue = useEditor((s) => s.setValue);
  const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };

  if (type === 'f32') {
    const v = value?.t === 'f32' ? value.v : 0;
    return (
      <input {...stop} className="nodrag num" type="number" step="any" value={v}
        onChange={(e) => setValue(nodeId, portId, { t: 'f32', v: Number(e.target.value) })} />
    );
  }
  if (type === 'vec2') {
    const v = value?.t === 'vec2' ? value.v : [0, 0];
    const set = (i: number, n: number) => {
      const nv: [number, number] = [v[0], v[1]];
      nv[i] = n;
      setValue(nodeId, portId, { t: 'vec2', v: nv });
    };
    return (
      <span className="flex gap-1">
        <input {...stop} className="nodrag num" style={{ width: 44 }} type="number" step="any" value={v[0]} onChange={(e) => set(0, Number(e.target.value))} />
        <input {...stop} className="nodrag num" style={{ width: 44 }} type="number" step="any" value={v[1]} onChange={(e) => set(1, Number(e.target.value))} />
      </span>
    );
  }
  if (type === 'color') {
    const hex = value?.t === 'color' ? value.v : '#ffffffff';
    const rgb = hex.slice(0, 7);
    const aa = hex.slice(7, 9) || 'ff';
    return (
      <input {...stop} className="nodrag" type="color" value={rgb}
        style={{ width: 30, height: 20, padding: 0, background: 'none', border: 'none' }}
        onChange={(e) => setValue(nodeId, portId, { t: 'color', v: `${e.target.value}${aa}` })} />
    );
  }
  if (type === 'bool') {
    const v = value?.t === 'bool' ? value.v : false;
    return <input {...stop} className="nodrag" type="checkbox" checked={v} onChange={(e) => setValue(nodeId, portId, { t: 'bool', v: e.target.checked })} />;
  }
  return null;
}

function PylinkaNodeInner({ data, selected }: NodeProps) {
  const nodeId = (data as { nodeId: string }).nodeId;
  const node = useEditor((s) => s.system().graph.nodes.find((n) => n.id === nodeId));
  const edges = useEditor((s) => s.system().graph.edges);
  const params = useEditor((s) => s.project.params);
  const setStructural = useEditor((s) => s.setStructural);
  const setValue = useEditor((s) => s.setValue);
  const textures = useEditor((s) => s.project.textures);
  const setNodeAsset = useEditor((s) => s.setNodeAsset);
  const setAssetsOpen = useEditor((s) => s.setAssetsOpen);
  const deleteNode = useEditor((s) => s.deleteNode);
  const promoteValue = useEditor((s) => s.promoteValue);
  const unbindKnob = useEditor((s) => s.unbindKnob);
  const toggleNodeDisabled = useEditor((s) => s.toggleNodeDisabled);
  const muted = useEditor((s) => s.project.disabledNodes?.includes(nodeId) ?? false);
  /*
   * The interpreted backend recognises node PATTERNS rather than evaluating the
   * graph, so a kind it does not know contributes nothing — silently, until you
   * notice the effect is wrong. Compiled backends run the whole catalog. Say
   * which nodes are inert, and only while that backend is the one running.
   */
  const backend = usePreview((s) => s.backend);
  const inert = backend === 'webgl' && node !== undefined && !isInterpreted(node.kind);
  const problems = useDiagnostics().byNode.get(nodeId) ?? [];
  const worst = problems.some((d) => d.severity === 'error') ? 'error' : problems.length ? 'warning' : null;

  const connected = useMemo(() => {
    const set = new Set<string>();
    for (const e of edges) if (e.to.nodeId === nodeId) set.add(e.to.portId);
    return set;
  }, [edges, nodeId]);

  if (!node) return null;
  const schema = getSchema(V1_CATALOG, node.kind);
  if (!schema) {
    return <div className="rounded-md border border-destructive bg-card px-3 py-2 text-xs">{node.kind} (unknown)</div>;
  }

  const inputs = schema.inputs;
  const structural = schema.structural;
  const outputs = schema.outputs;
  const bodyH = HEADER_H + inputs.length * ROW_H + structuralTotalH(structural) + outputs.length * ROW_H + 8;

  const tint = NS_TINT[schema.namespace] ?? '#888';

  return (
    <div className="group/node rounded-lg border bg-card text-[11px] shadow-lg"
      style={{
        width: WIDTH,
        minHeight: bodyH,
        borderColor: worst === 'error'
          ? 'var(--color-destructive)'
          : selected
            ? tint
            : 'var(--color-border)',
        boxShadow: selected ? `0 0 0 1px ${tint}, 0 8px 24px -8px color-mix(in oklab, ${tint} 35%, transparent)` : undefined,
        opacity: muted ? 0.45 : inert ? 0.7 : 1,
        filter: muted ? 'grayscale(0.6)' : inert ? 'grayscale(0.5)' : undefined,
      }}>
      <div className="flex items-center gap-2 rounded-t-lg px-2.5 py-1.5"
        style={{
          height: HEADER_H,
          background: `linear-gradient(90deg, color-mix(in oklab, ${tint} 22%, var(--color-card)), var(--color-card))`,
          borderBottom: `1px solid color-mix(in oklab, ${tint} 30%, var(--color-border))`,
        }}>
        <button
          className="nodrag shrink-0 rounded-full"
          style={{ width: 7, height: 7, background: muted ? 'color-mix(in oklab, var(--color-muted-foreground) 50%, transparent)' : tint, boxShadow: muted ? 'none' : `0 0 6px ${tint}` }}
          title={muted ? 'Muted — click to include in the sim' : 'Active — click to mute (sim ignores it)'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => toggleNodeDisabled(node.id)}
        />
        <span className="truncate font-medium">{schema.label}{muted ? ' (muted)' : ''}</span>
        {inert && (
          <span
            className="shrink-0 cursor-help rounded px-1 text-[9px] leading-[14px]"
            style={{
              color: 'var(--color-muted-foreground)',
              background: 'var(--color-accent)',
            }}
            title={`The interpreted WebGL backend does not run ${schema.label} — it recognises node patterns rather than evaluating the graph, so this node has no effect on the preview. Switch the backend under the preview to WebGL2 or WebGPU, which run the whole catalog.`}>
            inert
          </span>
        )}
        {/* the validator knows which node is wrong; this is where it says so */}
        {worst !== null && (
          <span
            className="shrink-0 cursor-help text-[11px] leading-none"
            style={{ color: worst === 'error' ? 'var(--color-destructive)' : 'var(--color-foreground)' }}
            title={problems.map((d) => `${d.code}: ${d.message}`).join('\n\n')}>
            {worst === 'error' ? '!' : '?'}
          </span>
        )}
        <code className="ml-auto text-[9px] text-muted-foreground opacity-60">{node.id}</code>
        <button
          className="nodrag -mr-1 hidden h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-black/20 hover:text-foreground group-hover/node:flex"
          title="Delete node"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => deleteNode(node.id)}>
          ✕
        </button>
      </div>

      <div className="px-2.5 py-1">
        {inputs.map((p) => {
          const boundId = node.knobBindings?.[p.id];
          const bound = boundId ? params.find((pp) => pp.id === boundId) : undefined;
          const isConnected = connected.has(p.id);
          const scrubable = !isConnected && !bound && p.type === 'f32';
          const cur = node.values?.[p.id];
          return (
            <div key={p.id} className="group/row flex items-center justify-between gap-1" style={{ height: ROW_H }}>
              {scrubable ? (
                <ScrubLabel
                  label={p.id}
                  dotColor={typeColor[p.type]}
                  value={cur?.t === 'f32' ? cur.v : 0}
                  onChange={(v) => setValue(node.id, p.id, { t: 'f32', v })}
                />
              ) : (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="inline-block h-1 w-1 rounded-full" style={{ background: typeColor[p.type] }} />
                  {p.id}
                </span>
              )}
              {!isConnected && (bound ? (
                <span className="nodrag flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]"
                  style={{ background: 'color-mix(in oklab, var(--color-foreground) 14%, transparent)', color: 'var(--color-foreground)' }}
                  title={`Driven by knob “${bound.name}”`}
                  onPointerDown={(e) => e.stopPropagation()}>
                  ◆ {bound.name}
                  <button className="opacity-60 hover:opacity-100" title="Detach knob" onClick={() => unbindKnob(node.id, p.id)}>✕</button>
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  {p.type === 'f32' && (
                    <button
                      className="nodrag h-4 w-4 rounded text-[10px] leading-none text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/row:opacity-100"
                      title="Promote to knob (live slider in the preview)"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => promoteValue(node.id, p.id)}>
                      ◆
                    </button>
                  )}
                  <ValueEditor nodeId={node.id} portId={p.id} type={p.type} value={node.values?.[p.id]} />
                </span>
              ))}
            </div>
          );
        })}

        {structural.map((s) =>
          s.key === 'ease' ? (
            <div key={s.key} className="flex flex-col justify-center" style={{ height: EASE_H }}>
              <EaseControl
                value={node.structural?.[s.key] ?? s.default}
                onChange={(v) => setStructural(node.id, s.key, v)}
                nodeId={node.id}
                nodeLabel={schema?.label ?? node.kind}
              />
            </div>
          ) : s.key === 'asset' ? (
            <div key={s.key} className="flex items-center gap-1" style={{ height: STRUCT_H }}>
              <select
                className="nodrag sel min-w-0 flex-1"
                value={node.structural?.asset ?? ''}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => setNodeAsset(node.id, e.target.value || null)}>
                <option value="">None</option>
                {(textures ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                className="nodrag shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                style={{ borderColor: 'var(--color-border)' }}
                title="Open the asset manager"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setAssetsOpen(true)}>
                ⋯
              </button>
            </div>
          ) : (
            <div key={s.key} className="flex items-center justify-between gap-2" style={{ height: STRUCT_H }}>
              <span className="text-muted-foreground">{s.key}</span>
              <select className="nodrag sel" value={node.structural?.[s.key] ?? s.default}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => setStructural(node.id, s.key, e.target.value)}>
                {(s.key === 'param' ? params.map((pp) => pp.id) : s.options).map((opt) => (
                  <option key={opt} value={opt}>{s.key === 'param' ? (params.find((pp) => pp.id === opt)?.name ?? opt) : opt}</option>
                ))}
              </select>
            </div>
          ),
        )}

        {outputs.map((p) => (
          <div key={p.id} className="flex items-center justify-end gap-1.5" style={{ height: ROW_H }}>
            <span style={{ color: typeColor[p.type] }}>{p.id}</span>
            <span className="inline-block h-1 w-1 rounded-full" style={{ background: typeColor[p.type] }} />
          </div>
        ))}
      </div>

      {inputs.map((p, i) => (
        <Handle key={'in-' + p.id} type="target" position={Position.Left} id={p.id}
          style={{ top: HEADER_H + i * ROW_H + ROW_H / 2 + 4, background: typeColor[p.type] }} />
      ))}
      {outputs.map((p, j) => (
        <Handle key={'out-' + p.id} type="source" position={Position.Right} id={p.id}
          style={{ top: HEADER_H + inputs.length * ROW_H + structuralTotalH(structural) + j * ROW_H + ROW_H / 2 + 4, background: typeColor[p.type] }} />
      ))}
    </div>
  );
}

export const PylinkaNode = memo(PylinkaNodeInner);
