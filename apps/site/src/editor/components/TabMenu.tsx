/**
 * Right-click menu for the emitter strip.
 *
 * Duplicate and copy used to be an icon wedged between the tab's name and its
 * close button — three targets a few pixels apart, one of which deletes the
 * emitter. Destructive and constructive actions should not be neighbours you
 * hit by aim. They live on right-click now, where the strip has room to spell
 * them out, and the tab is back to a name and an ✕.
 *
 * Right-clicking the empty stretch of the strip is where an emitter arrives
 * from: new, or pasted.
 */
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import { copyEmitter, readClipboard, writeClipboard } from '../clipboard';

export interface TabMenuTarget {
  screen: { x: number; y: number };
  /** the tab right-clicked on; absent when the click was on empty strip */
  systemId?: string;
}

function Row({
  onClick,
  children,
  hint,
  disabled,
  danger,
}: {
  onClick(): void;
  children: React.ReactNode;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-3 whitespace-nowrap rounded px-2 py-1.5 text-left text-[11px] hover:bg-accent disabled:opacity-35 disabled:hover:bg-transparent ${
        danger ? 'text-foreground/90 hover:text-destructive' : 'text-foreground/90'
      }`}>
      <span className="min-w-0 flex-1">{children}</span>
      {hint !== undefined && <span className="shrink-0 text-[10px] text-muted-foreground">{hint}</span>}
    </button>
  );
}

export function TabMenu({
  target,
  onClose,
  onRename,
  onTemplates,
}: {
  target: TabMenuTarget;
  onClose(): void;
  onRename(systemId: string): void;
  onTemplates(): void;
}) {
  const project = useEditor((s) => s.project);
  const duplicateSystem = useEditor((s) => s.duplicateSystem);
  const pasteEmitter = useEditor((s) => s.pasteEmitter);
  const removeSystem = useEditor((s) => s.removeSystem);
  const toggleSystem = useEditor((s) => s.toggleSystem);
  const addSystem = useEditor((s) => s.addSystem);
  const box = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState('');

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

  const sys = target.systemId ? project.systems.find((s) => s.id === target.systemId) : undefined;

  const paste = async () => {
    const payload = await readClipboard();
    if (payload?.kind === 'emitter') {
      pasteEmitter(payload);
      onClose();
      return;
    }
    // say why nothing happened rather than closing as if it had
    setNote(
      payload?.kind === 'nodes'
        ? 'The clipboard holds nodes — paste those on the graph.'
        : 'Nothing on the clipboard to paste here.',
    );
  };

  return (
    <div
      ref={box}
      className="fixed z-50 w-52 rounded-lg border p-1 shadow-2xl"
      style={{
        left: Math.min(target.screen.x, window.innerWidth - 216),
        top: Math.min(target.screen.y, window.innerHeight - 200),
        background: 'var(--color-popover)',
        borderColor: 'var(--color-border)',
      }}
      onContextMenu={(e) => e.preventDefault()}>
      {sys !== undefined ? (
        <>
          <Row
            onClick={() => {
              duplicateSystem(sys.id);
              onClose();
            }}>
            Duplicate
          </Row>
          <Row
            onClick={() => {
              const payload = copyEmitter(project, sys.id);
              if (payload) void writeClipboard(payload);
              onClose();
            }}
            hint="as JSON">
            Copy
          </Row>
          <div className="my-1 border-t border-border" />
          <Row
            onClick={() => {
              onRename(sys.id);
              onClose();
            }}>
            Rename
          </Row>
          <Row
            onClick={() => {
              toggleSystem(sys.id);
              onClose();
            }}
            hint={sys.enabled ? 'in the preview' : 'muted'}>
            {sys.enabled ? 'Mute' : 'Unmute'}
          </Row>
          <div className="my-1 border-t border-border" />
          <Row
            danger
            disabled={project.systems.length <= 1}
            onClick={() => {
              removeSystem(sys.id);
              onClose();
            }}>
            Remove
          </Row>
        </>
      ) : (
        <>
          <Row
            onClick={() => {
              onTemplates();
              onClose();
            }}
            hint="sparks, smoke…">
            From a template…
          </Row>
          <Row onClick={() => void paste()} hint="from the clipboard">
            Paste emitter
          </Row>
          <div className="my-1 border-t border-border" />
          <Row
            onClick={() => {
              addSystem();
              onClose();
            }}
            hint="build it yourself">
            Empty emitter
          </Row>
        </>
      )}
      {note !== '' && (
        <p className="px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">{note}</p>
      )}
    </div>
  );
}
