import { useEffect, useMemo } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
} from '@xyflow/react';
import { useEditor } from './store';
import { toFlow } from './graphAdapter';
import { PylinkaNode } from './components/PylinkaNode';
import { Palette } from './components/Palette';
import { Preview } from './components/Preview';

const nodeTypes = { pylinka: PylinkaNode };

export function App() {
  const project = useEditor((s) => s.project);
  const selectedNodeId = useEditor((s) => s.selectedNodeId);
  const moveNode = useEditor((s) => s.moveNode);
  const connect = useEditor((s) => s.connect);
  const deleteNode = useEditor((s) => s.deleteNode);
  const deleteEdge = useEditor((s) => s.deleteEdge);
  const select = useEditor((s) => s.select);
  const reset = useEditor((s) => s.reset);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<RFEdge>([]);

  // rebuild flow only when graph STRUCTURE changes (not on value scrubs / drags)
  const structureSig = useMemo(() => {
    const g = project.systems[0]!.graph;
    return JSON.stringify({
      n: g.nodes.map((n) => [n.id, n.kind]),
      e: g.edges.map((e) => [e.id, e.from.nodeId, e.from.portId, e.to.nodeId, e.to.portId]),
      p: project.params.map((p) => p.id),
    });
  }, [project]);

  useEffect(() => {
    const f = toFlow(project, useEditor.getState().positions, useEditor.getState().selectedNodeId);
    setRfNodes(f.nodes);
    setRfEdges(f.edges);
  }, [structureSig]);

  useEffect(() => {
    setRfNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === selectedNodeId })));
  }, [selectedNodeId, setRfNodes]);

  const onConnect = (c: Connection) => {
    if (c.source && c.target && c.sourceHandle && c.targetHandle)
      connect({ nodeId: c.source, portId: c.sourceHandle }, { nodeId: c.target, portId: c.targetHandle });
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <span className="grid h-6 w-6 place-items-center rounded-md border border-border bg-card text-[11px]">✨</span>
        <span className="font-semibold tracking-tight">pylinka</span>
        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">editor</span>
        <span className="ml-2 text-sm text-muted-foreground">{project.name}</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={reset} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            Reset to example
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Palette />
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={(_e, n) => moveNode(n.id, n.position.x, n.position.y)}
            onNodesDelete={(ns) => ns.forEach((n) => deleteNode(n.id))}
            onEdgesDelete={(es) => es.forEach((e) => deleteEdge(e.id))}
            onNodeClick={(_e, n) => select(n.id)}
            onPaneClick={() => select(null)}
            fitView
            minZoom={0.2}
            defaultEdgeOptions={{ animated: true }}
          >
            <Background gap={22} color="color-mix(in oklab, var(--color-border) 70%, transparent)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <div className="w-[360px] shrink-0 border-l border-border">
          <Preview />
        </div>
      </div>
    </div>
  );
}
