import type { Graph } from '@pylinka/graph';
import { nodeHeight } from './nodeSize';

/**
 * Simple left-to-right auto-layout for a graph without saved node positions
 * (used when opening a recipe in the editor). Level = longest distance to an
 * output; outputs sit on the right, their producers to the left.
 */
export function autoLayout(graph: Graph): Record<string, { x: number; y: number }> {
  const COL = 300;
  // rows are at least this far apart, and further when a node in the row is
  // taller (previews under the ports) — so nothing overlaps the node below
  const ROW = 132;
  const GAP = 24;
  const isOut = (id: string) => graph.nodes.find((n) => n.id === id)?.kind.startsWith('output.');

  const feeders = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = feeders.get(e.to.nodeId) ?? [];
    list.push(e.from.nodeId);
    feeders.set(e.to.nodeId, list);
  }

  const level = new Map<string, number>();
  const queue: string[] = [];
  for (const n of graph.nodes)
    if (isOut(n.id)) {
      level.set(n.id, 0);
      queue.push(n.id);
    }
  while (queue.length) {
    const id = queue.shift() as string;
    const l = level.get(id)! + 1;
    for (const p of feeders.get(id) ?? []) {
      if (!level.has(p) || level.get(p)! < l) {
        level.set(p, l);
        queue.push(p);
      }
    }
  }

  let maxL = 0;
  for (const v of level.values()) maxL = Math.max(maxL, v);
  for (const n of graph.nodes) if (!level.has(n.id)) level.set(n.id, maxL + 1);
  maxL = 0;
  for (const v of level.values()) maxL = Math.max(maxL, v);

  const byLevel = new Map<number, string[]>();
  for (const n of graph.nodes) {
    const l = level.get(n.id)!;
    const list = byLevel.get(l) ?? [];
    list.push(n.id);
    byLevel.set(l, list);
  }

  const numId = (id: string) => Number(/\d+/.exec(id)?.[0] ?? 0);
  // row i of every column shares one height: the tallest node in that row
  const rowH: number[] = [];
  for (const ids of byLevel.values()) {
    ids.sort((a, b) => numId(a) - numId(b) || (a < b ? -1 : 1));
    ids.forEach((id, i) => {
      const node = graph.nodes.find((n) => n.id === id)!;
      rowH[i] = Math.max(rowH[i] ?? ROW, nodeHeight(node, graph) + GAP);
    });
  }
  const rowY = rowH.reduce<number[]>((acc, h, i) => (acc.push(i === 0 ? 0 : acc[i - 1]! + rowH[i - 1]!), acc), []);
  const pos: Record<string, { x: number; y: number }> = {};
  for (const [lvl, ids] of byLevel) {
    ids.forEach((id, i) => {
      pos[id] = { x: (maxL - lvl) * COL, y: rowY[i]! };
    });
  }
  return pos;
}
