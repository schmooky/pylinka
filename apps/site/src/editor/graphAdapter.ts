import type { Edge as RFEdge, Node as RFNode } from '@xyflow/react';
import type { EditorProject } from './types';

export type PylinkaFlowNode = RFNode<{ nodeId: string } | { annId: string }>;

/** RF node id prefixes for annotations (graph node ids are /^n\d+$/). */
export const FRAME_PREFIX = 'frame:';
export const NOTE_PREFIX = 'note:';

export function toFlow(
  project: EditorProject,
  positions: Record<string, { x: number; y: number }>,
  selectedNodeId: string | null,
  activeSystemId?: string,
): { nodes: PylinkaFlowNode[]; edges: RFEdge[] } {
  const sys = project.systems.find((s) => s.id === activeSystemId) ?? project.systems[0]!;
  const nodes: PylinkaFlowNode[] = [];
  // comment frames first + negative z, so they render behind the graph nodes
  for (const f of project.annotations?.frames ?? []) {
    if (f.systemId !== sys.id) continue;
    nodes.push({
      id: FRAME_PREFIX + f.id,
      type: 'comment',
      position: { x: f.x, y: f.y },
      zIndex: -10,
      data: { annId: f.id },
    });
  }
  for (const n of sys.graph.nodes) {
    nodes.push({
      id: n.id,
      type: 'pylinka',
      position: positions[n.id] ?? { x: 0, y: 0 },
      selected: n.id === selectedNodeId,
      data: { nodeId: n.id },
    });
  }
  for (const st of project.annotations?.notes ?? []) {
    if (st.systemId !== sys.id) continue;
    nodes.push({
      id: NOTE_PREFIX + st.id,
      type: 'note',
      position: { x: st.x, y: st.y },
      zIndex: 5,
      data: { annId: st.id },
    });
  }
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
