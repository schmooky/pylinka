import { useMemo, useState } from 'react';
import { V1_SCHEMAS } from '@pylinka/graph';
import { useEditor } from '../store';

const ORDER = ['input', 'param', 'gen', 'math', 'field', 'shape', 'output', 'tex'];
let spawnN = 0;

export function Palette() {
  const addNode = useEditor((s) => s.addNode);
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const by = new Map<string, { kind: string; label: string }[]>();
    for (const s of V1_SCHEMAS) {
      if (query && !s.kind.toLowerCase().includes(query) && !s.label.toLowerCase().includes(query)) continue;
      const list = by.get(s.namespace) ?? [];
      list.push({ kind: s.kind, label: s.label });
      by.set(s.namespace, list);
    }
    return ORDER.filter((ns) => by.has(ns)).map((ns) => ({ ns, items: by.get(ns)!.sort((a, b) => a.kind.localeCompare(b.kind)) }));
  }, [q]);

  const add = (kind: string) => {
    const x = 120 + (spawnN % 5) * 24;
    const y = 40 + (spawnN % 9) * 24;
    spawnN++;
    addNode(kind, x, y);
  };

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border">
      <div className="border-b border-border p-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search nodes…"
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-foreground/40" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.map((g) => (
          <div key={g.ns} className="mb-3">
            <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{g.ns}</div>
            {g.items.map((it) => (
              <button key={it.kind} onClick={() => add(it.kind)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-foreground/90 hover:bg-accent">
                <span className="truncate">{it.label}</span>
                <code className="ml-auto text-[9px] text-muted-foreground">{it.kind.split('.')[1]}</code>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
