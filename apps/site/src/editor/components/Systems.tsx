import { useState } from 'react';
import { useEditor } from '../store';

/**
 * Emitter tabs.
 *
 * These are real tabs, not a row of buttons: the active one drops its bottom
 * edge and takes the canvas colour, so the tab and the graph under it read as
 * one surface. That is the whole point of the metaphor — the tab is a handle on
 * the thing below it, and a floating pill says "button" instead.
 */
export function Systems() {
  const systems = useEditor((s) => s.project.systems);
  const activeId = useEditor((s) => s.activeSystemId);
  const setActive = useEditor((s) => s.setActiveSystem);
  const addSystem = useEditor((s) => s.addSystem);
  const removeSystem = useEditor((s) => s.removeSystem);
  const renameSystem = useEditor((s) => s.renameSystem);
  const toggleSystem = useEditor((s) => s.toggleSystem);
  const setConfigOpen = useEditor((s) => s.setConfigOpen);
  const setConfigSection = useEditor((s) => s.setConfigSection);
  const project = useEditor((s) => s.project);
  const [editing, setEditing] = useState<string | null>(null);

  // feature badges: what each emitter carries beyond its graph
  const badges = (sysId: string): { icon: string; label: string }[] => {
    const out: { icon: string; label: string }[] = [];
    if (project.systemTextures?.[sysId]) out.push({ icon: '🖼', label: 'textured sprite' });
    if (project.systemMasks?.[sysId]) out.push({ icon: '🎭', label: 'drawn emission area' });
    if ((project.systemPaths?.[sysId]?.points.length ?? 0) >= 2) out.push({ icon: '➰', label: 'trajectory spline' });
    return out;
  };

  const openConfig = (section: string) => {
    setConfigSection(section);
    setConfigOpen(true);
  };

  /** A sub-emitter says so on its tab — it is not born at the cursor like the rest. */
  const bornFrom = (sysId: string): string | undefined => {
    const parent = (project.subEmitters ?? {})[sysId];
    if (!parent) return undefined;
    const name = project.systems.find((s) => s.id === parent)?.name;
    return name ? `born from “${name}”` : undefined;
  };

  return (
    <div
      data-tour="emitters"
      className="flex items-end gap-0.5 overflow-x-auto border-b border-border px-2 pt-1.5 text-xs"
      style={{ background: 'var(--color-card)' }}>
      {systems.map((sys) => {
        const active = sys.id === activeId;
        return (
          <div key={sys.id}
            className={`group relative flex shrink-0 items-center gap-1.5 rounded-t-md px-2.5 py-1.5 ${
              active
                ? 'border-x border-t border-border text-foreground'
                : 'border-x border-t border-transparent text-muted-foreground hover:bg-accent/40'
            } ${sys.enabled ? '' : 'opacity-50'}`}
            style={
              active
                ? {
                    background: 'var(--color-background)',
                    // sit ON the strip's bottom border so the tab opens into the canvas
                    marginBottom: -1,
                    paddingBottom: 7,
                  }
                : { marginBottom: -1, paddingBottom: 6 }
            }>
            <button title={sys.enabled ? 'Enabled — click to mute' : 'Muted — click to enable'}
              onClick={(e) => { e.stopPropagation(); toggleSystem(sys.id); }}
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                background: sys.enabled
                  ? 'color-mix(in oklab, var(--color-foreground) 70%, transparent)'
                  : 'color-mix(in oklab, var(--color-muted-foreground) 45%, transparent)',
              }} />
            {editing === sys.id ? (
              <input autoFocus defaultValue={sys.name}
                className="w-24 bg-transparent outline-none"
                onBlur={(e) => { renameSystem(sys.id, e.target.value || sys.name); setEditing(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
            ) : (
              <button
                title="Double-click to rename"
                onClick={() => setActive(sys.id)}
                onDoubleClick={() => setEditing(sys.id)}>
                {sys.name}
              </button>
            )}
            {bornFrom(sys.id) !== undefined && (
              <span title={bornFrom(sys.id)} className="shrink-0 text-[10px] leading-none opacity-70">↳</span>
            )}
            {badges(sys.id).map((b) => (
              <span key={b.icon} title={`${b.label} — see the Emitter/Assets tabs`} className="text-[10px] leading-none opacity-80">
                {b.icon}
              </span>
            ))}
            {systems.length > 1 && (
              <button title="Remove emitter" onClick={() => removeSystem(sys.id)}
                className="text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100">✕</button>
            )}
          </div>
        );
      })}
      <button onClick={addSystem} title="Add an emitter"
        style={{ marginBottom: -1 }}
        className="ml-1 shrink-0 rounded-t-md px-2.5 py-1.5 pb-[6px] text-muted-foreground hover:bg-accent/40 hover:text-foreground">
        + Emitter
      </button>
      {/* per-emitter configuration — including where its particles come from —
          lives in Project → Settings, so the strip stays a list of names */}
      <button
        onClick={() => openConfig(`emitter:${activeId}`)}
        title="Configure this emitter"
        style={{ marginBottom: -1 }}
        className="ml-auto shrink-0 rounded-t-md px-2.5 py-1.5 pb-[6px] text-muted-foreground hover:bg-accent/40 hover:text-foreground">
        Configure
      </button>
    </div>
  );
}
