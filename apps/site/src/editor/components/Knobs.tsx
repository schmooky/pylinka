import { useState } from 'react';
import type { ParamDef } from '@pylinka/graph';
import { useEditor } from '../store';

interface KnobsProps {
  /** live slider values by knob NAME (falls back to each knob's default) */
  values: Record<string, number>;
  /** push a value into the running preview + local state */
  onSet(name: string, value: number): void;
}

export function Knobs({ values, onSet }: KnobsProps) {
  const params = useEditor((s) => s.project.params);
  const addParam = useEditor((s) => s.addParam);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Knobs</span>
        <button
          className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => {
            const id = addParam();
            setEditingId(id);
          }}>
          + Add knob
        </button>
      </div>
      {params.length === 0 && (
        <div className="text-xs leading-relaxed text-muted-foreground">
          No knobs yet. Add one here, or press the <span className="font-mono">◆</span> next to any number
          on a node to promote it into a live control.
        </div>
      )}
      {params.map((p) => (
        <KnobRow key={p.id} p={p} values={values} onSet={onSet}
          editing={editingId === p.id} onToggleEdit={() => setEditingId(editingId === p.id ? null : p.id)} />
      ))}
    </div>
  );
}

function KnobRow({ p, values, onSet, editing, onToggleEdit }: {
  p: ParamDef;
  values: Record<string, number>;
  onSet(name: string, value: number): void;
  editing: boolean;
  onToggleEdit(): void;
}) {
  const updateParam = useEditor((s) => s.updateParam);
  const removeParam = useEditor((s) => s.removeParam);
  const min = p.min ?? 0;
  const max = p.max ?? 1;
  const dflt = p.default.t === 'f32' ? p.default.v : 0;
  const val = values[p.name] ?? dflt;

  return (
    <div className="mb-1 rounded-md border border-transparent px-1.5 py-1 hover:border-border">
      <div className="flex items-center justify-between gap-2 text-xs">
        <button className="min-w-0 truncate text-left hover:text-foreground" title="Edit knob" onClick={onToggleEdit}>
          {p.name}
          <span className="ml-1 text-[9px] text-muted-foreground">{editing ? '▴' : '▾'}</span>
        </button>
        <span className="shrink-0 font-mono text-muted-foreground">
          {val.toFixed(2)}{p.unit ? ' ' + p.unit : ''}
        </span>
      </div>
      <input type="range" className="w-full" min={min} max={max} step={(max - min) / 200 || 0.01} value={val}
        onChange={(e) => onSet(p.name, Number(e.target.value))} />
      {editing && (
        <div className="mt-1.5 flex flex-col gap-1.5 border-t border-border pt-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="name">
              <input className="num w-full" style={{ width: '100%' }} value={p.name}
                onChange={(e) => updateParam(p.id, { name: e.target.value })} />
            </Field>
            <Field label="unit">
              <input className="num w-full" style={{ width: '100%' }} value={p.unit ?? ''} placeholder="px, s, rad…"
                onChange={(e) => updateParam(p.id, { unit: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <Field label="min">
              <input className="num w-full" style={{ width: '100%' }} type="number" step="any" value={min}
                onChange={(e) => updateParam(p.id, { min: Number(e.target.value) })} />
            </Field>
            <Field label="max">
              <input className="num w-full" style={{ width: '100%' }} type="number" step="any" value={max}
                onChange={(e) => updateParam(p.id, { max: Number(e.target.value) })} />
            </Field>
            <Field label="default">
              <input className="num w-full" style={{ width: '100%' }} type="number" step="any" value={dflt}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  updateParam(p.id, { default: { t: 'f32', v } });
                  onSet(p.name, v);
                }} />
            </Field>
          </div>
          <button
            className="self-start rounded-md border border-border px-2 py-1 text-[11px] text-red-400 hover:bg-accent"
            onClick={() => removeParam(p.id)}>
            Delete knob
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[9px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
