/**
 * Structural graph hashing (REQUIREMENTS.md §12.1).
 *
 * Identical hash ⟺ identical generated-code SHAPE. Value literals, knob
 * values/bindings, editor state, and node positions NEVER affect the hash;
 * connectivity and structural params ALWAYS do. This is the exact boundary of
 * "what recompiles".
 */
import { liveNodeIds } from './live.js';
import type { Graph } from './types.js';

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit over the UTF-8 bytes of `s`, returned as 16-char lowercase hex. */
function fnv1a64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let h = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i] as number);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * Build the canonical string (§12.1), then hash it. Only live nodes and edges
 * with both endpoints live participate. Ordering is fully deterministic:
 *   - nodes sorted by id (plain '<' string compare)
 *   - each node's structural entries sorted by key
 *   - edges sorted by (from.nodeId, from.portId, to.nodeId, to.portId)
 */
export function canonicalGraphString(graph: Graph): string {
  const live = liveNodeIds(graph);

  const nodes = graph.nodes.filter((n) => live.has(n.id));
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let out = 'H1';
  for (const n of nodes) {
    out += '|N|' + n.id + '|' + n.kind;
    if (n.structural !== undefined) {
      const keys = Object.keys(n.structural).sort();
      for (const k of keys) {
        out += '|' + k + '=' + n.structural[k];
      }
    }
  }

  const edges = graph.edges.filter((e) => live.has(e.from.nodeId) && live.has(e.to.nodeId));
  edges.sort((a, b) => {
    if (a.from.nodeId !== b.from.nodeId) return a.from.nodeId < b.from.nodeId ? -1 : 1;
    if (a.from.portId !== b.from.portId) return a.from.portId < b.from.portId ? -1 : 1;
    if (a.to.nodeId !== b.to.nodeId) return a.to.nodeId < b.to.nodeId ? -1 : 1;
    if (a.to.portId !== b.to.portId) return a.to.portId < b.to.portId ? -1 : 1;
    return 0;
  });
  for (const e of edges) {
    out += '|E|' + e.from.nodeId + '.' + e.from.portId + '>' + e.to.nodeId + '.' + e.to.portId;
  }

  return out;
}

/** Stable 16-char hex structural hash of a graph (§12.1). */
export function hashGraph(graph: Graph): string {
  return fnv1a64(canonicalGraphString(graph));
}
