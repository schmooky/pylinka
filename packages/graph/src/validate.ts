/**
 * Graph validation (REQUIREMENTS.md §12.3). Pure; returns typed diagnostics.
 * Errors block compile, warnings don't.
 *
 * Scope note: `V007_EVALTIME` / `V008_IMPURE_BOTH` use a conservative check here
 * (clear update-source → init-sink cases). Full eval-time inference lands in the
 * compiler (task C1) and may surface additional cases; the two implementations
 * share the same diagnostic codes. `E201_UNKNOWN_KIND_PRESERVED` is emitted by
 * the parser (`@pylinka/format`), not here — an unknown kind reaching the
 * validator is a plain `V001`.
 */
import { getSchema, resolveKind } from './catalog/index.js';
import {
  ADD_FORCE,
  REQUIRED_OUTPUTS,
  SET_VELOCITY,
  SINGLE_WRITER_OUTPUTS,
} from './catalog/output-classes.js';
import { isOutputKind, liveNodeIds } from './live.js';
import type {
  Diagnostic,
  EvalTime,
  NodeCatalog,
  NodeSchema,
  ParamDef,
  PortType,
  SystemBundle,
} from './types.js';

// ---------------------------------------------------------------------------
// Coercion table (§12.3): edge `from → to`.
//   identical OK · f32 → vec2/vec4 (splat) · color ↔ vec4 · else V002.
// ---------------------------------------------------------------------------
export function coerces(from: PortType, to: PortType): boolean {
  if (from === to) return true;
  if (from === 'f32' && (to === 'vec2' || to === 'vec4')) return true;
  if (from === 'color' && to === 'vec4') return true;
  if (from === 'vec4' && to === 'color') return true;
  return false;
}

/** ParamDef.type → PortType (color/vec2/f32 map 1:1 into the port type space). */
function paramPortType(t: ParamDef['type']): PortType {
  return t;
}

