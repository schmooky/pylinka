import { create } from 'zustand';
import type { Edge, EmitterSettings, Literal, Node, ParamDef, System } from '@pylinka/graph';
import { getSchema, V1_CATALOG } from '@pylinka/graph';
import { seedProject } from './seed';
import { autoLayout } from './layout';
import { RECIPES, type RecipeAtlas } from '../recipes/data';
import type { CommentFrame, EditorProject, EditorTexture, EmissionMaskData, EmitterPathData, StickyNote } from './types';
import { generateAnnotations } from './annotate';

const KEY = 'pylinka.editor.project';
type XY = { x: number; y: number };

/** Back-compat + invariants: a project always has systemTextures + an active system. */
function normalize(p: EditorProject): EditorProject {
  p.systemTextures = p.systemTextures ?? {};
  // migrate the old single active-texture field onto the first system
  const legacy = (p as { activeTextureId?: string | null }).activeTextureId;
  if (legacy && p.systems[0] && !(p.systems[0].id in p.systemTextures)) {
    p.systemTextures[p.systems[0].id] = legacy;
  }
  delete (p as { activeTextureId?: string | null }).activeTextureId;
  return p;
}

function forkRecipe(slug: string): EditorProject | undefined {
  const recipe = RECIPES.find((r) => r.slug === slug);
  if (!recipe) return undefined;
  const project = normalize(structuredClone(recipe.project) as EditorProject);
  project.id = crypto.randomUUID();
  project.name = recipe.title;
  // lay out every system (each has globally-unique node ids, so positions merge);
  // stretch rows vertically so the generated comment frames have title room
  const nodePositions = project.systems.reduce<Record<string, { x: number; y: number }>>(
    (acc, s) => Object.assign(acc, autoLayout(s.graph)),
    {},
  );
  for (const p of Object.values(nodePositions)) p.y *= 1.5;
  project.editor = { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions };

  // seed editor textures from the recipe's atlas descriptors (per-system, or the
  // legacy single atlas bound to systems[0]) and carry over sub-emitter links.
  const atlasBySystem: Record<string, RecipeAtlas> =
    recipe.systemAtlases ?? (recipe.atlas ? { [project.systems[0]!.id]: recipe.atlas } : {});
  const textures: EditorTexture[] = [];
  const systemTextures: Record<string, string> = {};
  for (const [systemId, a] of Object.entries(atlasBySystem)) {
    const t: EditorTexture = {
      id: crypto.randomUUID(),
      name: a.url.split('/').pop() ?? 'atlas',
      src: a.url,
      width: a.cols * (a.frameW + a.pad),
      height: a.rows * (a.frameH + a.pad),
      cols: a.cols,
      rows: a.rows,
      pad: a.pad,
      fps: a.fps,
      play: a.play,
      pick: a.pick,
    };
    textures.push(t);
    systemTextures[systemId] = t.id;
  }
  if (textures.length) {
    project.textures = textures;
    project.systemTextures = systemTextures;
  }
  if (recipe.subEmitters) project.subEmitters = { ...recipe.subEmitters };
  // self-documenting recipes: Spawn/Forces/Look frames + a one-liner sticky note
  if (!project.annotations) {
    project.annotations = generateAnnotations(project, nodePositions, `${recipe.title}\n\n${recipe.oneLiner}`);
  }
  return project;
}

function load(): EditorProject {
  try {
    const slug = new URLSearchParams(location.search).get('recipe');
    if (slug) {
      const forked = forkRecipe(slug);
      if (forked) {
        localStorage.setItem(KEY, JSON.stringify(forked));
        history.replaceState(null, '', location.pathname);
        return forked;
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw) as EditorProject);
  } catch {
    /* ignore */
  }
  return normalize(seedProject() as EditorProject);
}

