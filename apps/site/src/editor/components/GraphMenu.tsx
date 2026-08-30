/**
 * The graph's context menu — everything you do TO the canvas, at the point you
 * are looking at.
 *
 * The node palette used to be a permanent 256px dock. You reach for it a few
 * times per session and it charged rent the whole time, so it now opens where
 * you point: right-click gives a search box and the node list, and a node lands
 * under the cursor instead of at the view centre. Left-click is left alone —
 * it selects and deselects, and a menu that appeared every time you dismissed a
 * selection would be in the way constantly.
 * Comment frames, sticky notes and locking live here too, for the same reason —
 * they are things you do to a spot on the canvas.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { V1_SCHEMAS } from '@pylinka/graph';
import { useEditor } from '../store';
import { NS_LABEL, NS_ORDER, NS_TINT } from '../nsMeta';

export interface MenuTarget {
  /** where the menu opens, in screen px */
  screen: { x: number; y: number };
  /** the same point in flow coordinates — where a new node is dropped */
  flow: { x: number; y: number };
  /** the annotation right-clicked on, if any: 'frame:<id>' / 'note:<id>' */
  annotationId?: string;
}

/** One row in the menu. */
function Row({
  onClick,
  children,
  hint,
  disabled,
}: {
  onClick(): void;
  children: React.ReactNode;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-foreground/90 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent">
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint !== undefined && <span className="shrink-0 text-[10px] text-muted-foreground">{hint}</span>}
    </button>
  );
}

export function GraphMenu({ target, onClose }: { target: MenuTarget; onClose(): void }) {
  const addNode = useEditor((s) => s.addNode);
  const addFrame = useEditor((s) => s.addFrame);
  const addNote = useEditor((s) => s.addNote);
  const updateFrame = useEditor((s) => s.updateFrame);
  const updateNote = useEditor((s) => s.updateNote);
  const lockAnnotations = useEditor((s) => s.lockAnnotations);
  const annotations = useEditor((s) => s.project.annotations);
  const activeSystemId = useEditor((s) => s.activeSystemId);

  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  // close on an outside click or Escape
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as globalThis.Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  /** The node list, filtered and flattened so arrow keys can walk it. */
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    const hit = (s: (typeof V1_SCHEMAS)[number]) =>
      !query ||
      s.kind.toLowerCase().includes(query) ||
      s.label.toLowerCase().includes(query) ||
      (NS_LABEL[s.namespace] ?? s.namespace).toLowerCase().includes(query);
    const order: readonly string[] = NS_ORDER;
    return order.flatMap((ns) =>
      V1_SCHEMAS.filter((s) => s.namespace === ns && hit(s))
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((s) => ({ kind: s.kind, label: s.label, ns })),
    );
  }, [q]);

  const drop = (kind: string) => {
    // the node's own top-left, so it lands under the cursor rather than beside it
    addNode(kind, target.flow.x - 105, target.flow.y - 14);
    onClose();
  };

  const annId = target.annotationId?.split(':')[1];
  const kind = target.annotationId?.split(':')[0];
  const locked =
    kind === 'frame'
      ? annotations?.frames.find((f) => f.id === annId)?.locked === true
      : annotations?.notes.find((n) => n.id === annId)?.locked === true;
  const sysAnnotations = [
    ...(annotations?.frames ?? []).filter((f) => f.systemId === activeSystemId),
    ...(annotations?.notes ?? []).filter((n) => n.systemId === activeSystemId),
  ];
  const allLocked = sysAnnotations.length > 0 && sysAnnotations.every((a) => a.locked === true);

  return (
    <div
      ref={box}
      className="fixed z-50 flex w-64 flex-col rounded-lg border shadow-2xl"
      style={{
        // keep the menu on screen when it opens near an edge
        left: Math.min(target.screen.x, window.innerWidth - 272),
        top: Math.min(target.screen.y, window.innerHeight - 420),
        background: 'var(--color-popover)',
        borderColor: 'var(--color-border)',
        maxHeight: 400,
      }}
      onContextMenu={(e) => e.preventDefault()}>
      <div className="border-b border-border p-1.5">
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, matches.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter' && matches[cursor]) {
              drop(matches[cursor]!.kind);
            }
          }}
          placeholder="Add a node…"
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-foreground/40"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {matches.length === 0 && (
          <div className="px-2 py-3 text-xs text-muted-foreground">No node matches “{q}”.</div>
        )}
        {matches.map((m, i) => (
          <button
            key={m.kind}
            onMouseEnter={() => setCursor(i)}
            onClick={() => drop(m.kind)}
            title={m.kind}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
              i === cursor ? 'bg-accent text-foreground' : 'text-foreground/90'
            }`}>
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-[3px]"
              style={{ background: NS_TINT[m.ns] ?? 'var(--color-muted-foreground)' }}
            />
            <span className="min-w-0 flex-1 truncate">{m.label}</span>
            <code className="shrink-0 text-[9px] text-muted-foreground">{m.kind.split('.')[0]}</code>
          </button>
        ))}
      </div>

      {/* canvas actions — annotations and locking, on the spot they apply to */}
      <div className="border-t border-border p-1">
        <Row
          onClick={() => {
            addFrame({ x: target.flow.x - 210, y: target.flow.y - 130, w: 420, h: 260 });
            onClose();
          }}>
          Add comment frame
        </Row>
        <Row
          onClick={() => {
            addNote({ x: target.flow.x - 110, y: target.flow.y - 75 });
            onClose();
          }}>
          Add sticky note
        </Row>
        {target.annotationId !== undefined && annId !== undefined && (
          <Row
            onClick={() => {
              if (kind === 'frame') updateFrame(annId, { locked: !locked });
              else updateNote(annId, { locked: !locked });
              onClose();
            }}>
            {locked ? 'Unlock this one' : 'Lock this one'}
          </Row>
        )}
        <Row
          disabled={sysAnnotations.length === 0}
          hint={sysAnnotations.length ? `${sysAnnotations.length}` : undefined}
          onClick={() => {
            lockAnnotations(!allLocked);
            onClose();
          }}>
          {allLocked ? 'Unlock all frames & notes' : 'Lock all frames & notes'}
        </Row>
      </div>
    </div>
  );
}