export function validateGraph(bundle: SystemBundle, catalog: NodeCatalog): Diagnostic[] {
  const { system, params, assets } = bundle;
  const graph = system.graph;
  const diags: Diagnostic[] = [];

  const nodeById = new Map<string, (typeof graph.nodes)[number]>();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  const paramById = new Map<string, ParamDef>();
  for (const p of params) paramById.set(p.id, p);
  const assetIds = new Set<string>();
  for (const a of assets) assetIds.add(a.id);

  const schemaById = new Map<string, NodeSchema | undefined>();
  for (const n of graph.nodes) schemaById.set(n.id, getSchema(catalog, n.kind));

  // ---- V001: unknown kind ------------------------------------------------
  for (const n of graph.nodes) {
    if (schemaById.get(n.id) === undefined) {
      diags.push({
        code: 'V001_UNKNOWN_KIND',
        severity: 'error',
        message: `Node "${n.id}" has unknown kind "${n.kind}".`,
        nodeId: n.id,
      });
    }
  }

  // ---- V010 / V011 / V012: reference & param-shape checks ----------------
  for (const p of params) {
    if (p.scale === 'log' && (p.min === undefined || p.min <= 0)) {
      diags.push({
        code: 'V012_BAD_LOG_PARAM',
        severity: 'error',
        message: `Param "${p.name}" uses log scale but min is ${p.min === undefined ? 'undefined' : String(p.min)} (must be > 0).`,
        paramId: p.id,
      });
    }
  }

  for (const n of graph.nodes) {
    // param.ref → structural.param must resolve
    if (resolveKind(catalog, n.kind) === 'param.ref') {
      const pid = n.structural?.param;
      if (pid === undefined || pid === '' || !paramById.has(pid)) {
        diags.push({
          code: 'V010_UNKNOWN_PARAM',
          severity: 'error',
          message: `Node "${n.id}" references unknown param "${pid ?? ''}".`,
          nodeId: n.id,
          ...(pid !== undefined ? { paramId: pid } : {}),
        });
      }
    }
    // knobBindings → each referenced ParamDef must resolve
    if (n.knobBindings !== undefined) {
      for (const portId of Object.keys(n.knobBindings)) {
        const pid = n.knobBindings[portId] as string;
        if (!paramById.has(pid)) {
          diags.push({
            code: 'V010_UNKNOWN_PARAM',
            severity: 'error',
            message: `Node "${n.id}" port "${portId}" is bound to unknown param "${pid}".`,
            nodeId: n.id,
            portId,
            paramId: pid,
          });
        }
      }
    }
    // tex.* → structural.asset must resolve
    if (resolveKind(catalog, n.kind).startsWith('tex.')) {
      const aid = n.structural?.asset;
      if (aid === undefined || aid === '' || !assetIds.has(aid)) {
        diags.push({
          code: 'V011_UNKNOWN_ASSET',
          severity: 'error',
          message: `Node "${n.id}" references unknown asset "${aid ?? ''}".`,
          nodeId: n.id,
          ...(aid !== undefined ? { assetId: aid } : {}),
        });
      }
    }
  }

  // ---- V009: two edges into one input port -------------------------------
  const intoPort = new Map<string, number>();
  for (const e of graph.edges) {
    const key = e.to.nodeId + ' ' + e.to.portId;
    const count = (intoPort.get(key) ?? 0) + 1;
    intoPort.set(key, count);
    if (count === 2) {
      const toNode = nodeById.get(e.to.nodeId);
      diags.push({
        code: 'V009_MULTI_EDGE_INTO_PORT',
        severity: 'error',
        message: `Input port "${e.to.portId}" on node "${e.to.nodeId}"${toNode ? ` (${toNode.kind})` : ''} has more than one incoming edge.`,
        nodeId: e.to.nodeId,
        portId: e.to.portId,
        edgeId: e.id,
      });
    }
  }

  // ---- V002 + V007 + V008: per-edge type & eval-time checks --------------
  const evalOf = (nodeId: string): EvalTime | 'inferred' | undefined =>
    schemaById.get(nodeId)?.evalTime;

  for (const e of graph.edges) {
    const fromSchema = schemaById.get(e.from.nodeId);
    const toSchema = schemaById.get(e.to.nodeId);
    if (fromSchema === undefined || toSchema === undefined) continue; // V001 already flagged

    // resolve source output type (param.ref uses the referenced ParamDef type)
    let fromType: PortType | undefined = fromSchema.outputs.find(
      (o) => o.id === e.from.portId,
    )?.type;
    if (resolveKind(catalog, nodeById.get(e.from.nodeId)?.kind ?? '') === 'param.ref') {
      const pid = nodeById.get(e.from.nodeId)?.structural?.param;
      const def = pid !== undefined ? paramById.get(pid) : undefined;
      if (def !== undefined) fromType = paramPortType(def.type);
    }
    const toType = toSchema.inputs.find((i) => i.id === e.to.portId)?.type;
    if (fromType === undefined || toType === undefined) continue;

    if (!coerces(fromType, toType)) {
      diags.push({
        code: 'V002_TYPE_MISMATCH',
        severity: 'error',
        message: `Edge "${e.id}" connects ${fromType} → ${toType}, which is not allowed (use an explicit conversion node).`,
        edgeId: e.id,
        nodeId: e.to.nodeId,
        portId: e.to.portId,
      });
    }

    // V007: an update-only source cannot feed an init-only consumer.
    const fromEval = evalOf(e.from.nodeId);
    const toEval = evalOf(e.to.nodeId);
    if (fromEval === 'update' && toEval === 'init') {
      diags.push({
        code: 'V007_EVALTIME',
        severity: 'error',
        message: `Node "${e.to.nodeId}" (${toSchema.kind}) evaluates at spawn (init) but its input "${e.to.portId}" needs an update-time value from "${e.from.nodeId}" (${fromSchema.kind}).`,
        nodeId: e.to.nodeId,
        portId: e.to.portId,
        edgeId: e.id,
      });
    }

    // V008: a `both`-eval node must not depend on an update-variant input.
    if (toEval === 'both' && fromEval === 'update') {
      diags.push({
        code: 'V008_IMPURE_BOTH',
        severity: 'error',
        message: `Node "${e.to.nodeId}" (${toSchema.kind}) evaluates at both init and update, so its input "${e.to.portId}" cannot depend on the update-only value from "${e.from.nodeId}" (${fromSchema.kind}).`,
        nodeId: e.to.nodeId,
        portId: e.to.portId,
        edgeId: e.id,
      });
    }
  }

  // ---- V003: directed cycle ----------------------------------------------
  detectCycle(graph.nodes, graph.edges, diags);

  // ---- V004 / V005 / V006: output writer rules ---------------------------
  const writerCounts = new Map<string, number>();
  let hasAddForce = false;
  let hasSetVelocity = false;
  for (const n of graph.nodes) {
    const kind = resolveKind(catalog, n.kind);
    if (!isOutputKind(kind)) continue;
    writerCounts.set(kind, (writerCounts.get(kind) ?? 0) + 1);
    if (kind === ADD_FORCE) hasAddForce = true;
    if (kind === SET_VELOCITY) hasSetVelocity = true;
  }

  for (const req of REQUIRED_OUTPUTS) {
    if ((writerCounts.get(req) ?? 0) === 0) {
      diags.push({
        code: 'V004_MISSING_OUTPUT',
        severity: 'error',
        message: `System "${system.name}" is missing a required "${req}" node.`,
      });
    }
  }

  for (const [kind, count] of writerCounts) {
    if (count > 1 && SINGLE_WRITER_OUTPUTS.has(kind)) {
      diags.push({
        code: 'V005_DUPLICATE_WRITER',
        severity: 'error',
        message: `System "${system.name}" has ${count} "${kind}" nodes, but only one is allowed.`,
      });
    }
  }

  if (hasSetVelocity && hasAddForce) {
    diags.push({
      code: 'V006_SETVEL_WITH_ADDFORCE',
      severity: 'error',
      message: `System "${system.name}" mixes output.setVelocity with output.addForce (mutually exclusive control models).`,
    });
  }

  // ---- W101 / W102 / W103: warnings --------------------------------------
  const live = liveNodeIds(graph);
  for (const n of graph.nodes) {
    if (!live.has(n.id)) {
      diags.push({
        code: 'W103_DEAD_NODE',
        severity: 'warning',
        message: `Node "${n.id}" (${n.kind}) is not connected to any output and will be pruned.`,
        nodeId: n.id,
      });
    }
    const schema = schemaById.get(n.id);
    if (schema !== undefined && schema.impact === 'high' && live.has(n.id)) {
      diags.push({
        code: 'W102_HIGH_IMPACT',
        severity: 'warning',
        message: `Node "${n.id}" (${schema.kind}) has high performance impact.${schema.impactNote ? ' ' + schema.impactNote : ''}`,
        nodeId: n.id,
      });
    }
  }

  const overflow = estimateCapacityOverflow(bundle, nodeById, catalog);
  if (overflow !== undefined) {
    diags.push({
      code: 'W101_CAPACITY_OVERFLOW',
      severity: 'warning',
      message: `Emitter may exceed pool capacity: ~${Math.ceil(overflow.needed)} particles alive (rate ${overflow.rate}/s × max life ${overflow.maxLife}s) vs capacity ${system.capacity}.`,
    });
  }

  return diags;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectCycle(
  nodes: SystemBundle['system']['graph']['nodes'],
  edges: SystemBundle['system']['graph']['edges'],
  diags: Diagnostic[],
): void {
  const adj = new Map<string, string[]>();
  const exists = new Set<string>();
  for (const n of nodes) exists.add(n.id);
  for (const e of edges) {
    if (!exists.has(e.from.nodeId) || !exists.has(e.to.nodeId)) continue;
    let list = adj.get(e.from.nodeId);
    if (list === undefined) {
      list = [];
      adj.set(e.from.nodeId, list);
    }
    list.push(e.to.nodeId);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.id, WHITE);

  const ids = [...exists].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let reported = false;

  const visit = (start: string): void => {
    // iterative DFS to avoid recursion depth issues on large graphs
    const stack: Array<{ id: string; enter: boolean }> = [{ id: start, enter: true }];
    while (stack.length > 0) {
      const frame = stack.pop() as { id: string; enter: boolean };
      if (!frame.enter) {
        color.set(frame.id, BLACK);
        continue;
      }
      if (color.get(frame.id) === BLACK) continue;
      color.set(frame.id, GRAY);
      stack.push({ id: frame.id, enter: false });
      for (const next of adj.get(frame.id) ?? []) {
        const c = color.get(next);
        if (c === GRAY) {
          if (!reported) {
            reported = true;
            diags.push({
              code: 'V003_CYCLE',
              severity: 'error',
              message: `The graph contains a cycle (through node "${next}"). Graphs must be acyclic.`,
              nodeId: next,
            });
          }
        } else if (c === WHITE) {
          stack.push({ id: next, enter: true });
        }
      }
    }
  };

  for (const id of ids) {
    if (color.get(id) === WHITE) visit(id);
  }
}

function estimateCapacityOverflow(
  bundle: SystemBundle,
  nodeById: Map<string, SystemBundle['system']['graph']['nodes'][number]>,
  catalog: NodeCatalog,
): { needed: number; rate: number; maxLife: number } | undefined {
  const { system } = bundle;
  if (system.emitter.mode !== 'flow') return undefined;
  const rate = system.emitter.rate;
  if (rate <= 0) return undefined;

  // Trace output.initLife's `life` input to a statically-known max life.
  const initLife = system.graph.nodes.find((n) => resolveKind(catalog, n.kind) === 'output.initLife');
  if (initLife === undefined) return undefined;
  const lifeEdge = system.graph.edges.find(
    (e) => e.to.nodeId === initLife.id && e.to.portId === 'life',
  );
  let maxLife: number | undefined;
  if (lifeEdge === undefined) {
    const lit = initLife.values?.life;
    if (lit?.t === 'f32') maxLife = lit.v;
  } else {
    const src = nodeById.get(lifeEdge.from.nodeId);
    if (src !== undefined) {
      const k = resolveKind(catalog, src.kind);
      if (k === 'gen.randomRange') {
        const mx = src.values?.max;
        if (mx?.t === 'f32') maxLife = mx.v;
      } else if (k === 'gen.random') {
        maxLife = 1;
      }
    }
  }
  if (maxLife === undefined) return undefined;

  const needed = rate * maxLife;
  if (needed > system.capacity) return { needed, rate, maxLife };
  return undefined;
}
