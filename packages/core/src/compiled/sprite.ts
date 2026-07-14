/**
 * Particle sprite sources for the compiled render pipelines (§13.8 always
 * samples a texture). When the caller provides no image we bake a soft radial
 * disc so untextured systems look like the interpreted backend's procedural
 * sprite.
 */

/**
 * Base sprite edge in world units: a particle whose `output.writeScale` is 1.0
 * (or a system with no scaleOverLife, whose size defaults to 1) draws as an
 * 8px quad. Matches the interpreted WebGL runtime, which bakes `× 8` into its
 * size uniforms (webgl/params.ts) — without it the compiled backends draw
 * every particle 8× smaller. `rnd.size` stays a normalized scale; the base
 * pixel size is a rendering concern applied via the render size-scale uniform.
 */
export const BASE_SPRITE_PX = 8;

export interface SpriteSource {
  image: TexImageSource;
  width: number;
  height: number;
  /** atlas grid — (1, 1) for a single sprite */
  cols: number;
  rows: number;
}

/** Options accepted by the compiled backends for texturing. */
export interface CompiledAtlasOptions {
  image: TexImageSource;
  /** uniform grid of cells; `output.initTexIndex` picks the cell (§13.8) */
  cols?: number;
  rows?: number;
}

function imageSize(im: TexImageSource): { width: number; height: number } {
  const anyIm = im as { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number };
  return { width: anyIm.naturalWidth ?? anyIm.width ?? 0, height: anyIm.naturalHeight ?? anyIm.height ?? 0 };
}

/** Soft radial disc (white core → transparent edge), straight alpha. */
export function softDisc(size = 64): SpriteSource {
  const cnv =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size, size)
      : (() => {
          const c = document.createElement('canvas');
          c.width = size;
          c.height = size;
          return c;
        })();
  cnv.width = size;
  cnv.height = size;
  const ctx = cnv.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return { image: cnv, width: size, height: size, cols: 1, rows: 1 };
}

/** Resolve the caller's atlas option (or the disc fallback) into a SpriteSource. */
export function resolveSprite(atlas: CompiledAtlasOptions | undefined): SpriteSource {
  if (atlas === undefined) return softDisc();
  const { width, height } = imageSize(atlas.image);
  return { image: atlas.image, width, height, cols: atlas.cols ?? 1, rows: atlas.rows ?? 1 };
}
