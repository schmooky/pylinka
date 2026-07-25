/**
 * Eval-time resolution + deterministic topological sort (REQUIREMENTS.md §6
 * stages 2–3). Pure.
 *
 * Ordering: ties broken by NATURAL id order (`n7 < n10`) to match the frozen
 * §14.3/§14.4 goldens — see docs/QUESTIONS.md (§6/§12.1 vs §14). This differs
 * from the hash's plain string compare, which is fine: codegen order only needs
 * to be a deterministic function of the hashed data (ids/kinds/edges).
 */
import type { Diagnostic, Graph, Node, NodeCatalog } from '@pylinka/graph';
import { getSchema, isOutputKind, liveNodeIds, resolveKind } from '@pylinka/graph';

/** Output kinds written at spawn (init phase). All other outputs are update. */
const INIT_OUTPUT_KINDS = new Set([
  'output.spawnPosition',
  'output.initVelocity',
  'output.initLife',
  'output.initTexIndex',
  // spawn-time config; consumed by the sub-emit kernel, ignored by buildInit
  'output.deathBurst',
]);

export type Phase = 'init' | 'update';

/** Natural id comparator: numeric suffix compared as a number ("n7" < "n10"). */
export function naturalCompare(a: string, b: string): number {
  const ma = /^(.*?)(\d+)$/.exec(a);
  const mb = /^(.*?)(\d+)$/.exec(b);
  if (ma && mb && ma[1] === mb[1]) {
    const na = Number(ma[2]);
    const nb = Number(mb[2]);
    if (na !== nb) return na - nb;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface EvalResolution {
  /** value (non-output) node ids demanded in each phase, in emit order */
  initValue: string[];
  updateValue: string[];
  /** output node ids per phase, in emit order */
  initOutputs: string[];
  updateOutputs: string[];
}

/**
 * Resolve which live nodes run at init vs update, and return a deterministic
 * emit order per phase. Pushes precise V007 diagnostics when a node's schema
 * eval-time cannot satisfy the demanded phase.
 */
export function resolveEvalTimes(
  graph: Graph,
  catalog: NodeCatalog,
  diagnostics: Diagnostic[],
): EvalResolution {
  const live = liveNodeIds(graph);
  const nodeById = new Map<string, Node>();
  for (const n of graph.nodes) if (live.has(n.id)) nodeById.set(n.id, n);

  // reverse adjacency (consumer → producers) among live nodes
  const producers = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!live.has(e.from.nodeId) || !live.has(e.to.nodeId)) continue;
    const list = producers.get(e.to.nodeId) ?? [];
    list.push(e.from.nodeId);
    producers.set(e.to.nodeId, list);
  }

  const needInit = new Set<string>();
  const needUpdate = new Set<string>();

  // seed from output nodes, propagate demand backward
  const stack: { id: string; phase: Phase }[] = [];
  for (const n of nodeById.values()) {
    if (!isOutputKind(resolveKind(catalog, n.kind))) continue;
    const phase: Phase = INIT_OUTPUT_KINDS.has(resolveKind(catalog, n.kind)) ? 'init' : 'update';
    (phase === 'init' ? needInit : needUpdate).add(n.id);
    for (const p of producers.get(n.id) ?? []) stack.push({ id: p, phase });
  }

  while (stack.length > 0) {
    const { id, phase } = stack.pop() as { id: string; phase: Phase };
    const set = phase === 'init' ? needInit : needUpdate;
    if (set.has(id)) continue;
    set.add(id);
    for (const p of producers.get(id) ?? []) stack.push({ id: p, phase });
  }

  // validate schema eval-time against demanded phase (precise V007)
  for (const n of nodeById.values()) {
    if (isOutputKind(resolveKind(catalog, n.kind))) continue;
    const schema = getSchema(catalog, n.kind);
    const et = schema?.evalTime;
    if (et === 'init' && needUpdate.has(n.id)) {
      diagnostics.push({
        code: 'V007_EVALTIME',
        severity: 'error',
        message: `Node "${n.id}" (${n.kind}) is init-only but its value is needed during update.`,
        nodeId: n.id,
      });
    }
    if (et === 'update' && needInit.has(n.id)) {
      diagnostics.push({
        code: 'V007_EVALTIME',
        severity: 'error',
        message: `Node "${n.id}" (${n.kind}) is update-only but its value is needed at spawn (init).`,
        nodeId: n.id,
      });
    }
  }

  const isOutput = (id: string) => isOutputKind(resolveKind(catalog, nodeById.get(id)!.kind));

  const valueOf = (set: Set<string>) =>
    [...set].filter((id) => !isOutput(id));
  const outputsOf = (set: Set<string>) => [...set].filter(isOutput);

  return {
    initValue: topoSort(valueOf(needInit), graph, live),
    updateValue: topoSort(valueOf(needUpdate), graph, live),
    initOutputs: outputsOf(needInit).sort(naturalCompare),
    updateOutputs: outputsOf(needUpdate).sort(naturalCompare),
  };
}

/**
 * Kahn topological sort restricted to `ids`, ties broken by natural id order.
 * Only edges whose endpoints are both in `ids` constrain the order.
 */
export function topoSort(ids: string[], graph: Graph, live: Set<string>): string[] {
  const inSet = new Set(ids);
  const indeg = new Map<string, number>();
  const succ = new Map<string, string[]>();
  for (const id of ids) {
    indeg.set(id, 0);
    succ.set(id, []);
  }
  for (const e of graph.edges) {
    if (!inSet.has(e.from.nodeId) || !inSet.has(e.to.nodeId)) continue;
    if (!live.has(e.from.nodeId) || !live.has(e.to.nodeId)) continue;
    succ.get(e.from.nodeId)!.push(e.to.nodeId);
    indeg.set(e.to.nodeId, (indeg.get(e.to.nodeId) ?? 0) + 1);
  }

  // ready = indegree-0, kept sorted by natural id order
  const ready = ids.filter((id) => (indeg.get(id) ?? 0) === 0).sort(naturalCompare);
  const out: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift() as string;
    out.push(id);
    for (const s of succ.get(id) ?? []) {
      const d = (indeg.get(s) ?? 0) - 1;
      indeg.set(s, d);
      if (d === 0) {
        // insert keeping natural order
        let i = 0;
        while (i < ready.length && naturalCompare(ready[i] as string, s) < 0) i++;
        ready.splice(i, 0, s);
      }
    }
  }
  return out;
}
