import { useEffect, useMemo } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
} from '@xyflow/react';
import { useEditor } from './store';
import { toFlow } from './graphAdapter';
import { PylinkaNode } from './components/PylinkaNode';
import { Palette, DND_KIND } from './components/Palette';
import { Preview } from './components/Preview';
import { Systems } from './components/Systems';
import { ProjectsMenu } from './components/ProjectsMenu';

const nodeTypes = { pylinka: PylinkaNode };

export function App() {
  return (
    <ReactFlowProvider>
      <EditorApp />
    </ReactFlowProvider>
  );
}

function EditorApp() {
  const project = useEditor((s) => s.project);
  const activeSystemId = useEditor((s) => s.activeSystemId);
  const selectedNodeId = useEditor((s) => s.selectedNodeId);
  const moveNode = useEditor((s) => s.moveNode);
  const connect = useEditor((s) => s.connect);
  const deleteNode = useEditor((s) => s.deleteNode);
  const deleteEdge = useEditor((s) => s.deleteEdge);
  const select = useEditor((s) => s.select);
  const rename = useEditor((s) => s.rename);
  const importProject = useEditor((s) => s.importProject);
  const snapshot = useEditor((s) => s.snapshot);

  const exportJson = () => {
    const proj = snapshot();
    const blob = new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(proj.name || 'effect').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.pylinka.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onImportFile = (file: File) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        importProject(JSON.parse(String(r.result)));
      } catch (e) {
        alert('Could not load project: ' + (e as Error).message);
      }
    };
    r.readAsText(file);
  };

  // drop a .pylinka.json anywhere on the editor to import it
  useEffect(() => {
    const isJsonFileDrag = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const over = (e: DragEvent) => {
      if (isJsonFileDrag(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (!f || !(f.type === 'application/json' || f.name.endsWith('.json'))) return;
      e.preventDefault();
      if (confirm(`Import "${f.name}" and replace the current project?`)) onImportFile(f);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useEditor((s) => s.addNode);

  // palette → canvas drag-and-drop
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DND_KIND)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: React.DragEvent) => {
    const kind = e.dataTransfer.getData(DND_KIND);
    if (!kind) return;
    e.preventDefault();
    const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(kind, at.x - 105, at.y - 15); // centre the node on the cursor
  };

  // rebuild flow only when the active graph's STRUCTURE changes (not on value scrubs / drags)
  const structureSig = useMemo(() => {
    const g = (project.systems.find((s) => s.id === activeSystemId) ?? project.systems[0]!).graph;
    return JSON.stringify({
      sys: activeSystemId,
      n: g.nodes.map((n) => [n.id, n.kind]),
      e: g.edges.map((e) => [e.id, e.from.nodeId, e.from.portId, e.to.nodeId, e.to.portId]),
      p: project.params.map((p) => p.id),
    });
  }, [project, activeSystemId]);

  useEffect(() => {
    const f = toFlow(project, useEditor.getState().positions, useEditor.getState().selectedNodeId, activeSystemId);
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
        <a href="/recipes" className="grid h-6 w-6 place-items-center rounded-md border border-border bg-card text-[11px]" title="Recipes">✨</a>
        <span className="font-semibold tracking-tight">pylinka</span>
        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">editor</span>
        <input
          className="ml-2 w-52 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-foreground outline-none hover:border-border focus:border-border"
          value={project.name}
          onChange={(e) => rename(e.target.value)}
          aria-label="Project name"
        />
        <div className="ml-auto flex items-center gap-2 text-xs">
          <ProjectsMenu />
          <button onClick={exportJson} className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">Export</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Palette />
        <div className="flex min-w-0 flex-1 flex-col">
          <Systems />
          <div className="min-h-0 flex-1">
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
            onDragOver={onDragOver}
            onDrop={onDrop}
            fitView
            minZoom={0.2}
            defaultEdgeOptions={{ animated: true }}
          >
            <Background gap={22} color="color-mix(in oklab, var(--color-border) 70%, transparent)" />
            <Controls showInteractive={false} />
          </ReactFlow>
          </div>
        </div>
        <div className="w-[460px] shrink-0 border-l border-border">
          <Preview />
        </div>
      </div>
    </div>
  );
}
