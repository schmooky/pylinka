/**
 * Port types, for deciding whether a wire is allowed to land.
 *
 * The catalog knows every node's port types; this is just the lookup the canvas
 * needs while a wire is being dragged, kept out of the component so it can be
 * tested and reused.
 */
import { getSchema, V1_CATALOG, type Graph, type PortSpec } from '@pylinka/graph';

/** The declared type of one port, or undefined if there is no such port. */
export function portType(
  graph: Graph,
  nodeId: string,
  portId: string,
  side: 'in' | 'out',
): PortSpec['type'] | undefined {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;
  const schema = getSchema(V1_CATALOG, node.kind);
  if (!schema) return undefined;
  const ports = side === 'in' ? schema.inputs : schema.outputs;
  return ports.find((p) => p.id === portId)?.type;
}
