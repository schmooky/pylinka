import { useState } from 'react';
import { useEditor } from '../store';

/** Emitter tab strip: switch / add / enable / rename / remove the systems in a project. */
export function Systems() {
  const systems = useEditor((s) => s.project.systems);
  const activeId = useEditor((s) => s.activeSystemId);
  const setActive = useEditor((s) => s.setActiveSystem);
  const addSystem = useEditor((s) => s.addSystem);
  const removeSystem = useEditor((s) => s.removeSystem);
  const renameSystem = useEditor((s) => s.renameSystem);
  const toggleSystem = useEditor((s) => s.toggleSystem);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-card/40 px-2 py-1.5 text-xs">
      <span className="mr-1 shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Emitters</span>
      {systems.map((sys) => {
        const active = sys.id === activeId;
        return (
          <div key={sys.id}
            className={`group flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 ${
              active ? 'border-foreground/40 bg-accent' : 'border-border hover:bg-accent/50'
            } ${sys.enabled ? '' : 'opacity-50'}`}>
            <button title={sys.enabled ? 'Enabled — click to mute' : 'Muted — click to enable'}
              onClick={(e) => { e.stopPropagation(); toggleSystem(sys.id); }}
              className={`h-2 w-2 shrink-0 rounded-full ${sys.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/50'}`} />
            {editing === sys.id ? (
              <input autoFocus defaultValue={sys.name}
                className="w-24 bg-transparent outline-none"
                onBlur={(e) => { renameSystem(sys.id, e.target.value || sys.name); setEditing(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
            ) : (
              <button onClick={() => setActive(sys.id)} onDoubleClick={() => setEditing(sys.id)}
                className={active ? 'text-foreground' : 'text-muted-foreground'}>
                {sys.name}
              </button>
            )}
            {systems.length > 1 && (
              <button title="Remove emitter" onClick={() => removeSystem(sys.id)}
                className="text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100">✕</button>
            )}
          </div>
        );
      })}
      <button onClick={addSystem} title="Add an emitter"
        className="ml-1 shrink-0 rounded-md border border-dashed border-border px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">
        + Emitter
      </button>
    </div>
  );
}
