import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import type { EditorProject } from '../types';
import { exportBundle, exportFull, exportMinimal, readProjectFile } from '../projectFile';

/**
 * The "Project" menu — the editor's only chrome besides Assets.
 *
 * It holds a small localStorage library (save / load / delete / duplicate),
 * file import and export, and the door into Settings. Everything that is not
 * an action you take constantly lives here rather than in the header, which is
 * why the header has room to be almost empty.
 */
const LIB_KEY = 'pylinka.editor.library';

interface LibEntry {
  id: string;
  name: string;
  updatedAt: string;
  data: EditorProject;
}

function readLib(): LibEntry[] {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (raw) return JSON.parse(raw) as LibEntry[];
  } catch {
    /* ignore */
  }
  return [];
}

/** Returns whether the write landed — the caller must not claim a save it did not get. */
function writeLib(lib: LibEntry[]): boolean {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(lib));
    return true;
  } catch (e) {
    alert('Could not save to the project library (storage full?): ' + (e as Error).message);
    return false;
  }
}

export function ProjectsMenu() {
  const snapshot = useEditor((s) => s.snapshot);
  const importProject = useEditor((s) => s.importProject);
  const newProject = useEditor((s) => s.newProject);
  const reset = useEditor((s) => s.reset);
  const projectName = useEditor((s) => s.project.name);
  const setConfigOpen = useEditor((s) => s.setConfigOpen);
  const setConfigSection = useEditor((s) => s.setConfigSection);
  const markSaved = useEditor((s) => s.markSaved);
  const [open, setOpen] = useState(false);
  const [lib, setLib] = useState<LibEntry[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setLib(readLib());
  }, [open]);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const saveCurrent = () => {
    const p = snapshot();
    const entry: LibEntry = { id: p.id, name: p.name, updatedAt: new Date().toISOString(), data: p };
    const next = [entry, ...readLib().filter((e) => e.id !== p.id)].slice(0, 30);
    if (writeLib(next)) markSaved();
    setLib(next);
  };

  const load = (e: LibEntry) => {
    importProject(structuredClone(e.data));
    setOpen(false);
  };

  const remove = (id: string) => {
    const next = readLib().filter((e) => e.id !== id);
    writeLib(next);
    setLib(next);
  };

  const duplicate = () => {
    const p = snapshot();
    p.id = crypto.randomUUID();
    p.name = `${p.name} copy`;
    importProject(p);
    setOpen(false);
  };

  // a complete file outlives this browser, so it closes the same gap the
  // library does — the header should stop saying the work is unsaved. The
  // minimal JSON is not complete (no images), so it does not count.
  const exportAs = async (write: (p: EditorProject) => void | Promise<unknown>, complete = true) => {
    try {
      await write(snapshot());
      if (complete) markSaved();
      setOpen(false);
    } catch (e) {
      alert('Export failed: ' + (e as Error).message);
    }
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot(), null, 2));
      setOpen(false);
    } catch (e) {
      alert('Clipboard write failed: ' + (e as Error).message);
    }
  };

  const onImportFile = async (file: File) => {
    try {
      importProject(await readProjectFile(file));
      setOpen(false);
    } catch (e) {
      alert('Could not load project: ' + (e as Error).message);
    }
  };

  const item =
    'flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left hover:bg-accent text-foreground/90';

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`rounded-md px-2 py-1 text-[11px] ${open ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
        Project ▾
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-border p-1.5 text-[11px] shadow-2xl" style={{ background: 'var(--color-popover)' }}>
          <button className={item} onClick={() => { setConfigSection('project'); setConfigOpen(true); setOpen(false); }}>
            Settings…
          </button>
          <div className="my-1 border-t border-border" />
          <button className={item} onClick={() => { newProject(); setOpen(false); }}>New project</button>
          <button className={item} onClick={duplicate}>Duplicate “{projectName}”</button>
          <button className={item} onClick={saveCurrent}>Save to library</button>
          <div className="my-1 border-t border-border" />
          {lib.length === 0 && <div className="px-2 py-1.5 text-muted-foreground">No saved projects yet.</div>}
          {lib.map((e) => (
            <div key={e.id} className="group flex items-center gap-1 rounded-md px-1 hover:bg-accent">
              <button className="min-w-0 flex-1 truncate px-1 py-1.5 text-left" title={new Date(e.updatedAt).toLocaleString()} onClick={() => load(e)}>
                {e.name}
              </button>
              <span className="shrink-0 text-[9px] text-muted-foreground">{new Date(e.updatedAt).toLocaleDateString()}</span>
              <button className="shrink-0 px-1 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100" title="Delete from library"
                onClick={() => remove(e.id)}>
                ✕
              </button>
            </div>
          ))}
          <div className="my-1 border-t border-border" />
          <label className={item + ' cursor-pointer'}>
            Import file…
            <input type="file" accept=".json,.zip,application/json,application/zip" className="hidden"
              onChange={(e) => e.target.files?.[0] && void onImportFile(e.target.files[0])} />
          </label>
          <button className={item} onClick={() => void exportAs(exportFull)} title="One self-contained JSON: images inlined, comment frames and sticky notes stripped">
            Export file (no notes)
          </button>
          <button className={item} onClick={() => void exportAs(exportMinimal, false)} title="JSON without images: each one is replaced by an assets/… path. For a game that ships its textures itself">
            Export minimal JSON (no assets)
          </button>
          <button className={item} onClick={() => void exportAs(exportBundle)} title="A .zip with project.json, the images under assets/, and meta.json. Opens again via Import">
            Export bundle (.zip)
          </button>
          <button className={item} onClick={copyJson}>Copy JSON to clipboard</button>
          <div className="my-1 border-t border-border" />
          <button className={item} onClick={() => { reset(); setOpen(false); }}>Reset to example</button>
        </div>
      )}
    </div>
  );
}
