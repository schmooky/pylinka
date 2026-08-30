import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useDiagnostics } from './diagnostics';
import { copyNodes, readClipboard, writeClipboard } from './clipboard';
import { portType } from './ports';
import { Preview } from './components/Preview';
import { Systems } from './components/Systems';
import { ProjectsMenu } from './components/ProjectsMenu';
import { SaveState } from './components/SaveState';
import { Shortcuts } from './components/Shortcuts';
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
  const dirty = useEditor((s) => s.dirty);
  const saveError = useEditor((s) => s.saveError);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);


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

  /** Graph nodes currently selected on the canvas, annotations excluded. */
  const selectedGraphIds = () =>
    rfNodesRef.current.filter((n) => n.selected && !n.id.includes(':')).map((n) => n.id);

  /**
   * Where a paste lands: under the pointer if it is over the canvas, else the
   * middle of the view. Pasting into the corner you cannot see is the classic
   * way to lose a copy.
   */
  const pasteAt = () => {
    const r = document.querySelector('.react-flow')?.getBoundingClientRect();
    const p = pointerRef.current;
    if (r && p && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom)
      return screenToFlowPosition({ x: p.x, y: p.y });
    return r
      ? screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      : { x: 0, y: 0 };
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
      if (isTyping(e.target)) return;
      // the one binding with no modifier: everything else here is Ctrl/Cmd
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === 'y') {
        e.preventDefault();
        redo();
      } else if (k === 'c' || k === 'd') {
        const s = useEditor.getState();
        const sys = s.project.systems.find((x) => x.id === s.activeSystemId) ?? s.project.systems[0]!;
        const ids = selectedGraphIds();
        if (ids.length === 0) return;
        e.preventDefault();
        const payload = copyNodes(s.project, sys, s.positions, ids);
        if (k === 'c') void writeClipboard(payload);
        else {
          // duplicate lands beside the original rather than on top of it, so
          // the copy is visible without dragging it off first
          const at = s.positions[ids[0]!] ?? { x: 0, y: 0 };
          s.pasteNodes(payload, { x: at.x + 40, y: at.y + 40 });
        }
      } else if (k === 'v') {
        e.preventDefault();
        void (async () => {
          const payload = await readClipboard();
          if (!payload) return;
          const s = useEditor.getState();
          if (payload.kind === 'emitter') s.pasteEmitter(payload);
          else s.pasteNodes(payload, pasteAt());
        })();
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

  /**
   * Ask before closing the tab on work that is not somewhere it can be opened
   * from again.
   *
   * Two different situations, and only the second is a real loss. A `dirty`
   * project IS still in localStorage and comes back on reload — the warning is
   * about the copy that outlives this browser, which is the library or a file.
   * A `saveError` means even that fell through and closing loses everything.
   *
   * Browsers ignore custom text here and show their own wording, so there is no
   * point writing any; the indicator in the header is where the distinction
   * gets explained.
   */
  useEffect(() => {
    if (!dirty && saveError === null) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Safari and older Chrome still want returnValue set to something
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saveError]);

  const [menu, setMenu] = useState<MenuTarget | null>(null);
  // the shortcut handler is registered once, so it reads these through refs
  const rfNodesRef = useRef<RFNode[]>([]);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
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

  rfNodesRef.current = rfNodes;
  useEffect(() => {
    const move = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, []);

  const diags = useDiagnostics();

  /**
   * Refuse a wire whose ends do not agree on a type.
   *
   * The graph would take it and the compiler would reject it a moment later,
   * which is a worse way to learn: the mistake is made, the preview goes red,
   * and the message names a rule rather than the wire you just drew. React Flow
   * greys the target out instead, so the wire simply will not land.
   */
  const isValidConnection = (c: Connection | RFEdge) => {
    if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return false;
    if (c.source === c.target) return false; // a node cannot feed itself
    const g = (project.systems.find((s) => s.id === activeSystemId) ?? project.systems[0]!).graph;
    const from = portType(g, c.source, c.sourceHandle, 'out');
    const to = portType(g, c.target, c.targetHandle, 'in');
    return from !== undefined && to !== undefined && from === to;
  };

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
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <span data-tour="project">
          <ProjectsMenu />
        </span>
        <button
          onClick={() => setAssetsOpen(true)}
          className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Textures, sprite sequences and scene references">
          Assets
        </button>
        <button
          onClick={startTour}
          className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Walk through building an effect: emitters, nodes and how to link them">
          Tutorial
        </button>
        <button
          onClick={() => setShortcutsOpen(true)}
          className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Keyboard shortcuts (?)">
          Keys
        </button>
        <div className="ml-auto flex items-center gap-1">
          <SaveState />
        </div>
        <div data-tour="undo" className="flex items-center gap-0.5">
          <button
            onClick={undo}
            disabled={pastCount === 0}
            title={`Undo (${modKey ? '\u2318' : 'Ctrl+'}Z) — ${pastCount} step${pastCount === 1 ? '' : 's'} back`}
            aria-label="Undo"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent">
            <HistoryIcon />
          </button>
          <button
            onClick={redo}
            disabled={futureCount === 0}
            title={`Redo (${modKey ? '\u21e7\u2318' : 'Ctrl+Shift+'}Z) — ${futureCount} step${futureCount === 1 ? '' : 's'} forward`}
            aria-label="Redo"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent">
            <HistoryIcon flip />
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
            isValidConnection={isValidConnection}
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
            // React Flow only binds Backspace by default, so Delete — the key
            // most people reach for, and the only one on a full keyboard that
            // says what it does — did nothing
            deleteKeyCode={['Backspace', 'Delete']}
            defaultEdgeOptions={{ animated: true }}
          >
            <Background gap={22} color="color-mix(in oklab, var(--color-border) 70%, transparent)" />
            <Controls showInteractive={false} />
          </ReactFlow>
          {/*
            The palette used to be a dock you could not miss. Now that nodes
            come from a menu, nothing on screen says so — this is the one line
            that has to be there, and it steps aside while the menu is open.
          */}
          {diags.loose.length > 0 && (
            <div
              className="pointer-events-none absolute inset-x-2 top-2 z-10 rounded-md border px-2 py-1.5 text-[10px]"
              style={{ borderColor: 'color-mix(in oklab, var(--color-destructive) 40%, transparent)', background: 'color-mix(in oklab, var(--color-background) 88%, transparent)', color: 'var(--color-destructive)' }}>
              {diags.loose.map((d) => d.message).join(' · ')}
            </div>
          )}
          {!menu && (
            <span className="pointer-events-none absolute bottom-2 right-3 z-10 text-[10px] text-muted-foreground/70">
              right-click for nodes
            </span>
          )}
          {menu && <GraphMenu target={menu} onClose={() => setMenu(null)} />}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <Preview />
        </div>
      </div>
      <AssetManager />
      <ConfigModal />
      {shortcutsOpen && <Shortcuts onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

/**
 * Undo / redo. One shape, mirrored — an arrow curving back on itself, which is
 * the gesture both actions describe. Drawn rather than typed: the arrow glyphs
 * that read correctly here (↺ ↻ ⎌) pick up emoji presentation on some systems
 * and land at a different weight from everything else in the bar.
 */
function HistoryIcon({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      {/* the arc: down the left, along the bottom, back up the right */}
      <path d="M3.2 6.4a5 5 0 1 1 .6 5.1" />
      {/* the head, sitting on the tail of the arc */}
      <path d="M3.2 2.9v3.6h3.6" />
    </svg>
  );
}
