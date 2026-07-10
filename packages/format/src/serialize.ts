/**
 * serializeProject (REQUIREMENTS.md §11.6, §8). One format, no binary variant.
 * With `inlineAssets`, blob-referenced assets are base64-inlined as data URIs
 * for a self-contained export; otherwise the document is emitted as-is (blob
 * refs preserved for IndexedDB storage).
 */
import type { Asset, PylinkaProject } from '@pylinka/graph';

export interface SerializeOptions {
  inlineAssets: boolean;
  assetLoader?: (blobId: string) => Promise<Blob>;
}

export async function serializeProject(
  project: PylinkaProject,
  opts: SerializeOptions,
): Promise<string> {
  if (!opts.inlineAssets) {
    return JSON.stringify(project, null, 2);
  }

  const assets: Asset[] = [];
  for (const a of project.assets) {
    if (a.source.kind === 'blob') {
      if (opts.assetLoader === undefined) {
        throw new Error(
          `serializeProject({ inlineAssets: true }) needs an assetLoader to inline blob asset "${a.id}".`,
        );
      }
      const blob = await opts.assetLoader(a.source.blobId);
      assets.push({ ...a, source: { kind: 'inline', src: await blobToDataUri(blob) } });
    } else {
      assets.push(a);
    }
  }

  return JSON.stringify({ ...project, assets }, null, 2);
}

async function blobToDataUri(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = blob.type !== '' ? blob.type : 'application/octet-stream';
  return `data:${mime};base64,${base64(bytes)}`;
}

/** Base64-encode bytes, working in both browser (btoa) and Node (Buffer). */
function base64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    return btoa(bin);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer;
  if (B !== undefined) return B.from(bytes).toString('base64');
  throw new Error('No base64 encoder available in this environment.');
}
