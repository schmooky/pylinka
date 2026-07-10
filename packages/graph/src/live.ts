/**
 * LIVE(graph) computation (REQUIREMENTS.md §12.1).
 *
 * LIVE(graph) = the set of nodes from which an `output.*` node is reachable by
 * following edges forward, PLUS all `output.*` nodes themselves. Dead nodes
 * (unreachable to any output) are pruned before codegen and excluded from the
 * hash and the slot assignment.
 */
import type { Graph } from './types.js';

/** True for sink nodes. Uses the raw kind prefix (v1 has no output aliases). */
export function isOutputKind(kind: string): boolean {
  return kind.startsWith('output.');
}

/**
 * Ids of all live nodes. Computed by reverse reachability from every output node
 * back along edges (a node is live iff it feeds, transitively, some output).
 */
export function liveNodeIds(graph: Graph): Set<string> {
  const nodeExists = new Set<string>();
  for (const n of graph.nodes) nodeExists.add(n.id);

  // reverse adjacency: consumer nodeId → set of producer nodeIds feeding it
  const producers = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!nodeExists.has(e.from.nodeId) || !nodeExists.has(e.to.nodeId)) continue;
    let list = producers.get(e.to.nodeId);
    if (list === undefined) {
      list = [];
      producers.set(e.to.nodeId, list);
    }
    list.push(e.from.nodeId);
  }

  const live = new Set<string>();
  const stack: string[] = [];
  for (const n of graph.nodes) {
    if (isOutputKind(n.kind)) {
      live.add(n.id);
      stack.push(n.id);
    }
  }

  while (stack.length > 0) {
    const id = stack.pop() as string;
    const ups = producers.get(id);
    if (ups === undefined) continue;
    for (const up of ups) {
      if (!live.has(up)) {
        live.add(up);
        stack.push(up);
      }
    }
  }

  return live;
}
