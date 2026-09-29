/**
 * Turning image files into texture fields — shared by the asset manager and the
 * emitter panel, which both add and REPLACE textures.
 */
import type { EditorTexture } from './types';

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

export function readFile(file: File): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.readAsDataURL(file);
  });
}

/** Pack frame images into a 1×N horizontal strip (rows=1, cols=N) — the grid
 *  the runtime animates, one column per frame. Frames are centred in a cell
 *  sized to the largest frame. */
export async function bakeStrip(frames: string[]) {
  const imgs = await Promise.all(frames.map(loadImage));
  const fw = Math.max(1, ...imgs.map((i) => i.naturalWidth));
  const fh = Math.max(1, ...imgs.map((i) => i.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = fw * imgs.length;
  canvas.height = fh;
  const ctx = canvas.getContext('2d')!;
  imgs.forEach((img, i) => {
    ctx.drawImage(img, i * fw + (fw - img.naturalWidth) / 2, (fh - img.naturalHeight) / 2);
  });
  return { src: canvas.toDataURL('image/png'), cols: imgs.length, rows: 1, width: canvas.width, height: canvas.height };
}

/**
 * The patch that swaps a texture's pixels for new files while keeping the
 * texture itself — its id, name, playback settings, and every emitter and node
 * that points at it.
 *
 * Several files become a baked sequence. One file replaces the image; a single
 * sprite stays a single sprite, and a sheet keeps its grid so a re-exported
 * sheet with the same layout drops straight in.
 */
export async function replacementPatch(
  tex: EditorTexture,
  files: File[],
): Promise<Partial<Omit<EditorTexture, 'id'>>> {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (images.length === 0) throw new Error('No image files to replace with.');
  if (images.length > 1) {
    const frames = await Promise.all(images.map(readFile));
    return { ...(await bakeStrip(frames)), frames };
  }
  const src = await readFile(images[0]!);
  const img = await loadImage(src);
  if (tex.frames !== undefined) {
    // a sequence replaced by one image is a sequence of one — keep it editable
    return { ...(await bakeStrip([src])), frames: [src] };
  }
  return { src, width: img.naturalWidth, height: img.naturalHeight, ...gridForReplacement(tex, img.naturalWidth, img.naturalHeight) };
}

/**
 * Whether a replacement image keeps the old sprite-sheet grid.
 *
 * A re-exported sheet with the same layout has the same proportions (at any
 * resolution), and should drop straight in. Anything else — typically a
 * single sprite dropped onto a sheet — would be sliced into the old grid's
 * cells, so it becomes a single sprite instead.
 */
export function gridForReplacement(
  tex: Pick<EditorTexture, 'cols' | 'rows' | 'pad' | 'width' | 'height'>,
  width: number,
  height: number,
): Partial<Pick<EditorTexture, 'cols' | 'rows' | 'pad'>> {
  if (tex.cols * tex.rows <= 1) return {};
  const before = tex.width / Math.max(1, tex.height);
  const after = width / Math.max(1, height);
  if (Math.abs(after - before) / before < 0.02) return {};
  return { cols: 1, rows: 1, pad: 0 };
}
