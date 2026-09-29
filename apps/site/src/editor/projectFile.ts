import { bundleProject, externalizeAssets, unbundleProject } from '@pylinka/format';
import type { EditorProject } from './types';

/**
 * Project files in and out of the editor.
 *
 * Three shapes leave the editor: the full JSON (images inlined as data URIs,
 * one portable file), the minimal JSON (images replaced by `assets/…` paths, for
 * a game that ships its textures itself), and the `.pylinka.zip` bundle (the
 * minimal JSON plus the images and a meta.json). The last two share the same
 * paths, so the minimal JSON drops straight into an unpacked bundle.
 */

export function fileBase(name: string): string {
  return (name || 'effect').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
}

export function download(data: BlobPart, filename: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Comment frames and sticky notes are notes to the editor, not part of the effect. */
function withoutNotes(p: EditorProject): EditorProject {
  const out = { ...p };
  delete out.annotations;
  return out;
}

export function exportFull(p: EditorProject): void {
  download(
    JSON.stringify(withoutNotes(p), null, 2),
    `${fileBase(p.name)}.pylinka.json`,
    'application/json',
  );
}

/** No images, no notes, no whitespace. Returns how many asset bytes were left out. */
export async function exportMinimal(p: EditorProject): Promise<number> {
  const { project, assets } = await externalizeAssets(withoutNotes(p));
  download(JSON.stringify(project), `${fileBase(p.name)}.min.pylinka.json`, 'application/json');
  return assets.reduce((n, a) => n + a.data.length, 0);
}

/** Everything, notes included — a bundle is also how a project moves between editors. */
export async function exportBundle(p: EditorProject): Promise<void> {
  const zip = await bundleProject(p, { generator: 'pylinka-editor' });
  download(zip as BlobPart, `${fileBase(p.name)}.pylinka.zip`, 'application/zip');
}

export function isProjectFile(f: File): boolean {
  return (
    f.name.endsWith('.json') ||
    f.name.endsWith('.zip') ||
    f.type === 'application/json' ||
    f.type === 'application/zip'
  );
}

/** Read a `.pylinka.json` or `.pylinka.zip` into an editor project. */
export async function readProjectFile(f: File): Promise<EditorProject> {
  const isZip =
    f.name.endsWith('.zip') ||
    f.type === 'application/zip' ||
    f.type === 'application/x-zip-compressed';
  if (!isZip) return JSON.parse(await f.text()) as EditorProject;
  const { json } = await unbundleProject(new Uint8Array(await f.arrayBuffer()));
  return JSON.parse(json) as EditorProject;
}
