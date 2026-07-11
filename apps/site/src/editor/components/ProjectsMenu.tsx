import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import type { EditorProject } from '../types';

/**
 * "Projects" dropdown: a small localStorage library (save / load / delete /
 * duplicate) plus file import, export, copy-to-clipboard, and reset.
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

function writeLib(lib: LibEntry[]) {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(lib));
  } catch (e) {
    alert('Could not save to the project library (storage full?): ' + (e as Error).message);
  }
}

export function ProjectsMenu() {
  const snapshot = useEditor((s) => s.snapshot);
  const importProject = useEditor((s) => s.importProject);
  const newProject = useEditor((s) => s.newProject);
  const reset = useEditor((s) => s.reset);
  const projectName = useEditor((s) => s.project.name);
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
    writeLib(next);
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

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot(), null, 2));
      setOpen(false);
    } catch (e) {
      alert('Clipboard write failed: ' + (e as Error).message);
    }
  };

  const onImportFile = (file: File) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        importProject(JSON.parse(String(r.result)));
        setOpen(false);
      } catch (e) {
        alert('Could not load project: ' + (e as Error).message);
      }
    };
    r.readAsText(file);
  };

  const item =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent text-foreground/90';

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`rounded-md border px-3 py-1.5 ${open ? 'border-foreground/40 text-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
        Projects ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-card p-1.5 text-xs shadow-2xl">
          <button className={item} onClick={() => { newProject(); setOpen(false); }}>New project</button>
          <button className={item} onClick={duplicate}>Duplicate “{projectName}”</button>
          <button className={item} onClick={saveCurrent}>Save to library</button>
          <div className="my-1 border-t border-border" />
          {lib.length === 0 && <div className="px-2 py-1.5 text-muted-foreground">Library is empty — save the current project.</div>}
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
            <input type="file" accept=".json,application/json" className="hidden"
              onChange={(e) => e.target.files?.[0] && onImportFile(e.target.files[0])} />
          </label>
          <button className={item} onClick={copyJson}>Copy JSON to clipboard</button>
          <div className="my-1 border-t border-border" />
          <button className={item} onClick={() => { reset(); setOpen(false); }}>Reset to example</button>
        </div>
      )}
    </div>
  );
}
