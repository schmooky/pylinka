/**
 * Copying graph pieces around — and out of the editor entirely.
 *
 * The clipboard payload is plain JSON on the SYSTEM clipboard, not a variable
 * held in a tab. That is the whole point: a selection of nodes or a whole
 * emitter can be pasted into another project, another window, a message to
 * someone, or a file. An in-memory clipboard would have been less code and
 * would only ever have worked in the one place you copied from.
 *
 * Ids are rewritten on paste, never reused. Pasting into the project you copied
 * from is the common case, and reusing an id there would silently merge the
 * copy into the original.
 */
import type { Node, ParamDef, System } from '@pylinka/graph';
import type { EditorProject } from './types';

const TAG = 'pylinka/clipboard@1';

interface NodesPayload {
  tag: typeof TAG;
  kind: 'nodes';
  nodes: Node[];
  edges: System['graph']['edges'];
  /** knobs the copied nodes reference, so a `param.ref` survives the trip */
  params: ParamDef[];
  /** positions relative to the selection's top-left, so paste can place them */
  offsets: Record<string, { x: number; y: number }>;
}

interface EmitterPayload {
  tag: typeof TAG;
  kind: 'emitter';
  system: System;
  params: ParamDef[];
  positions: Record<string, { x: number; y: number }>;
  /** editor extras that belong to the emitter rather than the graph */
  texture?: string | null;
  mask?: EditorProject['systemMasks'] extends Record<string, infer M> ? M : never;
  path?: EditorProject['systemPaths'] extends Record<string, infer P> ? P : never;
}

export type ClipboardPayload = NodesPayload | EmitterPayload;

/** Parse text off the clipboard, returning undefined for anything that is not ours. */
export function parsePayload(text: string): ClipboardPayload | undefined {
  try {
    const v = JSON.parse(text) as ClipboardPayload;
    if (v && typeof v === 'object' && v.tag === TAG && (v.kind === 'nodes' || v.kind === 'emitter'))
      return v;
  } catch {
    /* not JSON, or not ours */
  }
  return undefined;
}

/** A selection of nodes, with the edges BETWEEN them and the knobs they read. */
export function copyNodes(
  project: EditorProject,
  system: System,
  positions: Record<string, { x: number; y: number }>,
  ids: readonly string[],
): NodesPayload {
  const set = new Set(ids);
  const nodes = system.graph.nodes.filter((n) => set.has(n.id));
  // only edges with BOTH ends in the selection — a half-edge would paste as a
  // wire to a node that is not there
  const edges = system.graph.edges.filter((e) => set.has(e.from.nodeId) && set.has(e.to.nodeId));
  const used = new Set(
    nodes.map((n) => n.structural?.param).filter((p): p is string => p !== undefined && p !== ''),
  );
  for (const n of nodes) for (const p of Object.values(n.knobBindings ?? {})) used.add(p);

  let minX = Infinity;
  let minY = Infinity;
  for (const n of nodes) {
    const p = positions[n.id];
    if (!p) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
  }
  const offsets: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const p = positions[n.id] ?? { x: 0, y: 0 };
    offsets[n.id] = { x: p.x - minX, y: p.y - minY };
  }

  return {
    tag: TAG,
    kind: 'nodes',
    nodes: structuredClone(nodes),
    edges: structuredClone(edges),
    params: structuredClone(project.params.filter((p) => used.has(p.id))),
    offsets,
  };
}

/** A whole emitter: its graph, its knobs, and the editor extras hanging off it. */
export function copyEmitter(project: EditorProject, systemId: string): EmitterPayload | undefined {
  const system = project.systems.find((s) => s.id === systemId);
  if (!system) return undefined;
  const ids = system.graph.nodes.map((n) => n.id);
  const { params, offsets } = copyNodes(project, system, project.editor?.nodePositions ?? {}, ids);
  void offsets;
  const positions: Record<string, { x: number; y: number }> = {};
  for (const id of ids) {
    const p = (project.editor?.nodePositions ?? {})[id];
    if (p) positions[id] = { ...p };
  }
  return {
    tag: TAG,
    kind: 'emitter',
    system: structuredClone(system),
    params,
    positions,
    texture: (project.systemTextures ?? {})[systemId] ?? null,
    ...(( project.systemMasks ?? {})[systemId] ? { mask: structuredClone((project.systemMasks ?? {})[systemId]!) } : {}),
    ...(( project.systemPaths ?? {})[systemId] ? { path: structuredClone((project.systemPaths ?? {})[systemId]!) } : {}),
  } as EmitterPayload;
}

/** Put a payload on the system clipboard, falling back to a prompt if blocked. */
export async function writeClipboard(payload: ClipboardPayload): Promise<boolean> {
  const text = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard access needs a secure context and a user gesture; when it is
    // refused, still give the person the text rather than failing silently
    window.prompt('Copy this:', text);
    return false;
  }
}

/** Read a payload off the system clipboard, if it holds one of ours. */
export async function readClipboard(): Promise<ClipboardPayload | undefined> {
  try {
    return parsePayload(await navigator.clipboard.readText());
  } catch {
    return undefined;
  }
}
