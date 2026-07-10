import { create } from 'zustand';
import type { Edge, Literal, Node, System } from '@pylinka/graph';
import { getSchema, V1_CATALOG } from '@pylinka/graph';
import { seedProject } from './seed';
import { autoLayout } from './layout';
import { RECIPES } from '../recipes/data';
import type { EditorProject, EditorTexture } from './types';

const KEY = 'pylinka.editor.project';
type XY = { x: number; y: number };

function forkRecipe(slug: string): EditorProject | undefined {
  const recipe = RECIPES.find((r) => r.slug === slug);
  if (!recipe) return undefined;
  const project = structuredClone(recipe.project) as EditorProject;
  project.id = crypto.randomUUID();
  project.name = recipe.title;
  project.editor = { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: autoLayout(project.systems[0]!.graph) };
  // coin recipes carry an atlas descriptor → seed a texture so the editor shows it
  if (recipe.atlas) {
    const t: EditorTexture = {
      id: crypto.randomUUID(),
      name: recipe.atlas.url.split('/').pop() ?? 'atlas',
      src: recipe.atlas.url,
      width: recipe.atlas.cols * (recipe.atlas.frameW + recipe.atlas.pad),
      height: recipe.atlas.rows * (recipe.atlas.frameH + recipe.atlas.pad),
      cols: recipe.atlas.cols,
      rows: recipe.atlas.rows,
      pad: recipe.atlas.pad,
      fps: recipe.atlas.fps,
      play: recipe.atlas.play,
      pick: recipe.atlas.pick,
    };
    project.textures = [t];
    project.activeTextureId = t.id;
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
    if (raw) return JSON.parse(raw) as EditorProject;
  } catch {
    /* ignore */
  }
  return seedProject() as EditorProject;
}

function nextNodeId(sys: System): string {
  let max = 0;
  for (const n of sys.graph.nodes) {
    const m = /^n(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `n${max + 1}`;
}

interface EditorState {
  project: EditorProject;
  positions: Record<string, XY>;
  selectedNodeId: string | null;
  /** graph/sim changes (preview re-applies live) */
  rev: number;
  /** texture-set changes (preview re-creates the engine) */
  texRev: number;
  system(): System;
  snapshot(): EditorProject;
  addNode(kind: string, x: number, y: number): void;
  moveNode(id: string, x: number, y: number): void;
  setValue(nodeId: string, portId: string, value: Literal): void;
  setStructural(nodeId: string, key: string, value: string): void;
  connect(from: Edge['from'], to: Edge['to']): void;
  deleteNode(id: string): void;
  deleteEdge(id: string): void;
  select(id: string | null): void;
  rename(name: string): void;
  addTexture(tex: Omit<EditorTexture, 'id'>): void;
  removeTexture(id: string): void;
  setActiveTexture(id: string | null): void;
  reset(): void;
  newProject(): void;
  importProject(obj: unknown): void;
}

const initial = load();

function persist(project: EditorProject, positions: Record<string, XY>) {
  const out = structuredClone(project);
  out.editor = { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: positions };
  try {
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    /* ignore */
  }
}

export const useEditor = create<EditorState>((set, get) => {
  const commit = (mutate: (p: EditorProject) => void, bumpTex = false) => {
    set((s) => {
      const project = structuredClone(s.project);
      mutate(project);
      project.updatedAt = new Date().toISOString();
      persist(project, s.positions);
      return { project, rev: s.rev + 1, ...(bumpTex ? { texRev: s.texRev + 1 } : {}) };
    });
  };

  const loadProject = (project: EditorProject) => {
    const positions =
      project.editor?.nodePositions && Object.keys(project.editor.nodePositions).length
        ? { ...project.editor.nodePositions }
        : autoLayout(project.systems[0]!.graph);
    persist(project, positions);
    set((s) => ({ project, positions, rev: s.rev + 1, texRev: s.texRev + 1, selectedNodeId: null }));
  };

  return {
    project: initial,
    positions: { ...(initial.editor?.nodePositions ?? {}) },
    selectedNodeId: null,
    rev: 0,
    texRev: 0,
    system: () => get().project.systems[0]!,
    snapshot: () => {
      const out = structuredClone(get().project);
      out.editor = { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: get().positions };
      return out;
    },

    addNode(kind, x, y) {
      let newId = '';
      commit((p) => {
        const sys = p.systems[0]!;
        newId = nextNodeId(sys);
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
      persist(get().project, get().positions);
    },

    moveNode(id, x, y) {
      set((s) => ({ positions: { ...s.positions, [id]: { x, y } } }));
    },

    setValue(nodeId, portId, value) {
      commit((p) => {
        const node = p.systems[0]!.graph.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        node.values = node.values ?? {};
        node.values[portId] = value;
      });
    },

    setStructural(nodeId, key, value) {
      commit((p) => {
        const node = p.systems[0]!.graph.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        node.structural = node.structural ?? {};
        node.structural[key] = value;
      });
    },

    connect(from, to) {
      commit((p) => {
        const g = p.systems[0]!.graph;
        g.edges = g.edges.filter((e) => !(e.to.nodeId === to.nodeId && e.to.portId === to.portId));
        g.edges.push({ id: `e${Date.now()}_${Math.floor(Math.random() * 1e4)}`, from, to });
      });
    },

    deleteNode(id) {
      commit((p) => {
        const g = p.systems[0]!.graph;
        g.nodes = g.nodes.filter((n) => n.id !== id);
        g.edges = g.edges.filter((e) => e.from.nodeId !== id && e.to.nodeId !== id);
      });
      if (get().selectedNodeId === id) set({ selectedNodeId: null });
    },

    deleteEdge(id) {
      commit((p) => {
        const g = p.systems[0]!.graph;
        g.edges = g.edges.filter((e) => e.id !== id);
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

    addTexture(tex) {
      const id = crypto.randomUUID();
      commit((p) => {
        p.textures = [...(p.textures ?? []), { ...tex, id }];
        p.activeTextureId = id;
      }, true);
    },

    removeTexture(id) {
      commit((p) => {
        p.textures = (p.textures ?? []).filter((t) => t.id !== id);
        if (p.activeTextureId === id) p.activeTextureId = null;
      }, true);
    },

    setActiveTexture(id) {
      commit((p) => {
        p.activeTextureId = id;
      }, true);
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
