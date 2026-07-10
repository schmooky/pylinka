import { create } from 'zustand';
import type { Edge, Literal, Node, PylinkaProject, System } from '@pylinka/graph';
import { getSchema, V1_CATALOG } from '@pylinka/graph';
import { seedProject } from './seed';
import { autoLayout } from './layout';
import { RECIPES } from '../recipes/data';

const KEY = 'pylinka.editor.project';
type XY = { x: number; y: number };

/** Fork a recipe into a fresh, laid-out project (open-in-editor flow, §9). */
function forkRecipe(slug: string): PylinkaProject | undefined {
  const recipe = RECIPES.find((r) => r.slug === slug);
  if (!recipe) return undefined;
  const project = structuredClone(recipe.project);
  project.id = crypto.randomUUID();
  project.name = recipe.title;
  project.editor = { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: autoLayout(project.systems[0]!.graph) };
  return project;
}

function load(): PylinkaProject {
  // ?recipe=<slug> → fork that recipe (open-in-editor), persist, strip the param
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
    if (raw) return JSON.parse(raw) as PylinkaProject;
  } catch {
    /* ignore */
  }
  return seedProject();
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
  project: PylinkaProject;
  positions: Record<string, XY>;
  selectedNodeId: string | null;
  /** bumped on every simulation-affecting change so the preview re-applies */
  rev: number;
  system(): System;
  addNode(kind: string, x: number, y: number): void;
  moveNode(id: string, x: number, y: number): void;
  setValue(nodeId: string, portId: string, value: Literal): void;
  setStructural(nodeId: string, key: string, value: string): void;
  connect(from: Edge['from'], to: Edge['to']): void;
  deleteNode(id: string): void;
  deleteEdge(id: string): void;
  select(id: string | null): void;
  reset(): void;
}

const initial = load();

function persist(project: PylinkaProject, positions: Record<string, XY>) {
  const out = structuredClone(project);
  out.editor = { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: positions };
  try {
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    /* ignore */
  }
}

export const useEditor = create<EditorState>((set, get) => {
  /** Apply a graph mutation, bump rev, persist. */
  const commit = (mutate: (p: PylinkaProject) => void) => {
    set((s) => {
      const project = structuredClone(s.project);
      mutate(project);
      project.updatedAt = new Date().toISOString();
      persist(project, s.positions);
      return { project, rev: s.rev + 1 };
    });
  };

  return {
    project: initial,
    positions: { ...(initial.editor?.nodePositions ?? {}) },
    selectedNodeId: null,
    rev: 0,
    system: () => get().project.systems[0]!,

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

    reset() {
      const project = seedProject();
      const positions = { ...(project.editor?.nodePositions ?? {}) };
      persist(project, positions);
      set((s) => ({ project, positions, rev: s.rev + 1, selectedNodeId: null }));
    },
  };
});
