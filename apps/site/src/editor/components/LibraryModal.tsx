import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { System } from '@pylinka/graph';
import { forkRecipe, useEditor } from '../store';
import { RECIPES, type Recipe } from '../../recipes/data';
import { orderedGroups } from '../../recipes/groups';
import { EMITTER_TEMPLATES, type EmitterTemplate } from '../templates';
import { emitterPayload } from '../clipboard';
import { autoLayout } from '../layout';
import { lifeSeconds, particleTracks } from '../lifePreview';
import type { EditorProject, EditorTexture } from '../types';
import { LifePreview } from './LifePreview';
import { readLib, type LibEntry } from './ProjectsMenu';

/**
 * Everything you can start from, in one place, without leaving the editor.
 *
 * The recipes lived on their own page and "open in editor" replaced whatever
 * you were working on; the starters were a text-only list behind a menu; saved
 * projects were names in a dropdown. So building one effect out of pieces of
 * three meant leaving the editor, losing your place, and remembering which
 * name was which. Here they are one wall of moving previews, and "Add" drops a
 * piece INTO the current project — emitters, textures, masks, knobs and
 * sub-emitter links together, as one undo step — while "Open" starts over.
 *
 * A modal, like Assets and Settings, rather than a dock: browsing wants the
 * whole screen, and a permanent column squeezed both the graph and the
 * preview. Because it covers the preview, Add keeps it open (you are often
 * picking several pieces) and says what landed; Open closes it.
 */

type Source = 'all' | 'recipes' | 'starters' | 'saved';

