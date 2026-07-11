import { useMemo, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { V1_SCHEMAS } from '@pylinka/graph';
import { useEditor } from '../store';
import { NS_LABEL, NS_ORDER, NS_TINT } from '../nsMeta';

/** MIME type carrying the node kind during a palette → canvas drag. */
export const DND_KIND = 'application/pylinka-node';

let spawnN = 0;

export function Palette() {
  const addNode = useEditor((s) => s.addNode);
  const { screenToFlowPosition } = useReactFlow();
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const by = new Map<string, { kind: string; label: string }[]>();
    for (const s of V1_SCHEMAS) {
      if (
        query &&
        !s.kind.toLowerCase().includes(query) &&
        !s.label.toLowerCase().includes(query) &&
        !(NS_LABEL[s.namespace] ?? s.namespace).toLowerCase().includes(query)
      )
        continue;
      const list = by.get(s.namespace) ?? [];
      list.push({ kind: s.kind, label: s.label });
      by.set(s.namespace, list);
    }
    const order: readonly string[] = NS_ORDER;
    return order.filter((ns) => by.has(ns)).map((ns) => ({
      ns,
      items: by.get(ns)!.sort((a, b) => a.label.localeCompare(b.label)),
    }));
  }, [q]);

  // click = add near the centre of the visible canvas (small cascade so
  // repeated clicks don't stack exactly)
  const add = (kind: string) => {
    const pane = document.querySelector('.react-flow');
    const r = pane?.getBoundingClientRect();
    const jitter = (spawnN++ % 6) * 28;
    const at = r
      ? screenToFlowPosition({ x: r.left + r.width / 2 + jitter, y: r.top + r.height / 3 + jitter })
      : { x: 120 + jitter, y: 60 + jitter };
    addNode(kind, at.x - 105, at.y - 15);
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border">
      <div className="border-b border-border p-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search nodes…"
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-foreground/40" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.length === 0 && (
          <div className="px-1 py-2 text-xs text-muted-foreground">No nodes match “{q}”.</div>
        )}
        {groups.map((g) => (
          <div key={g.ns} className="mb-3">
            <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: NS_TINT[g.ns] ?? '#888' }} />
              {NS_LABEL[g.ns] ?? g.ns}
            </div>
            {g.items.map((it) => (
              <button
                key={it.kind}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_KIND, it.kind);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => add(it.kind)}
                title={`${it.kind} — drag onto the canvas, or click to add`}
                className="group flex w-full cursor-grab items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-xs text-foreground/90 hover:border-border hover:bg-accent active:cursor-grabbing">
                <span className="inline-block h-2 w-2 shrink-0 rounded-[3px]"
                  style={{ background: `color-mix(in oklab, ${NS_TINT[g.ns] ?? '#888'} 70%, transparent)` }} />
                <span className="truncate">{it.label}</span>
                <code className="ml-auto text-[9px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  {it.kind.split('.')[1]}
                </code>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-border px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
        Drag a node onto the canvas — or click to drop it at the centre.
      </div>
    </aside>
  );
}
