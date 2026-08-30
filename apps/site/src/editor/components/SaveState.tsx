/**
 * What the editor has actually managed to keep.
 *
 * Three different things get called "saved" here and only one of them is a
 * problem, so the indicator says which:
 *
 *  - the WORKING COPY is written to localStorage on every edit and read back on
 *    reload. Closing the tab does not lose it. That is why this stays quiet in
 *    the ordinary case rather than showing a permanent "Saved" badge nothing
 *    can be done about.
 *  - a LIBRARY entry or an exported file is the copy that outlives this
 *    browser. Edits since the last one are what "Unsaved" means here.
 *  - a FAILED write is the real emergency: textures are base64 inside the
 *    project, so a few sprite sheets can pass the origin quota and every write
 *    from then on throws. The work then exists only in this tab.
 */
import { useEditor } from '../store';

export function SaveState() {
  const saveError = useEditor((s) => s.saveError);
  const dirty = useEditor((s) => s.dirty);
  const savedAt = useEditor((s) => s.savedAt);

  if (saveError !== null) {
    return (
      <span
        role="status"
        title={`Autosave failed. ${saveError}`}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
        style={{
          color: 'var(--color-destructive)',
          background: 'color-mix(in oklab, var(--color-destructive) 12%, transparent)',
        }}>
        <span aria-hidden className="text-[13px] leading-none">⚠</span>
        Autosave failed
      </span>
    );
  }

  if (dirty) {
    return (
      <span
        role="status"
        title="Kept in this browser, but not in your project library or a file. Project ▸ Save to library, or Export file."
        className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground">
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--color-muted-foreground)' }}
        />
        Unsaved
      </span>
    );
  }

  // nothing has been saved anywhere yet and nothing has been edited — say
  // nothing rather than claim a save that never happened
  if (savedAt === null) return null;

  return (
    <span
      role="status"
      title={`Saved to the project library at ${new Date(savedAt).toLocaleString()}`}
      className="px-2 py-1 text-[11px] text-muted-foreground/70">
      Saved {new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}
