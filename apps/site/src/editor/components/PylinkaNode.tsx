import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Literal, PortType } from '@pylinka/graph';
import { getSchema, V1_CATALOG } from '@pylinka/graph';
import { useEditor } from '../store';

const HEADER_H = 30;
const ROW_H = 26;
const STRUCT_H = 30;
const WIDTH = 210;

const typeColor: Record<PortType, string> = {
  f32: 'var(--t-f32)',
  vec2: 'var(--t-vec2)',
  vec4: 'var(--t-vec4)',
  color: 'var(--t-vec4)',
  bool: 'var(--t-bool)',
};

const nsTint: Record<string, string> = {
  input: '#6b7280', param: '#a78bfa', gen: '#22d3ee', math: '#94a3b8',
  field: '#34d399', shape: '#fbbf24', output: '#f87171', tex: '#e879f9',
};

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

  const connected = useMemo(() => {
    const set = new Set<string>();
    for (const e of edges) if (e.to.nodeId === nodeId) set.add(e.to.portId);
    return set;
  }, [edges, nodeId]);

  if (!node) return null;
  const schema = getSchema(V1_CATALOG, node.kind);
  if (!schema) {
    return <div className="rounded-md border border-[#f87171] bg-card px-3 py-2 text-xs">{node.kind} (unknown)</div>;
  }

  const inputs = schema.inputs;
  const structural = schema.structural;
  const outputs = schema.outputs;
  const bodyH = HEADER_H + inputs.length * ROW_H + structural.length * STRUCT_H + outputs.length * ROW_H + 8;

  const tint = nsTint[schema.namespace] ?? '#888';

  return (
    <div className="rounded-lg border bg-card text-[11px] shadow-lg"
      style={{ width: WIDTH, minHeight: bodyH, borderColor: selected ? 'var(--color-foreground)' : 'var(--color-border)' }}>
      <div className="flex items-center gap-2 rounded-t-lg px-2.5 py-1.5"
        style={{ height: HEADER_H, background: 'color-mix(in oklab, var(--color-card) 82%, transparent)', borderBottom: '1px solid var(--color-border)' }}>
        <span style={{ width: 7, height: 7, borderRadius: 9, background: tint }} />
        <span className="font-medium">{schema.label}</span>
        <code className="ml-auto text-[9px] text-muted-foreground">{node.id}</code>
      </div>

      <div className="px-2.5 py-1">
        {inputs.map((p) => (
          <div key={p.id} className="flex items-center justify-between" style={{ height: ROW_H }}>
            <span className="text-muted-foreground">{p.id}</span>
            {!connected.has(p.id) && <ValueEditor nodeId={node.id} portId={p.id} type={p.type} value={node.values?.[p.id]} />}
          </div>
        ))}

        {structural.map((s) => (
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
        ))}

        {outputs.map((p) => (
          <div key={p.id} className="flex items-center justify-end" style={{ height: ROW_H }}>
            <span style={{ color: typeColor[p.type] }}>{p.id}</span>
          </div>
        ))}
      </div>

      {inputs.map((p, i) => (
        <Handle key={'in-' + p.id} type="target" position={Position.Left} id={p.id}
          style={{ top: HEADER_H + i * ROW_H + ROW_H / 2 + 4, background: typeColor[p.type] }} />
      ))}
      {outputs.map((p, j) => (
        <Handle key={'out-' + p.id} type="source" position={Position.Right} id={p.id}
          style={{ top: HEADER_H + inputs.length * ROW_H + structural.length * STRUCT_H + j * ROW_H + ROW_H / 2 + 4, background: typeColor[p.type] }} />
      ))}
    </div>
  );
}

export const PylinkaNode = memo(PylinkaNodeInner);