export function LibraryModal({ onClose }: { onClose(): void }) {
  const addEmittersFrom = useEditor((s) => s.addEmittersFrom);
  const pasteEmitter = useEditor((s) => s.pasteEmitter);
  const importProject = useEditor((s) => s.importProject);
  const dirty = useEditor((s) => s.dirty);
  const [source, setSource] = useState<Source>('all');
  const [group, setGroup] = useState('all');
  const [q, setQ] = useState('');
  const [saved, setSaved] = useState<LibEntry[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => setSaved(readLib()), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  const groups = useMemo(() => orderedGroups(), []);
  const needle = q.trim().toLowerCase();
  const match = (...hay: (string | undefined)[]) => !needle || hay.some((h) => h?.toLowerCase().includes(needle));

  const allRecipes = RECIPES.filter((r) => match(r.title, r.oneLiner, r.group, ...r.tags));
  const recipes = allRecipes.filter((r) => group === 'all' || r.group === group);
  const starters = EMITTER_TEMPLATES.filter((t) => match(t.name, t.hint));
  const mine = saved.filter((e) => match(e.name));
  // a recipe group narrows to recipes; starters and saved projects have none
  const show = (s: Source) => (source === 'all' && group === 'all') || source === s;
  const total = allRecipes.length + starters.length + mine.length;

  const open = (p: EditorProject | undefined, name: string) => {
    if (!p) return;
    if (dirty && !confirm(`Open “${name}” and replace the current project? It has unsaved changes.`)) return;
    importProject(p);
    onClose();
  };
  const add = (p: EditorProject | undefined, name: string, renameAfter = false) => {
    if (!p) return;
    // recipe emitters are called things like "fx"; name them after what they are
    if (renameAfter) for (const sys of p.systems) sys.name = p.systems.length === 1 ? name : `${name} · ${sys.name}`;
    addEmittersFrom(p);
    setFlash(`Added “${name}” — ${p.systems.length} emitter${p.systems.length === 1 ? '' : 's'}`);
  };
  const addStarter = (t: EmitterTemplate) => {
    const system = { ...structuredClone(t.system), id: `t_${t.id}` } as System;
    pasteEmitter(emitterPayload(system, autoLayout(system.graph)));
    setFlash(`Added “${t.name}”`);
  };

  const pickSource = (s: Source) => {
    setSource(s);
    if (s !== 'recipes') setGroup('all');
  };
  const pickGroup = (g: string) => {
    setGroup(g);
    if (g !== 'all') setSource('recipes');
  };

  const side = (active: boolean) =>
    `flex w-full items-center justify-between rounded-md px-2 py-1 text-left ${active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}>
      <div
        className="relative flex h-[86vh] w-[min(1240px,94vw)] flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-foreground)' }}>
        <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-sm font-semibold">Library</span>
          <input
            autoFocus
            className="num flex-1 text-[12px]"
            style={{ width: 'auto', maxWidth: 420 }}
            placeholder="Search effects, tags, groups…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="text-[11px] text-muted-foreground">Add merges into this project · Open starts over</span>
          <button className="ml-auto rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Close (Esc)" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2 text-[11px]" style={{ borderColor: 'var(--color-border)' }}>
            {(
              [
                ['all', 'Everything', total],
                ['recipes', 'Recipes', allRecipes.length],
                ['starters', 'Starters', starters.length],
                ['saved', 'Saved projects', mine.length],
              ] as const
            ).map(([s, label, n]) => (
              <button key={s} className={side(source === s && (s === 'recipes' || group === 'all'))} onClick={() => pickSource(s)}>
                <span>{label}</span>
                <span className="font-mono text-[9px] opacity-70">{n}</span>
              </button>
            ))}
            <div className="mb-1 mt-3 px-2 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Recipe groups</div>
            {groups.map((g) => (
              <button key={g} className={side(group === g)} onClick={() => pickGroup(group === g ? 'all' : g)}>
                <span>{g}</span>
                <span className="font-mono text-[9px] opacity-70">{allRecipes.filter((r) => r.group === g).length}</span>
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {show('saved') && mine.length > 0 && (
              <Section title="Saved projects">
                {mine.map((e) => (
                  <ProjectCard
                    key={e.id}
                    title={e.name}
                    subtitle={`${e.data.systems.length} emitter${e.data.systems.length === 1 ? '' : 's'} · ${new Date(e.updatedAt).toLocaleDateString()}`}
                    project={e.data}
                    onAdd={() => add(structuredClone(e.data), e.name)}
                    onOpen={() => open(structuredClone(e.data), e.name)}
                  />
                ))}
              </Section>
            )}
            {source === 'saved' && mine.length === 0 && (
              <Empty>{needle ? 'No saved project matches.' : 'Nothing saved yet — Project → Save to library.'}</Empty>
            )}

            {show('recipes') && recipes.length > 0 && (
              <Section title={group === 'all' ? 'Recipes — finished effects' : `Recipes — ${group}`}>
                {recipes.map((r) => (
                  <RecipeCard
                    key={r.slug}
                    r={r}
                    onAdd={() => add(forkRecipe(r.slug), r.title, true)}
                    onOpen={() => open(forkRecipe(r.slug), r.title)}
                  />
                ))}
              </Section>
            )}

            {show('starters') && starters.length > 0 && (
              <Section title="Starters — one emitter, already wired">
                {starters.map((t) => (
                  <StarterCard key={t.id} t={t} onAdd={() => addStarter(t)} />
                ))}
              </Section>
            )}

            {total === 0 && <Empty>No matches.</Empty>}
          </div>
        </div>

        {flash && (
          <div
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg border px-3 py-2 text-[11px] shadow-xl"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-popover)' }}>
            <span>{flash}</span>
            <span className="text-muted-foreground">undo with {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}Z</span>
            <button className="rounded-md bg-foreground px-2 py-0.5 text-[10px] font-medium text-black hover:brightness-110" onClick={onClose}>
              View
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-10 text-center text-[12px] text-muted-foreground">{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">{children}</div>
    </div>
  );
}

function Actions({ onAdd, onOpen }: { onAdd(): void; onOpen?(): void }) {
  return (
    <div className="flex gap-1">
      <button
        className="flex-1 rounded-md bg-foreground px-2 py-1 text-[10px] font-medium text-black hover:brightness-110"
        title="Add its emitters to the current project"
        onClick={onAdd}>
        + Add
      </button>
      {onOpen && (
        <button
          className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Replace the current project with this one"
          onClick={onOpen}>
          Open
        </button>
      )}
    </div>
  );
}

/** A recorded card video, played only while it is on screen. */
function RecipeCard({ r, onAdd, onOpen }: { r: Recipe; onAdd(): void; onOpen(): void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) void v.play().catch(() => undefined);
      else v.pause();
    });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-1.5" title={r.oneLiner}>
      <div className="relative aspect-[14/9] overflow-hidden rounded bg-black">
        {failed ? (
          <div className="grid h-full place-items-center text-[10px] text-muted-foreground">no preview</div>
        ) : (
          <video
            ref={ref}
            className="h-full w-full object-cover"
            src={`/recipes/${r.slug}/card.webm`}
            poster={`/recipes/${r.slug}/card.jpg`}
            muted
            loop
            playsInline
            preload="none"
            onError={() => setFailed(true)}
          />
        )}
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[8px] uppercase tracking-wider text-white/80">{r.group}</span>
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium">{r.title}</div>
        <div className="line-clamp-2 text-[9px] leading-snug text-muted-foreground">{r.oneLiner}</div>
      </div>
      <Actions onAdd={onAdd} onOpen={onOpen} />
    </div>
  );
}

/** Starters have no recording — show their particle living out one life instead. */
function StarterCard({ t, onAdd }: { t: EmitterTemplate; onAdd(): void }) {
  const { tracks, life } = useMemo(() => {
    const s = t.system as System;
    return { tracks: particleTracks(s), life: lifeSeconds(s) };
  }, [t]);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-1.5" title={t.hint}>
      <div className="grid aspect-[14/9] place-items-center overflow-hidden rounded bg-black">
        <LifePreview tracks={tracks} tex={null} life={life} width={84} height={84} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium">{t.name}</div>
        <div className="line-clamp-2 text-[9px] leading-snug text-muted-foreground">{t.hint}</div>
      </div>
      <Actions onAdd={onAdd} />
    </div>
  );
}

/** A saved project: its first emitter's particle, with its texture. */
function ProjectCard({
  title,
  subtitle,
  project,
  onAdd,
  onOpen,
}: {
  title: string;
  subtitle: string;
  project: EditorProject;
  onAdd(): void;
  onOpen(): void;
}) {
  const { tracks, life, tex } = useMemo(() => {
    const s = project.systems[0]!;
    const texId = project.systemTextures?.[s.id];
    const tex: EditorTexture | null = (texId && project.textures?.find((x) => x.id === texId)) || null;
    return { tracks: particleTracks(s, project.disabledNodes), life: lifeSeconds(s), tex };
  }, [project]);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-1.5">
      <div className="grid aspect-[14/9] place-items-center overflow-hidden rounded bg-black">
        <LifePreview tracks={tracks} tex={tex} life={life} width={84} height={84} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium">{title}</div>
        <div className="truncate text-[9px] text-muted-foreground">{subtitle}</div>
      </div>
      <Actions onAdd={onAdd} onOpen={onOpen} />
    </div>
  );
}
