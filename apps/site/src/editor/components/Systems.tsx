import { useState } from 'react';
import { useEditor } from '../store';
import { TabMenu, type TabMenuTarget } from './TabMenu';
import { TemplatePicker } from './TemplatePicker';

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
  const removeSystem = useEditor((s) => s.removeSystem);
  const renameSystem = useEditor((s) => s.renameSystem);
  const links = useEditor((s) => s.project.subEmitters);
  /** the name of the emitter this one is born from, if any */
  const parentName = (id: string): string | undefined => {
    const pid = (links ?? {})[id];
    return pid === undefined ? undefined : systems.find((x) => x.id === pid)?.name;
  };
  const toggleSystem = useEditor((s) => s.toggleSystem);
  const setConfigOpen = useEditor((s) => s.setConfigOpen);
  const setConfigSection = useEditor((s) => s.setConfigSection);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<TabMenuTarget | null>(null);
  const [templates, setTemplates] = useState(false);

  /** Right-click opens the strip's menu — on a tab, or on the empty stretch. */
  const openMenu = (e: React.MouseEvent, systemId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ screen: { x: e.clientX, y: e.clientY }, ...(systemId ? { systemId } : {}) });
  };


  const openConfig = (section: string) => {
    setConfigSection(section);
    setConfigOpen(true);
  };


  return (
    <div
      data-tour="emitters"
      /*
        No gap between children. The line under the strip is the sum of their
        bottom borders, so any gap is a hole in it — the children have to sit
        flush and use their own padding for breathing room instead.
      */
      className="tabstrip flex items-end overflow-x-auto pr-2 pt-1 text-xs"
      style={{ background: 'var(--color-card)' }}
      onContextMenu={(e) => openMenu(e)}>
      {/* the line has to start at the very edge, or the first tab's corner
          curves into nothing */}
      <div className="w-2 shrink-0 border-b border-border" />
      {systems.map((sys) => {
        const active = sys.id === activeId;
        return (
          <div key={sys.id}
            className={`group relative flex shrink-0 items-center gap-1.5 rounded-t-md border-x border-t px-3 py-1 ${
              active ? 'text-foreground' : 'border-b text-muted-foreground hover:bg-accent/40'
            } ${sys.enabled ? '' : 'opacity-50'}`}
            /*
             * Border colours are set here rather than with `border-transparent`:
             * editor.css carries an unlayered `* { border-color }`, and unlayered
             * rules beat Tailwind's layered utilities, so the class never won and
             * every inactive tab kept a full outline.
             */
            style={
              active
                ? { background: 'var(--color-background)', borderColor: 'var(--color-border)' }
                : { borderColor: 'transparent', borderBottomColor: 'var(--color-border)' }
            }
            onContextMenu={(e) => openMenu(e, sys.id)}>
            {/*
              The active tab met the line at a right angle, which reads as a box
              parked on a rule rather than a tab opening into the canvas. These
              flare its bottom corners outward with an inverse curve — the same
              shape a browser tab uses — so the tab and the line are one edge.
            */}
            {active && <Flare side="left" />}
            {active && <Flare side="right" />}
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
                title={
                  parentName(sys.id) === undefined
                    ? 'Double-click to rename'
                    : `Born from the particles of “${parentName(sys.id)}” — double-click to rename`
                }
                onClick={() => setActive(sys.id)}
                onDoubleClick={() => setEditing(sys.id)}>
                {/*
                  A sub-emitter is a relationship between two tabs, and nothing
                  in the strip showed it: the same tab whether its particles
                  came from the cursor or from another emitter's deaths. The
                  arrow is the whole difference, and the parent's name is on the
                  tooltip.
                */}
                {parentName(sys.id) !== undefined && (
                  <span aria-hidden className="mr-0.5 text-muted-foreground">
                    ↳
                  </span>
                )}
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
      <button
        onClick={(e) => openMenu(e)}
        title="New emitter — from a template, from the clipboard, or empty"
        className="shrink-0 rounded-t-md border-b border-border px-3 py-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground">
        + Emitter
      </button>
      {/*
        The line under the strip is drawn by everything EXCEPT the active tab —
        this spacer carries it across the empty stretch. Drawing it on the strip
        and covering the tab's slice back over was the obvious way round and left
        a hairline: the cover and the border never land on the same device pixel
        at fractional DPRs. Nothing to cover if nothing draws it there.
      */}
      <div className="min-w-2 flex-1 border-b border-border" />
      {/* per-emitter configuration — including where its particles come from —
          lives in Project → Settings, so the strip stays a list of names */}
      <button
        onClick={() => openConfig(`emitter:${activeId}`)}
        title="Configure this emitter"
        className="shrink-0 rounded-t-md border-b border-border px-3 py-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground">
        Configure
      </button>
      {menu && (
        <TabMenu
          target={menu}
          onClose={() => setMenu(null)}
          onRename={(id) => setEditing(id)}
          onTemplates={() => setTemplates(true)}
        />
      )}
      {templates && <TemplatePicker onClose={() => setTemplates(false)} />}
    </div>
  );
}

/**
 * One bottom corner of the active tab, curving outward into the line.
 *
 * Drawn with radial gradients rather than a border-radius, because the curve is
 * CONCAVE: the fill is everything OUTSIDE a circle centred on the tab's corner,
 * which no border-radius can express. The first gradient paints the 1px arc that
 * the tab's own border continues along; the second fills the wedge below it in
 * the canvas colour, so tab, curve and line are one edge.
 */
function Flare({ side }: { side: 'left' | 'right' }) {
  const R = 6; // matches the tab's rounded-t-md, so the two curves agree
  const at = side === 'left' ? 'top left' : 'top right';
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-0"
      style={{
        ...(side === 'left' ? { right: '100%' } : { left: '100%' }),
        width: R,
        height: R,
        background: [
          `radial-gradient(circle at ${at}, transparent ${R - 0.5}px, var(--color-border) ${R - 0.5}px, var(--color-border) ${R + 0.5}px, transparent ${R + 0.5}px)`,
          `radial-gradient(circle at ${at}, transparent ${R}px, var(--color-background) ${R}px)`,
        ].join(', '),
      }}
    />
  );
}
