import type { Edge as RFEdge, Node as RFNode } from '@xyflow/react';
import type { PylinkaProject } from '@pylinka/graph';

export type PylinkaFlowNode = RFNode<{ nodeId: string }>;

export function toFlow(
  project: PylinkaProject,
  positions: Record<string, { x: number; y: number }>,
  selectedNodeId: string | null,
): { nodes: PylinkaFlowNode[]; edges: RFEdge[] } {
  const sys = project.systems[0]!;
  const nodes: PylinkaFlowNode[] = sys.graph.nodes.map((n) => ({
    id: n.id,
    type: 'pylinka',
    position: positions[n.id] ?? { x: 0, y: 0 },
    selected: n.id === selectedNodeId,
    data: { nodeId: n.id },
  }));
  const edges: RFEdge[] = sys.graph.edges.map((e) => ({
    id: e.id,
    source: e.from.nodeId,
    sourceHandle: e.from.portId,
    target: e.to.nodeId,
    targetHandle: e.to.portId,
    animated: true,
  }));
  return { nodes, edges };
}