/** Next free param id ('p1', 'p2', …). */
function nextParamId(p: EditorProject): string {
  let max = 0;
  for (const pd of p.params) {
    const m = /^p(\d+)$/.exec(pd.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `p${max + 1}`;
}

/** A valid, unique knob name derived from `base` ('scale_from', 'scale_from2', …). */
function uniqueParamName(p: EditorProject, base: string): string {
  const name = base.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^(\d)/, '_$1') || 'knob';
  const taken = new Set(p.params.map((pd) => pd.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name}${n}`)) n++;
  return `${name}${n}`;
}

/** Global-unique node id across ALL systems (positions are keyed by bare node id). */
function nextNodeId(p: EditorProject): string {
  let max = 0;
  for (const sys of p.systems)
    for (const n of sys.graph.nodes) {
      const m = /^n(\d+)$/.exec(n.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
  return `n${max + 1}`;
}

/** A simple upward fountain, node ids starting at `base` (kept globally unique). */
function makeSystem(name: string, base: number): System {
  const id = (k: number) => `n${base + k}`;
  return {
    id: crypto.randomUUID(), name, capacity: 4000, blendMode: 'add', enabled: true, space: 'world',
    emitter: { mode: 'flow', rate: 300, rateOverDistance: 1.2 },
    graph: {
      nodes: [
        { id: id(0), kind: 'shape.point', values: { offset: { t: 'vec2', v: [0, 0] } } },
        { id: id(1), kind: 'output.spawnPosition' },
        { id: id(2), kind: 'gen.randomRange', values: { min: { t: 'f32', v: 0.8 }, max: { t: 'f32', v: 1.6 } } },
        { id: id(3), kind: 'output.initLife' },
        { id: id(4), kind: 'gen.randomVec2', values: { min: { t: 'vec2', v: [-60, -300] }, max: { t: 'vec2', v: [60, -380] } } },
        { id: id(5), kind: 'output.initVelocity' },
        { id: id(6), kind: 'field.gravity', values: { g: { t: 'vec2', v: [0, 420] } } },
        { id: id(7), kind: 'output.addForce' },
        { id: id(8), kind: 'gen.scaleOverLife', structural: { ease: 'power2.out' }, values: { from: { t: 'f32', v: 1.2 }, to: { t: 'f32', v: 0 } } },
        { id: id(9), kind: 'output.writeScale' },
      ],
      edges: [
        { id: `e${base}a`, from: { nodeId: id(0), portId: 'pos' }, to: { nodeId: id(1), portId: 'pos' } },
        { id: `e${base}b`, from: { nodeId: id(2), portId: 'out' }, to: { nodeId: id(3), portId: 'life' } },
        { id: `e${base}c`, from: { nodeId: id(4), portId: 'out' }, to: { nodeId: id(5), portId: 'vel' } },
        { id: `e${base}d`, from: { nodeId: id(6), portId: 'force' }, to: { nodeId: id(7), portId: 'force' } },
        { id: `e${base}e`, from: { nodeId: id(8), portId: 'out' }, to: { nodeId: id(9), portId: 'scale' } },
      ],
    },
  };
}

interface EditorState {
  project: EditorProject;
  positions: Record<string, XY>;
  activeSystemId: string;
  selectedNodeId: string | null;
  /** graph/sim changes (preview re-applies live) */
  rev: number;
  /** texture/system-set changes (preview re-creates the engines) */
  texRev: number;
  system(): System;
  snapshot(): EditorProject;
  addNode(kind: string, x: number, y: number): void;
  moveNode(id: string, x: number, y: number): void;
  setValue(nodeId: string, portId: string, value: Literal): void;
  setStructural(nodeId: string, key: string, value: string): void;
  connect(from: Edge['from'], to: Edge['to']): void;
  deleteNode(id: string): void;
  /** mute/unmute a node — it stays in the graph but the sim ignores it */
  toggleNodeDisabled(id: string): void;
  deleteEdge(id: string): void;
  select(id: string | null): void;
  rename(name: string): void;
  // systems (emitters)
  setActiveSystem(id: string): void;
  addSystem(): void;
  removeSystem(id: string): void;
  renameSystem(id: string, name: string): void;
  toggleSystem(id: string): void;
  /** make `childId` spawn on `parentId`'s particle deaths (null = born at cursor) */
  setSubParent(childId: string, parentId: string | null): void;
  // knobs (project params)
  /** add a new f32 knob; returns its id */
  addParam(init?: Partial<Pick<ParamDef, 'name' | 'min' | 'max' | 'default' | 'unit' | 'group'>>): string;
  updateParam(id: string, patch: Partial<Pick<ParamDef, 'name' | 'min' | 'max' | 'default' | 'unit' | 'group'>>): void;
  /** delete a knob + every param.ref node / knobBinding that references it */
  removeParam(id: string): void;
  /** promote an unconnected f32 port to a new knob (knobBindings) */
  promoteValue(nodeId: string, portId: string): void;
  /** detach a port from its knob (value falls back to the literal) */
  unbindKnob(nodeId: string, portId: string): void;
  // textures (bound to the active system)
  addTexture(tex: Omit<EditorTexture, 'id'>): void;
  /** returns the new texture's id, so callers can select it after adding */
  addTextureId(tex: Omit<EditorTexture, 'id'>): string;
  updateTexture(id: string, patch: Partial<Omit<EditorTexture, 'id'>>): void;
  removeTexture(id: string): void;
  setActiveTexture(id: string | null): void;
  /** pick a texture for a tex.* node: sets its structural.asset AND the active
   *  system's texture (what the runtime actually renders), in one step. */
  setNodeAsset(nodeId: string, textureId: string | null): void;
  // asset-manager modal (UI-only state, not part of the project / undo)
  assetsOpen: boolean;
  setAssetsOpen(open: boolean): void;
  /** set/clear the painted emission area of the ACTIVE system */
  setMask(mask: EmissionMaskData | null): void;
  /** set/clear the emitter trajectory of the ACTIVE system (preview reads it live) */
  setPath(path: EmitterPathData | null): void;
  /** patch the ACTIVE system's spawn settings (mode / rate / burst) — applied live */
  setEmitter(patch: Partial<EmitterSettings>): void;
  // graph annotations (comment frames + sticky notes, active system)
  addFrame(rect?: { x: number; y: number; w: number; h: number }): void;
  updateFrame(id: string, patch: Partial<Omit<CommentFrame, 'id' | 'systemId'>>): void;
  removeFrame(id: string): void;
  addNote(at?: { x: number; y: number }): void;
  updateNote(id: string, patch: Partial<Omit<StickyNote, 'id' | 'systemId'>>): void;
  removeNote(id: string): void;
  reset(): void;
  newProject(): void;
  importProject(obj: unknown): void;
}

const initial = load();

function persist(project: EditorProject, positions: Record<string, XY>, activeSystemId: string) {
  const out = structuredClone(project);
  out.editor = { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: positions, activeSystemId };
  try {
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    /* ignore */
  }
}

export const useEditor = create<EditorState>((set, get) => {
  const activeSysOf = (p: EditorProject): System =>
    p.systems.find((s) => s.id === get().activeSystemId) ?? p.systems[0]!;

  const commit = (mutate: (p: EditorProject, sys: System) => void, bumpTex = false) => {
    set((s) => {
      const project = structuredClone(s.project);
      mutate(project, activeSysOf(project));
      project.updatedAt = new Date().toISOString();
      persist(project, s.positions, s.activeSystemId);
      return { project, rev: s.rev + 1, ...(bumpTex ? { texRev: s.texRev + 1 } : {}) };
    });
  };

  const loadProject = (raw: EditorProject) => {
    const project = normalize(raw);
    const activeSystemId =
      project.editor?.activeSystemId && project.systems.some((s) => s.id === project.editor!.activeSystemId)
        ? project.editor.activeSystemId
        : project.systems[0]!.id;
    const positions =
      project.editor?.nodePositions && Object.keys(project.editor.nodePositions).length
        ? { ...project.editor.nodePositions }
        : project.systems.reduce<Record<string, XY>>((acc, s) => Object.assign(acc, autoLayout(s.graph)), {});
    persist(project, positions, activeSystemId);
    set((s) => ({ project, positions, activeSystemId, rev: s.rev + 1, texRev: s.texRev + 1, selectedNodeId: null }));
  };

  const initActive =
    initial.editor?.activeSystemId && initial.systems.some((s) => s.id === initial.editor!.activeSystemId)
      ? initial.editor.activeSystemId
      : initial.systems[0]!.id;

  return {
    project: initial,
    positions: { ...(initial.editor?.nodePositions ?? {}) },
    activeSystemId: initActive,
    selectedNodeId: null,
    rev: 0,
    texRev: 0,
    assetsOpen: false,
    system: () => activeSysOf(get().project),
    snapshot: () => {
      const out = structuredClone(get().project);
      out.editor = { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: get().positions, activeSystemId: get().activeSystemId };
      return out;
    },

    addNode(kind, x, y) {
      let newId = '';
      commit((p, sys) => {
        newId = nextNodeId(p);
        const schema = getSchema(V1_CATALOG, kind);
        const values: Record<string, Literal> = {};
        for (const port of schema?.inputs ?? [])
          if (port.defaultValue) values[port.id] = structuredClone(port.defaultValue);
        const structural: Record<string, string> = {};
        for (const st of schema?.structural ?? []) structural[st.key] = st.default;
        const node: Node = { id: newId, kind, values };
        if (Object.keys(structural).length) node.structural = structural;
        sys.graph.nodes.push(node);
      });
      set((s) => ({ positions: { ...s.positions, [newId]: { x, y } }, selectedNodeId: newId }));
      persist(get().project, get().positions, get().activeSystemId);
    },

    moveNode(id, x, y) {
      set((s) => ({ positions: { ...s.positions, [id]: { x, y } } }));
    },

    setValue(nodeId, portId, value) {
      commit((_p, sys) => {
        const node = sys.graph.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        node.values = node.values ?? {};
        node.values[portId] = value;
      });
    },

    setStructural(nodeId, key, value) {
      commit((_p, sys) => {
        const node = sys.graph.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        node.structural = node.structural ?? {};
        node.structural[key] = value;
      });
    },

    connect(from, to) {
      commit((_p, sys) => {
        const g = sys.graph;
        g.edges = g.edges.filter((e) => !(e.to.nodeId === to.nodeId && e.to.portId === to.portId));
        g.edges.push({ id: `e${Date.now()}_${Math.floor(Math.random() * 1e4)}`, from, to });
      });
    },

    deleteNode(id) {
      commit((p, sys) => {
        const g = sys.graph;
        g.nodes = g.nodes.filter((n) => n.id !== id);
        g.edges = g.edges.filter((e) => e.from.nodeId !== id && e.to.nodeId !== id);
        if (p.disabledNodes) p.disabledNodes = p.disabledNodes.filter((x) => x !== id);
      });
      if (get().selectedNodeId === id) set({ selectedNodeId: null });
    },

    toggleNodeDisabled(id) {
      commit((p) => {
        const set0 = new Set(p.disabledNodes ?? []);
        if (set0.has(id)) set0.delete(id);
        else set0.add(id);
        p.disabledNodes = [...set0];
      });
    },

    deleteEdge(id) {
      commit((_p, sys) => {
        sys.graph.edges = sys.graph.edges.filter((e) => e.id !== id);
      });
    },

    select(id) {
      set({ selectedNodeId: id });
    },

    rename(name) {
      commit((p) => {
        p.name = name;
      });
    },

    setActiveSystem(id) {
      if (!get().project.systems.some((s) => s.id === id)) return;
      set({ activeSystemId: id, selectedNodeId: null });
      persist(get().project, get().positions, id);
    },

    addSystem() {
      const p0 = get().project;
      const base = Number(/\d+/.exec(nextNodeId(p0))?.[0] ?? '1');
      const n = p0.systems.length + 1;
      const sys = makeSystem(`emitter ${n}`, base);
      const positions = autoLayout(sys.graph);
      set((s) => {
        const project = structuredClone(s.project);
        project.systems.push(sys);
        project.updatedAt = new Date().toISOString();
        const merged = { ...s.positions, ...positions };
        persist(project, merged, sys.id);
        return { project, positions: merged, activeSystemId: sys.id, selectedNodeId: null, rev: s.rev + 1, texRev: s.texRev + 1 };
      });
    },

    removeSystem(id) {
      const p = get().project;
      if (p.systems.length <= 1) return; // keep at least one emitter
      set((s) => {
        const project = structuredClone(s.project);
        project.systems = project.systems.filter((x) => x.id !== id);
        if (project.systemTextures) delete project.systemTextures[id];
        if (project.systemMasks) delete project.systemMasks[id];
        if (project.systemPaths) delete project.systemPaths[id];
        if (project.annotations) {
          project.annotations.frames = project.annotations.frames.filter((f) => f.systemId !== id);
          project.annotations.notes = project.annotations.notes.filter((n) => n.systemId !== id);
        }
        if (project.subEmitters) {
          delete project.subEmitters[id]; // as a child
          for (const [c, par] of Object.entries(project.subEmitters))
            if (par === id) delete project.subEmitters[c]; // as a parent
        }
        project.updatedAt = new Date().toISOString();
        const activeSystemId = s.activeSystemId === id ? project.systems[0]!.id : s.activeSystemId;
        persist(project, s.positions, activeSystemId);
        return { project, activeSystemId, selectedNodeId: null, rev: s.rev + 1, texRev: s.texRev + 1 };
      });
    },

    renameSystem(id, name) {
      commit((p) => {
        const sys = p.systems.find((x) => x.id === id);
        if (sys) sys.name = name;
      });
    },

    toggleSystem(id) {
      commit((p) => {
        const sys = p.systems.find((x) => x.id === id);
        if (sys) sys.enabled = !sys.enabled;
      }, true);
    },

    setSubParent(childId, parentId) {
      commit((p) => {
        const links = { ...(p.subEmitters ?? {}) };
        if (!parentId || parentId === childId) {
          delete links[childId];
        } else {
          // reject cycles: walk parentId's ancestry, bail if we reach childId
          let cur: string | undefined = parentId;
          const seen = new Set<string>();
          while (cur && !seen.has(cur)) {
            if (cur === childId) return; // would create a loop → no-op
            seen.add(cur);
            cur = links[cur];
          }
          links[childId] = parentId;
        }
        p.subEmitters = links;
      }, true);
    },

    addParam(init) {
      let id = '';
      commit((p) => {
        id = nextParamId(p);
        const def = init?.default?.t === 'f32' ? init.default : { t: 'f32' as const, v: 0 };
        p.params.push({
          id,
          name: uniqueParamName(p, init?.name ?? 'knob'),
          type: 'f32',
          min: init?.min ?? 0,
          max: init?.max ?? 1,
          scale: 'linear',
          default: def,
          ...(init?.unit ? { unit: init.unit } : {}),
          ...(init?.group ? { group: init.group } : {}),
        });
      });
      return id;
    },

    updateParam(id, patch) {
      commit((p) => {
        const pd = p.params.find((x) => x.id === id);
        if (!pd) return;
        if (patch.name !== undefined && patch.name !== pd.name) pd.name = uniqueParamName(p, patch.name);
        if (patch.min !== undefined) pd.min = patch.min;
        if (patch.max !== undefined) pd.max = patch.max;
        if (patch.default !== undefined) pd.default = patch.default;
        if (patch.unit !== undefined) pd.unit = patch.unit || undefined;
        if (patch.group !== undefined) pd.group = patch.group || undefined;
        if (pd.min !== undefined && pd.max !== undefined && pd.max < pd.min) [pd.min, pd.max] = [pd.max, pd.min];
      });
    },

    removeParam(id) {
      commit((p) => {
        p.params = p.params.filter((x) => x.id !== id);
        for (const sys of p.systems) {
          const g = sys.graph;
          const dead = new Set(g.nodes.filter((n) => n.kind === 'param.ref' && n.structural?.param === id).map((n) => n.id));
          if (dead.size) {
            g.nodes = g.nodes.filter((n) => !dead.has(n.id));
            g.edges = g.edges.filter((e) => !dead.has(e.from.nodeId) && !dead.has(e.to.nodeId));
          }
          for (const n of g.nodes) {
            if (!n.knobBindings) continue;
            for (const [port, pid] of Object.entries(n.knobBindings)) if (pid === id) delete n.knobBindings[port];
            if (!Object.keys(n.knobBindings).length) delete n.knobBindings;
          }
        }
      });
    },

    promoteValue(nodeId, portId) {
      commit((p, sys) => {
        const node = sys.graph.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        const schema = getSchema(V1_CATALOG, node.kind);
        const port = schema?.inputs.find((x) => x.id === portId);
        if (!port || port.type !== 'f32') return;
        const lit = node.values?.[portId] ?? port.defaultValue;
        const v = lit?.t === 'f32' ? lit.v : 0;
        const id = nextParamId(p);
        const span = Math.abs(v) || 1;
        p.params.push({
          id,
          name: uniqueParamName(p, `${node.kind.split('.')[1]}_${portId}`),
          type: 'f32',
          min: Math.min(0, v - span),
          max: v + span,
          scale: 'linear',
          default: { t: 'f32', v },
        });
        node.knobBindings = { ...(node.knobBindings ?? {}), [portId]: id };
      });
    },

    unbindKnob(nodeId, portId) {
      commit((_p, sys) => {
        const node = sys.graph.nodes.find((n) => n.id === nodeId);
        if (!node?.knobBindings) return;
        delete node.knobBindings[portId];
        if (!Object.keys(node.knobBindings).length) delete node.knobBindings;
      });
    },

    addTexture(tex) {
      get().addTextureId(tex);
    },

    addTextureId(tex) {
      const id = crypto.randomUUID();
      commit((p, sys) => {
        p.textures = [...(p.textures ?? []), { ...tex, id }];
        p.systemTextures = { ...(p.systemTextures ?? {}), [sys.id]: id };
      }, true);
      return id;
    },

    updateTexture(id, patch) {
      commit((p) => {
        p.textures = (p.textures ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t));
      }, true);
    },

    setNodeAsset(nodeId, textureId) {
      commit((p, sys) => {
        const node = sys.graph.nodes.find((n) => n.id === nodeId);
        if (node) {
          node.structural = node.structural ?? {};
          node.structural.asset = textureId ?? '';
        }
        p.systemTextures = { ...(p.systemTextures ?? {}), [sys.id]: textureId };
      }, true);
    },

    setAssetsOpen(open) {
      set({ assetsOpen: open });
    },

    removeTexture(id) {
      commit((p) => {
        p.textures = (p.textures ?? []).filter((t) => t.id !== id);
        p.systemTextures = Object.fromEntries(
          Object.entries(p.systemTextures ?? {}).map(([k, v]) => [k, v === id ? null : v]),
        );
      }, true);
    },

    setActiveTexture(id) {
      commit((p, sys) => {
        p.systemTextures = { ...(p.systemTextures ?? {}), [sys.id]: id };
      }, true);
    },

    setMask(mask) {
      // masks are construction-time (point-table texture) → full re-create
      commit((p, sys) => {
        p.systemMasks = { ...(p.systemMasks ?? {}), [sys.id]: mask };
      }, true);
    },

    setPath(path) {
      // the preview reads paths live from the project each frame — no re-create
      commit((p, sys) => {
        p.systemPaths = { ...(p.systemPaths ?? {}), [sys.id]: path };
      });
    },

    setEmitter(patch) {
      // rate/mode/burst are runtime clock settings — the preview re-applies them
      // live (engine.apply → clock.setEmitterSettings), no re-create.
      commit((_p, sys) => {
        sys.emitter = { ...sys.emitter, ...patch };
      });
    },

    addFrame(rect) {
      commit((p, sys) => {
        const ann = (p.annotations = p.annotations ?? { frames: [], notes: [] });
        ann.frames.push({
          id: crypto.randomUUID(),
          systemId: sys.id,
          x: rect?.x ?? 0,
          y: rect?.y ?? 0,
          w: rect?.w ?? 420,
          h: rect?.h ?? 260,
          title: 'Comment',
          color: '#a78bfa',
        });
      });
    },

    updateFrame(id, patch) {
      commit((p) => {
        const f = p.annotations?.frames.find((x) => x.id === id);
        if (f) Object.assign(f, patch);
      });
    },

    removeFrame(id) {
      commit((p) => {
        if (p.annotations) p.annotations.frames = p.annotations.frames.filter((x) => x.id !== id);
      });
    },

    addNote(at) {
      commit((p, sys) => {
        const ann = (p.annotations = p.annotations ?? { frames: [], notes: [] });
        ann.notes.push({
          id: crypto.randomUUID(),
          systemId: sys.id,
          x: at?.x ?? 0,
          y: at?.y ?? 0,
          w: 220,
          h: 150,
          text: 'Double-click to edit…',
          color: '#fbbf24',
        });
      });
    },

    updateNote(id, patch) {
      commit((p) => {
        const n = p.annotations?.notes.find((x) => x.id === id);
        if (n) Object.assign(n, patch);
      });
    },

    removeNote(id) {
      commit((p) => {
        if (p.annotations) p.annotations.notes = p.annotations.notes.filter((x) => x.id !== id);
      });
    },

    reset() {
      loadProject(seedProject() as EditorProject);
    },

    newProject() {
      const p = seedProject() as EditorProject;
      p.id = crypto.randomUUID();
      p.name = 'Untitled effect';
      loadProject(p);
    },

    importProject(obj) {
      const p = obj as EditorProject;
      if (!p || typeof p !== 'object' || !Array.isArray(p.systems) || !p.systems.length) {
        throw new Error('Not a pylinka project.');
      }
      loadProject(p);
    },
  };
});
