import { memo, useRef, useState } from 'react';
import { useReactFlow, type NodeProps } from '@xyflow/react';
import { useEditor } from '../store';
import { ANNOTATION_COLORS } from '../annotate';

/**
 * Graph annotations as React Flow nodes: a UE-style comment FRAME that sits
 * behind the graph nodes, and a Miro-style STICKY NOTE. Both are draggable
 * (whole node), rename/retext on double-click, recolor when selected, and
 * resize via the bottom-right grip.
 */

/** Corner grip that live-resizes locally and commits once on release. */
function ResizeGrip({
  w,
  h,
  min,
  onLive,
  onCommit,
}: {
  w: number;
  h: number;
  min: [number, number];
  onLive(w: number, h: number): void;
  onCommit(w: number, h: number): void;
}) {
  const start = useRef<{ px: number; py: number; w: number; h: number } | null>(null);
  const { getZoom } = useReactFlow();
  const size = (e: React.PointerEvent): [number, number] => {
    const k = getZoom() || 1;
    return [
      Math.max(min[0], start.current!.w + (e.clientX - start.current!.px) / k),
      Math.max(min[1], start.current!.h + (e.clientY - start.current!.py) / k),
    ];
  };
  return (
    <div
      className="nodrag absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
      style={{
        background:
          'linear-gradient(135deg, transparent 50%, color-mix(in oklab, currentColor 45%, transparent) 50%)',
        borderBottomRightRadius: 10,
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        start.current = { px: e.clientX, py: e.clientY, w, h };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const [nw, nh] = size(e);
        onLive(nw, nh);
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const [nw, nh] = size(e);
        start.current = null;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        onCommit(nw, nh);
      }}
    />
  );
}

function Swatches({ current, onPick }: { current: string; onPick(c: string): void }) {
  return (
    <div className="nodrag flex gap-1">
      {ANNOTATION_COLORS.map((c) => (
        <button
          key={c}
          className="h-3 w-3 rounded-full"
          style={{ background: c, outline: c === current ? '1.5px solid var(--color-foreground)' : 'none', outlineOffset: 1 }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

function CommentNodeInner({ data, selected }: NodeProps) {
  const frameId = (data as { annId: string }).annId;
  const frame = useEditor((s) => s.project.annotations?.frames.find((f) => f.id === frameId));
  const updateFrame = useEditor((s) => s.updateFrame);
  const removeFrame = useEditor((s) => s.removeFrame);
  const [editing, setEditing] = useState(false);
  const [live, setLive] = useState<{ w: number; h: number } | null>(null);

  if (!frame) return null;
  const w = live?.w ?? frame.w;
  const h = live?.h ?? frame.h;

  return (
    <div
      className="group/fr relative rounded-xl"
      style={{
        width: w,
        height: h,
        color: frame.color,
        background: `color-mix(in oklab, ${frame.color} ${selected ? 12 : 8}%, transparent)`,
        border: `1.5px ${selected ? 'solid' : 'dashed'} color-mix(in oklab, ${frame.color} ${selected ? 80 : 45}%, transparent)`,
      }}>
      <div
        className="flex items-center gap-2 rounded-t-xl px-3 py-1.5"
        style={{ background: `color-mix(in oklab, ${frame.color} 18%, transparent)` }}>
        {editing ? (
          <input
            autoFocus
            className="nodrag w-full bg-transparent text-[13px] font-semibold outline-none"
            style={{ color: frame.color }}
            defaultValue={frame.title}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              updateFrame(frame.id, { title: e.target.value || 'Comment' });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-semibold"
            style={{ color: frame.color }}
            onDoubleClick={() => setEditing(true)}
            title="Double-click to rename">
            {frame.title}
          </span>
        )}
        <button
          className="nodrag hidden shrink-0 text-[11px] opacity-70 hover:opacity-100 group-hover/fr:block"
          style={{ color: frame.color }}
          title="Delete frame"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => removeFrame(frame.id)}>
          ✕
        </button>
      </div>
      {selected && (
        <div className="absolute -top-6 left-2">
          <Swatches current={frame.color} onPick={(c) => updateFrame(frame.id, { color: c })} />
        </div>
      )}
      <ResizeGrip
        w={frame.w}
        h={frame.h}
        min={[160, 100]}
        onLive={(nw, nh) => setLive({ w: nw, h: nh })}
        onCommit={(nw, nh) => {
          setLive(null);
          updateFrame(frame.id, { w: nw, h: nh });
        }}
      />
    </div>
  );
}

function NoteNodeInner({ data, selected }: NodeProps) {
  const noteId = (data as { annId: string }).annId;
  const note = useEditor((s) => s.project.annotations?.notes.find((n) => n.id === noteId));
  const updateNote = useEditor((s) => s.updateNote);
  const removeNote = useEditor((s) => s.removeNote);
  const [editing, setEditing] = useState(false);
  const [live, setLive] = useState<{ w: number; h: number } | null>(null);

  if (!note) return null;
  const w = live?.w ?? note.w;
  const h = live?.h ?? note.h;

  return (
    <div
      className="group/note relative flex flex-col rounded-md shadow-lg"
      style={{
        width: w,
        height: h,
        color: note.color,
        background: `color-mix(in oklab, ${note.color} 20%, var(--color-card))`,
        border: `1px solid color-mix(in oklab, ${note.color} ${selected ? 85 : 40}%, transparent)`,
        // folded corner
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)',
      }}>
      <div className="flex items-center gap-2 px-2 pt-1.5">
        <span className="text-[9px] font-medium uppercase tracking-wider opacity-70">note</span>
        {selected && <Swatches current={note.color} onPick={(c) => updateNote(note.id, { color: c })} />}
        <button
          className="nodrag ml-auto hidden text-[11px] opacity-70 hover:opacity-100 group-hover/note:block"
          title="Delete note"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => removeNote(note.id)}>
          ✕
        </button>
      </div>
      {editing ? (
        <textarea
          autoFocus
          className="nodrag m-2 mt-1 flex-1 resize-none bg-transparent text-[12px] leading-relaxed text-foreground outline-none"
          defaultValue={note.text}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            updateNote(note.id, { text: e.target.value });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <div
          className="m-2 mt-1 flex-1 overflow-hidden whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/90"
          onDoubleClick={() => setEditing(true)}
          title="Double-click to edit">
          {note.text}
        </div>
      )}
      <ResizeGrip
        w={note.w}
        h={note.h}
        min={[120, 80]}
        onLive={(nw, nh) => setLive({ w: nw, h: nh })}
        onCommit={(nw, nh) => {
          setLive(null);
          updateNote(note.id, { w: nw, h: nh });
        }}
      />
    </div>
  );
}

export const CommentNode = memo(CommentNodeInner);
export const NoteNode = memo(NoteNodeInner);
