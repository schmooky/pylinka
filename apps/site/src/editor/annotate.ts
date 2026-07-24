/**
 * Graph annotations: shared geometry helpers + the auto-annotator that gives
 * every recipe named, colored comment frames (Spawn / Forces / Look) and a
 * sticky note with the recipe's one-liner — so a forked recipe explains itself.
 */
import { getSchema, V1_CATALOG, type Graph, type PylinkaProject } from '@pylinka/graph';
import type { Annotations, CommentFrame, StickyNote } from './types';

/** Accent palette for frames & notes (mirrors the node namespace tints). */
export const ANNOTATION_COLORS = ['#a78bfa', '#22d3ee', '#34d399', '#fbbf24', '#f87171', '#e879f9', '#94a3b8'];

export const NODE_W = 210;

/** Rendered height of a PylinkaNode (mirror of the component's row constants;
 *  the `ease` structural row is taller because it draws its curve inline). */
export function estimateNodeHeight(kind: string): number {
  const s = getSchema(V1_CATALOG, kind);
  if (!s) return 80;
  const structuralH = s.structural.reduce((a, sp) => a + (sp.key === 'ease' ? 56 : 30), 0);
  return 30 + s.inputs.length * 26 + structuralH + s.outputs.length * 26 + 8;
}

type XY = { x: number; y: number };

/** Padded bounding box of a set of node ids (frame-title space on top). */
export function nodesBBox(
  ids: readonly string[],
  graph: Graph,
  positions: Record<string, XY>,
): { x: number; y: number; w: number; h: number } | undefined {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const id of ids) {
    const p = positions[id];
    if (!p) continue;
    const kind = graph.nodes.find((n) => n.id === id)?.kind ?? '';
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + NODE_W);
    y1 = Math.max(y1, p.y + estimateNodeHeight(kind));
  }
  if (!isFinite(x0)) return undefined;
  const PAD = 26;
  const TITLE = 34;
  return { x: x0 - PAD, y: y0 - PAD - TITLE, w: x1 - x0 + PAD * 2, h: y1 - y0 + PAD * 2 + TITLE };
}

/** Which annotation group an output sink belongs to. */
function groupOfOutput(kind: string): 'spawn' | 'forces' | 'look' | undefined {
  if (['output.spawnPosition', 'output.initLife', 'output.initVelocity', 'output.initTexIndex'].includes(kind))
    return 'spawn';
  if (['output.addForce', 'output.drag', 'output.setVelocity'].includes(kind)) return 'forces';
  if (['output.writeColor', 'output.writeScale', 'output.writeAlpha', 'output.writeRotation'].includes(kind))
    return 'look';
  return undefined;
}

const GROUP_META: Record<'spawn' | 'forces' | 'look', { title: string; color: string }> = {
  spawn: { title: 'Spawn — where & how particles are born', color: '#fbbf24' },
  forces: { title: 'Forces — motion while alive', color: '#34d399' },
  look: { title: 'Look — color & size over life', color: '#22d3ee' },
};

let annId = 0;
const nextId = () => `a${Date.now().toString(36)}${(annId++).toString(36)}`;

/**
 * Classify each output sink + its transitive producers into Spawn / Forces /
 * Look groups and wrap each non-empty group in a comment frame. Optionally
 * drops a sticky note (e.g. the recipe one-liner) above system[0]'s graph.
 */
export function generateAnnotations(
  project: PylinkaProject,
  positions: Record<string, XY>,
  noteText?: string,
): Annotations {
  const frames: CommentFrame[] = [];
  const notes: StickyNote[] = [];

  for (let si = 0; si < project.systems.length; si++) {
    const sys = project.systems[si]!;
    const g = sys.graph;
    const feeders = new Map<string, string[]>();
    for (const e of g.edges) {
      const list = feeders.get(e.to.nodeId) ?? [];
      list.push(e.from.nodeId);
      feeders.set(e.to.nodeId, list);
    }
    const closure = (id: string): string[] => {
      const seen = new Set<string>([id]);
      const stack = [id];
      while (stack.length) {
        for (const p of feeders.get(stack.pop()!) ?? [])
          if (!seen.has(p)) {
            seen.add(p);
            stack.push(p);
          }
      }
      return [...seen];
    };

    const members: Record<'spawn' | 'forces' | 'look', Set<string>> = {
      spawn: new Set(),
      forces: new Set(),
      look: new Set(),
    };
    for (const n of g.nodes) {
      const grp = groupOfOutput(n.kind);
      if (!grp) continue;
      for (const id of closure(n.id)) members[grp].add(id);
    }

    const sysFrames: CommentFrame[] = [];
    for (const grp of ['spawn', 'forces', 'look'] as const) {
      if (members[grp].size === 0) continue;
      const box = nodesBBox([...members[grp]], g, positions);
      if (!box) continue;
      sysFrames.push({ id: nextId(), systemId: sys.id, ...box, ...GROUP_META[grp] });
    }
    // resolve vertical overlaps between stacked frames (upper one yields its
    // bottom padding; the lower keeps its title band)
    sysFrames.sort((a, b) => a.y - b.y);
    for (let i = 1; i < sysFrames.length; i++) {
      const up = sysFrames[i - 1]!;
      const lo = sysFrames[i]!;
      if (up.y + up.h > lo.y - 6) up.h = Math.max(120, lo.y - 6 - up.y);
    }
    frames.push(...sysFrames);

    if (si === 0 && noteText) {
      // above the graph's top-left corner
      let minX = Infinity;
      let minY = Infinity;
      for (const n of g.nodes) {
        const p = positions[n.id];
        if (!p) continue;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
      }
      if (!isFinite(minX)) {
        minX = 0;
        minY = 0;
      }
      notes.push({
        id: nextId(),
        systemId: sys.id,
        x: minX - 26,
        y: minY - 300,
        w: 260,
        h: 150,
        text: noteText,
        color: '#a78bfa',
      });
    }
  }

  return { frames, notes };
}
