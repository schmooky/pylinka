import { useEffect, useMemo, useRef, useState } from 'react';
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
 * Everything you can start from, docked beside the editor.
 *
 * The recipes lived on their own page and "open in editor" replaced whatever
 * you were working on; the starters were a text-only list behind a menu; saved
 * projects were names in a dropdown. So building one effect out of pieces of
 * three meant leaving the editor, losing your place, and remembering which
 * name was which. Here they are one scrolling wall of moving previews, and
 * "Add" drops a piece INTO the current project — emitters, textures, masks,
 * knobs and sub-emitter links together, as one undo step — while "Open"
 * starts over from it.
 */

type Source = 'all' | 'recipes' | 'starters' | 'saved';

const OPEN_KEY = 'pylinka.editor.libraryOpen';

export function useLibraryOpen(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(OPEN_KEY, v ? '1' : '0');
    } catch {
      /* per-viewer convenience only */
    }
  };
  return [open, set];
}

export function LibraryPanel({ onClose }: { onClose(): void }) {
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
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [flash]);

  const groups = useMemo(() => ['all', ...orderedGroups()], []);
  const needle = q.trim().toLowerCase();
  const match = (...hay: (string | undefined)[]) => !needle || hay.some((h) => h?.toLowerCase().includes(needle));

  const recipes = RECIPES.filter(
    (r) => (group === 'all' || r.group === group) && match(r.title, r.oneLiner, r.group, ...r.tags),
  );
  const starters = group === 'all' ? EMITTER_TEMPLATES.filter((t) => match(t.name, t.hint)) : [];
  const mine = group === 'all' ? saved.filter((e) => match(e.name)) : [];
  const show = (s: Source) => source === 'all' || source === s;

  const open = (p: EditorProject | undefined, name: string) => {
    if (!p) return;
    if (dirty && !confirm(`Open “${name}” and replace the current project? It has unsaved changes.`)) return;
    importProject(p);
    setFlash(`Opened “${name}”`);
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

  const count =
    (show('recipes') ? recipes.length : 0) + (show('starters') ? starters.length : 0) + (show('saved') ? mine.length : 0);

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-border" style={{ background: 'var(--color-card)' }}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-semibold">Library</span>
        <span className="text-[10px] text-muted-foreground">{count} items</span>
        <button className="ml-auto rounded-md px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Close the library" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <input
          className="num w-full text-[11px]"
          style={{ width: '100%' }}
          placeholder="Search effects, tags, groups…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex overflow-hidden rounded-md border border-border text-[10px]">
          {(['all', 'recipes', 'starters', 'saved'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={`flex-1 py-1 capitalize ${source === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>
              {s}
            </button>
          ))}
        </div>
        {show('recipes') && (
          <div className="flex flex-wrap gap-1">
            {groups.map((g) => (
              <button
                key={g}
                onClick={() => setGroup(g)}
                className={`rounded-full border px-2 py-0.5 text-[10px] ${group === g ? 'border-foreground text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                {g}
              </button>
            ))}
          </div>
        )}
      </div>

      {flash && (
        <div className="border-b border-border px-3 py-1.5 text-[10px] text-foreground" style={{ background: 'color-mix(in oklab, var(--color-foreground) 8%, transparent)' }}>
          {flash} · undo with {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}Z
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
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
        {show('saved') && source === 'saved' && mine.length === 0 && (
          <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">Nothing saved yet — Project → Save to library.</div>
        )}

        {show('starters') && starters.length > 0 && (
          <Section title="Starters — one emitter, already wired">
            {starters.map((t) => (
              <StarterCard key={t.id} t={t} onAdd={() => addStarter(t)} />
            ))}
          </Section>
        )}

        {show('recipes') && recipes.length > 0 && (
          <Section title="Recipes — finished effects">
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

        {count === 0 && <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">No matches.</div>}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
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
        <LifePreview tracks={tracks} tex={null} life={life} width={64} height={64} />
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
        <LifePreview tracks={tracks} tex={tex} life={life} width={64} height={64} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium">{title}</div>
        <div className="truncate text-[9px] text-muted-foreground">{subtitle}</div>
      </div>
      <Actions onAdd={onAdd} onOpen={onOpen} />
    </div>
  );
}
