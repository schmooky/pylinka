/**
 * The one settings surface: a tree on the left, the selected section's controls
 * on the right.
 *
 * Configuration used to be scattered — spawn settings in a left-dock tab, the
 * emitter's parent in a strip above the graph, the scene reference in a preview
 * popover, the project name in the header. Each of those was a different shape
 * of thing to learn. They are all "how this project is set up", so they are all
 * here, and the tree is the only navigation.
 */
import { createPortal } from 'react-dom';
import { useEditor } from '../store';
import { usePreview, type BackendChoice } from '../previewStore';
import { EmitterPanel } from './EmitterPanel';
import { BackgroundSettings, ReferenceSettings } from './ReferenceSettings';

type Section = { id: string; label: string; depth: 0 | 1 };

export function ConfigModal() {
  const open = useEditor((s) => s.configOpen);
  const setOpen = useEditor((s) => s.setConfigOpen);
  const section = useEditor((s) => s.configSection);
  const setSection = useEditor((s) => s.setConfigSection);
  const backend = usePreview((st) => st.backend);
  const setBackend = usePreview((st) => st.setBackend);
  const project = useEditor((s) => s.project);
  const rename = useEditor((s) => s.rename);
  const renameSystem = useEditor((s) => s.renameSystem);
  const setActiveSystem = useEditor((s) => s.setActiveSystem);
  const removeSystem = useEditor((s) => s.removeSystem);
  const addSystem = useEditor((s) => s.addSystem);
  const moveSystem = useEditor((s) => s.moveSystem);
  const duplicateSystem = useEditor((s) => s.duplicateSystem);
  const toggleSystem = useEditor((s) => s.toggleSystem);
  const setActiveBlend = useEditor((s) => s.setActiveBlend);
  const activeSystemId = useEditor((s) => s.activeSystemId);
  const pathEdit = usePreview((s) => s.pathEdit);
  const setPathEdit = usePreview((s) => s.setPathEdit);

  if (!open) return null;

  const tree: Section[] = [
    { id: 'project', label: 'Project', depth: 0 },
    { id: 'emitters', label: 'Emitters', depth: 0 },
    ...project.systems.map((s) => ({ id: `emitter:${s.id}`, label: s.name, depth: 1 as const })),
    { id: 'preview', label: 'Preview', depth: 0 },
  ];

  /** Selecting an emitter section also makes it the active emitter, so the
   *  graph and preview behind the modal follow along. */
  const pick = (id: string) => {
    setSection(id);
    if (id.startsWith('emitter:')) setActiveSystem(id.slice('emitter:'.length));
  };

  const sysId = section.startsWith('emitter:') ? section.slice('emitter:'.length) : null;
  const sys = sysId ? project.systems.find((s) => s.id === sysId) : undefined;

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}>
      <div
        className="flex h-[74vh] w-[min(880px,92vw)] flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-sm font-semibold">Settings</span>
          <button
            className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* tree */}
          <nav
            className="w-52 shrink-0 overflow-y-auto border-r p-2"
            style={{ borderColor: 'var(--color-border)' }}>
            {tree.map((t) => (
              <button
                key={t.id}
                onClick={() => pick(t.id)}
                className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs ${
                  section === t.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
                style={{ paddingLeft: 8 + t.depth * 14 }}>
                {t.depth === 1 && <span className="text-[9px] opacity-50">•</span>}
                <span className="min-w-0 flex-1 truncate">{t.label}</span>
                {t.id === `emitter:${activeSystemId}` && (
                  <span className="shrink-0 text-[9px] text-muted-foreground">live</span>
                )}
              </button>
            ))}
            <button
              onClick={() => {
                addSystem();
                setSection(`emitter:${useEditor.getState().activeSystemId}`);
              }}
              className="mt-1 w-full rounded border border-dashed border-border px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
              + Emitter
            </button>
          </nav>

          {/* body */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {section === 'project' && (
              <Group title="Project" hint="What this effect is called, and where it goes.">
                <Field label="name">
                  <input
                    className="num w-full"
                    style={{ width: '100%' }}
                    value={project.name}
                    onChange={(e) => rename(e.target.value)}
                  />
                </Field>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {project.systems.length} emitter{project.systems.length === 1 ? '' : 's'} ·{' '}
                  {project.systems.reduce((n, s) => n + s.graph.nodes.length, 0)} nodes ·{' '}
                  {project.params.length} knob{project.params.length === 1 ? '' : 's'}
                </p>
              </Group>
            )}

            {section === 'emitters' && (
              <Group
                title="Emitters"
                hint="Each emitter is one particle system with its own graph, and this list is the DRAW ORDER — top of the list is drawn first, so it sits furthest back. Duplicate one to try a change on the copy, and mute the original while you compare.">
                <div className="flex flex-col gap-1">
                  {project.systems.map((s, i) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-xs">
                      <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
                        {i === 0 ? 'back' : i === project.systems.length - 1 ? 'front' : `#${i + 1}`}
                      </span>
                      <input
                        className="num min-w-0 flex-1"
                        style={{ width: 'auto' }}
                        value={s.name}
                        onChange={(e) => renameSystem(s.id, e.target.value || s.name)}
                      />
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {s.graph.nodes.length} nodes
                      </span>
                      <span className="flex shrink-0 items-center">
                        <button
                          disabled={i === 0}
                          title="Move back — drawn earlier, so behind the others"
                          className="rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent"
                          onClick={() => moveSystem(s.id, -1)}>
                          ↑
                        </button>
                        <button
                          disabled={i === project.systems.length - 1}
                          title="Move forward — drawn later, so on top"
                          className="rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent"
                          onClick={() => moveSystem(s.id, 1)}>
                          ↓
                        </button>
                      </span>
                      <button
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                        title={s.enabled ? 'Mute — keep it in the project, leave it out of the preview' : 'Unmute'}
                        onClick={() => toggleSystem(s.id)}>
                        {s.enabled ? 'mute' : 'muted'}
                      </button>
                      <button
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="Duplicate — try a change on the copy and mute the original"
                        onClick={() => duplicateSystem(s.id)}>
                        duplicate
                      </button>
                      <button
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={() => pick(`emitter:${s.id}`)}>
                        configure
                      </button>
                      {project.systems.length > 1 && (
                        <button
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-destructive"
                          onClick={() => removeSystem(s.id)}>
                          remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  An emitter born from another one is always drawn after its parent, whatever the
                  order says — it reads the parent's particles on the frame they happen, so it
                  cannot run first. A project keeps at least one emitter.
                </p>
              </Group>
            )}

            {sys !== undefined && (
              <Group title={sys.name} hint="Spawning, where particles are born, and how this emitter moves.">
                <Field label="blend mode">
                  <select
                    className="sel sel-wide"
                    value={sys.blendMode}
                    onChange={(e) => setActiveBlend(e.target.value as typeof sys.blendMode)}>
                    <option value="normal">normal</option>
                    <option value="add">add</option>
                    <option value="screen">screen</option>
                  </select>
                </Field>
                <EmitterPanel pathEdit={pathEdit} setPathEdit={setPathEdit} />
              </Group>
            )}

            {section === 'preview' && (
              <Group
                title="Preview"
                hint="How the preview runs, and what sits behind the particles while you author them. Editor-only — the runtime never sees any of it.">
                {/*
                  The backend lived in the preview's tool bar, where its label —
                  "WebGL2 · compiled" — was the widest thing in a row of icons
                  and pushed the rest off the end. It is also not a per-glance
                  control: you pick a renderer and leave it. The readout in the
                  corner of the preview says which one is running.
                */}
                <label className="mb-4 flex items-center gap-2 text-xs">
                  <span className="w-28 shrink-0 text-muted-foreground">renderer</span>
                  <select
                    value={backend}
                    onChange={(e) => setBackend(e.target.value as BackendChoice)}
                    className="sel sel-wide"
                    title="Compiled backends run the graph as generated GPU code and cover the whole catalog; the interpreted one recognises common node patterns and lives on its own canvas.">
                    <option value="webgl">WebGL · interpreted</option>
                    <option value="webgl2">WebGL2 · compiled</option>
                    <option value="webgpu">WebGPU · compiled</option>
                  </select>
                </label>
                <BackgroundSettings />
                <div className="mt-1 border-t border-border pt-4">
                  <h3 className="mb-2 text-xs font-semibold">Scene reference</h3>
                  <ReferenceSettings />
                </div>
              </Group>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Re-exported so the header can open a specific section in one call. */
export function useOpenConfig() {
  const setOpen = useEditor((s) => s.setConfigOpen);
  const setSection = useEditor((s) => s.setConfigSection);
  return (section?: string) => {
    if (section) setSection(section);
    setOpen(true);
  };
}
