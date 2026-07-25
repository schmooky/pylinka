/**
 * Texture inputs for the pixi runtime (§7.6). A dev in a pixi app already has
 * images — let them hand a URL, a data-URL, a DOM image, or a pixi Texture
 * straight to `createPylinka` instead of reaching into the sim's private
 * `uploadSprite`. Single sprite = a 1×1 grid; an animated sequence = a uniform
 * sprite sheet (cols/rows) with fps/play/pick. Resolved to the compiled
 * backends' `CompiledAtlasOptions` (image + grid + anim).
 */
import type { CompiledAtlasOptions } from '../compiled/sprite.js';

/** A pixi Texture / TextureSource — we read its underlying `resource`. */
interface PixiTextureLike {
  source?: { resource?: TexImageSource };
  resource?: TexImageSource;
}

/** Where a texture's pixels come from. */
export type TextureImage = string | TexImageSource | PixiTextureLike;

/** A texture/atlas the runtime should render particles with. Same grid + anim
 *  knobs as the compiled backends, but the image may be a URL/data-URL or a
 *  pixi Texture (resolved to a DOM image source before upload). */
export interface TextureInput extends Omit<CompiledAtlasOptions, 'image'> {
  image: TextureImage;
}

/** Load a URL / data-URL into an HTMLImageElement (CORS-safe for WebGL upload). */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`pylinka: could not load texture "${src.slice(0, 64)}"`));
    img.src = src;
  });
}

/** Coerce any TextureImage to a DOM TexImageSource the backends can upload. */
export async function toTexImageSource(src: TextureImage): Promise<TexImageSource> {
  if (typeof src === 'string') return loadImage(src);
  // pixi Texture / TextureSource → its underlying resource (ImageBitmap/canvas/…)
  const px = src as PixiTextureLike;
  const resource = px.source?.resource ?? px.resource;
  if (resource !== undefined) return resource;
  return src as TexImageSource;
}

/** Resolve a TextureInput into the compiled backends' atlas options. */
export async function resolveTexture(input: TextureInput): Promise<CompiledAtlasOptions> {
  const image = await toTexImageSource(input.image);
  return { ...input, image };
}
