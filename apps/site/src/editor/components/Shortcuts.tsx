/**
 * Every key the editor answers to, in one place.
 *
 * Most of these were only findable by trying them. The list is written from the
 * handlers rather than from memory — the graph ones come from the shortcut
 * effect in App.tsx, the selection and delete keys are React Flow's, and the
 * preview ones are the pointer tools. If a binding changes, this changes.
 */
import { Fragment, useEffect } from 'react';

const MAC = typeof navigator !== 'undefined' && /Mac|iPad|iPhone/.test(navigator.userAgent);
/** ⌘ on a Mac, Ctrl everywhere else. */
const MOD = MAC ? '⌘' : 'Ctrl';

interface Group {
  title: string;
  /** a note about the whole group, when the keys alone would mislead */
  note?: string;
  keys: [string, string][];
}

const GROUPS: Group[] = [
  {
    title: 'Editing',
    note: 'Undo and redo deliberately stay out of the way while you are typing in a field — there the browser’s own undo steps through what you typed, which is better.',
    keys: [
      [`${MOD} Z`, 'Undo'],
      [`${MOD} ⇧ Z  ·  ${MOD} Y`, 'Redo'],
      ['⌫  ·  Del', 'Delete the selected nodes or wires'],
    ],
  },
  {
    title: 'Copy and paste',
    note: 'The clipboard is the system one, holding plain JSON — a selection or a whole emitter can go to another project, another window, or a file.',
    keys: [
      [`${MOD} C`, 'Copy the selected nodes'],
      [`${MOD} D`, 'Duplicate them beside the originals'],
      [`${MOD} V`, 'Paste at the pointer'],
    ],
  },
  {
    title: 'Graph',
    keys: [
      ['Right-click', 'Add a node, a comment frame or a sticky note'],
      ['⇧ drag', 'Box-select'],
      [`${MOD} click`, 'Add to the selection'],
      ['Drag empty canvas', 'Pan'],
      ['Scroll', 'Zoom'],
      ['Space drag', 'Pan without moving anything'],
      ['Drag a number', 'Scrub it'],
    ],
  },
  {
    title: 'Emitters',
    keys: [
      ['Right-click a tab', 'Duplicate, copy, rename, mute, remove'],
      ['Right-click the strip', 'On the empty part: add from a template, paste, or empty'],
    ],
  },
  {
    title: 'Preview',
    keys: [
      ['Scroll', 'Zoom · Fit resets it'],
      ['Drag', 'Pan, with the Pan tool'],
      ['Click', 'Fire a burst there, with the Spawn tool'],
    ],
  },
  {
    title: 'Everywhere',
    keys: [
      ['?', 'This list'],
      ['Esc', 'Close a menu, a modal, or cancel a rename'],
      ['Enter', 'Commit a rename'],
      ['Drop a .json file', 'Import it as a project'],
    ],
  },
];

export function Shortcuts({ onClose }: { onClose(): void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'color-mix(in oklab, var(--color-background) 70%, transparent)' }}
      onClick={onClose}>
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border shadow-2xl"
        style={{ background: 'var(--color-popover)' }}>
        <header className="flex shrink-0 items-center border-b border-border px-4 py-2.5">
          <h2 className="text-[12px] font-medium">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-md px-1.5 py-0.5 text-[13px] leading-none text-muted-foreground hover:bg-accent hover:text-foreground">
            ✕
          </button>
        </header>
        <div className="grid min-h-0 flex-1 gap-x-8 gap-y-5 overflow-y-auto p-4 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {g.title}
              </h3>
              {/*
                One grid rather than a row per pair: the keys are different
                widths, and a per-row flex leaves the descriptions on a ragged
                left edge you have to re-find on every line.
              */}
              <dl className="grid grid-cols-[max-content_1fr] items-baseline gap-x-3 gap-y-1 text-[11px]">
                {g.keys.map(([k, what]) => (
                  <Fragment key={k}>
                    <dt>
                      <kbd
                        className="rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground/90"
                        style={{ background: 'var(--color-accent)' }}>
                        {k}
                      </kbd>
                    </dt>
                    <dd className="min-w-0 text-muted-foreground">{what}</dd>
                  </Fragment>
                ))}
              </dl>
              {g.note !== undefined && (
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/70">{g.note}</p>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
