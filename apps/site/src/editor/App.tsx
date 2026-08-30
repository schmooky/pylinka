import { useEffect, useMemo, useState } from 'react';
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
import { toFlow, FRAME_PREFIX, NOTE_PREFIX } from './graphAdapter';
import { geometryOf, geometrySignature, reconcilePositions } from './reconcile';
import { PylinkaNode } from './components/PylinkaNode';
import { ParamNode } from './components/ParamNode';
import { CommentNode, NoteNode } from './components/AnnotationNodes';
import { GraphMenu, type MenuTarget } from './components/GraphMenu';
import { ConfigModal } from './components/ConfigModal';
import { startTour } from './tour';
import { Preview } from './components/Preview';
import { Systems } from './components/Systems';
import { ProjectsMenu } from './components/ProjectsMenu';
import { AssetManager } from './components/AssetManager';

const nodeTypes = { pylinka: PylinkaNode, param: ParamNode, comment: CommentNode, note: NoteNode };

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
  const importProject = useEditor((s) => s.importProject);
  const updateFrame = useEditor((s) => s.updateFrame);
  const updateNote = useEditor((s) => s.updateNote);
  const removeFrame = useEditor((s) => s.removeFrame);
  const removeNote = useEditor((s) => s.removeNote);
  const setAssetsOpen = useEditor((s) => s.setAssetsOpen);
  // ⌘ on a Mac, Ctrl elsewhere — only for the tooltip text
  const modKey = typeof navigator !== 'undefined' && /Mac|iPad|iPhone/.test(navigator.userAgent);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const pastCount = useEditor((s) => s.past);
  const futureCount = useEditor((s) => s.future);
  const positions = useEditor((s) => s.positions);


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

  /**
   * Undo / redo. Deliberately NOT while the caret is in a text field: the
   * browser's own undo is better there (it steps through what you typed), and
   * stealing the key would make editing a name or a number worse. Everywhere
   * else on the canvas, Ctrl/Cmd+Z walks the editor's own history — which is
   * what a deleted node needs, since the browser has no idea one existed.
   */
  useEffect(() => {
    const isTyping = (el: EventTarget | null): boolean => {
      const t = el as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

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

  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  const { screenToFlowPosition } = useReactFlow();

  // rebuild flow only when the active graph's STRUCTURE changes (not on value scrubs / drags)
  const structureSig = useMemo(() => {
    const g = (project.systems.find((s) => s.id === activeSystemId) ?? project.systems[0]!).graph;
    return JSON.stringify({
      sys: activeSystemId,
      n: g.nodes.map((n) => [n.id, n.kind]),
      e: g.edges.map((e) => [e.id, e.from.nodeId, e.from.portId, e.to.nodeId, e.to.portId]),
      p: project.params.map((p) => p.id),
      // lock state is part of the STRUCTURE here: it decides React Flow's
      // draggable/deletable flags, which are only read when the graph rebuilds
      a: [
        ...(project.annotations?.frames ?? []).map((f) => [f.id, f.locked === true]),
        ...(project.annotations?.notes ?? []).map((n) => [n.id, n.locked === true]),
      ],
    });
  }, [project, activeSystemId]);

  /** Open the graph menu where the pointer is, in both coordinate systems. */
  const openMenu = (e: React.MouseEvent, annotationId?: string) => {
    e.preventDefault();
    setMenu({
      screen: { x: e.clientX, y: e.clientY },
      flow: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
      ...(annotationId !== undefined ? { annotationId } : {}),
    });
  };

  // annotation toolbar: frame wraps the current selection (or drops at the view centre)

  useEffect(() => {
    const f = toFlow(project, useEditor.getState().positions, useEditor.getState().selectedNodeId, activeSystemId);
    setRfNodes(f.nodes);
    setRfEdges(f.edges);
  }, [structureSig]);

  /**
   * Keep the canvas's coordinates in step with the store's — for ANY change,
   * not just an undo. React Flow owns the position of the nodes it draws and
   * only takes ours when the structure changes, so anything that moves a node
   * without adding or removing one (undo/redo of a move, an import, a reset, a
   * re-layout) would otherwise rewind the store behind a canvas still drawing
   * the old place. See reconcile.ts for why this is a no-op during a drag.
   */
  const geomSig = useMemo(
    () => geometrySignature(positions, project.annotations),
    [positions, project.annotations],
  );
  useEffect(() => {
    const want = geometryOf(useEditor.getState().positions, useEditor.getState().project.annotations);
    setRfNodes((ns) => reconcilePositions(ns, want));
  }, [geomSig, setRfNodes]);

  useEffect(() => {
    setRfNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === selectedNodeId })));
  }, [selectedNodeId, setRfNodes]);

  const onConnect = (c: Connection) => {
    if (c.source && c.target && c.sourceHandle && c.targetHandle)
      connect({ nodeId: c.source, portId: c.sourceHandle }, { nodeId: c.target, portId: c.targetHandle });
  };

  return (
    <div className="flex h-screen flex-col">
      {/*
        The bar is deliberately almost empty. Everything that is not an action
        you take constantly — the name, export, the project list — is one click
        deeper in Project, and the product name is not information the person
        using the editor needs on screen.
      */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <span data-tour="project">
          <ProjectsMenu />
        </span>
        <button
          onClick={() => setAssetsOpen(true)}
          className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Textures, sprite sequences and scene references">
          Assets
        </button>
        <button
          onClick={startTour}
          className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Walk through building an effect: emitters, nodes and how to link them">
          Tutorial
        </button>
        <div data-tour="undo" className="ml-auto flex items-center rounded-md border border-border">
          <button
            onClick={undo}
            disabled={pastCount === 0}
            title={`Undo (${modKey ? '\u2318' : 'Ctrl+'}Z) — ${pastCount} step${pastCount === 1 ? '' : 's'} back`}
            aria-label="Undo"
            className="px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent">
            ↶
          </button>
          <button
            onClick={redo}
            disabled={futureCount === 0}
            title={`Redo (${modKey ? '\u21e7\u2318' : 'Ctrl+Shift+'}Z) — ${futureCount} step${futureCount === 1 ? '' : 's'} forward`}
            aria-label="Redo"
            className="border-l border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent">
            ↷
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* an even split: the graph you are editing, and the thing it produces */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-border">
          <Systems />
          <div data-tour="graph" className="relative min-h-0 flex-1">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={(_e, n) => {
              if (n.id.startsWith(FRAME_PREFIX)) updateFrame(n.id.slice(FRAME_PREFIX.length), { x: n.position.x, y: n.position.y });
              else if (n.id.startsWith(NOTE_PREFIX)) updateNote(n.id.slice(NOTE_PREFIX.length), { x: n.position.x, y: n.position.y });
              else moveNode(n.id, n.position.x, n.position.y);
            }}
            onNodesDelete={(ns) =>
              ns.forEach((n) => {
                if (n.id.startsWith(FRAME_PREFIX)) removeFrame(n.id.slice(FRAME_PREFIX.length));
                else if (n.id.startsWith(NOTE_PREFIX)) removeNote(n.id.slice(NOTE_PREFIX.length));
                else deleteNode(n.id);
              })
            }
            onEdgesDelete={(es) => es.forEach((e) => deleteEdge(e.id))}
            onNodeClick={(_e, n) => select(n.id)}
            onPaneClick={() => select(null)}
            onPaneContextMenu={(e) => openMenu(e as unknown as React.MouseEvent)}
            onNodeContextMenu={(e, n) =>
              openMenu(e as unknown as React.MouseEvent, n.id.includes(':') ? n.id : undefined)
            }
            fitView
            minZoom={0.2}
            defaultEdgeOptions={{ animated: true }}
          >
            <Background gap={22} color="color-mix(in oklab, var(--color-border) 70%, transparent)" />
            <Controls showInteractive={false} />
          </ReactFlow>
          {menu && <GraphMenu target={menu} onClose={() => setMenu(null)} />}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <Preview />
        </div>
      </div>
      <AssetManager />
      <ConfigModal />
    </div>
  );
}
