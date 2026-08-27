/**
 * Scene-reference helpers, kept out of the component file so React Fast Refresh
 * still works on the components that use them (a module mixing components with
 * plain exports loses its refresh boundary).
 */
import { useEditor } from './store';
import { DEFAULT_REFERENCE, type ReferenceSettings } from './types';

/** The project's reference settings, with the defaults filled in. */
export function useReference(): ReferenceSettings {
  const stored = useEditor((s) => s.project.reference);
  return { ...DEFAULT_REFERENCE, ...(stored ?? {}) };
}

function readFile(file: File): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.readAsDataURL(file);
  });
}

/** Load an image file into the reference library and make it the active one. */
export async function addReferenceFile(file: File): Promise<void> {
  const src = await readFile(file);
  const dims = await new Promise<{ w: number; h: number }>((res, rej) => {
    const i = new Image();
    i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
    i.onerror = rej;
    i.src = src;
  });
  useEditor.getState().addReferenceId({
    name: file.name.replace(/\.[^.]+$/, ''),
    src,
    width: dims.w,
    height: dims.h,
  });
}
