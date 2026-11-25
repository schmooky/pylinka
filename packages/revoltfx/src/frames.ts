/**
 * Sprite geometry shared by the converter and the pixi player.
 *
 * A RevoltFX particle is a pixi Sprite: it draws at its texture's pixel size ×
 * scale and pivots on `anchor`. A Pylinka particle is a square quad, BASE_PX
 * wide at scale 1, centred on the particle. To get the same picture, the player
 * bakes each texture into a square canvas: the original (untrimmed) frame,
 * shifted so its anchor sits at the canvas centre. The converter multiplies
 * every scale by `side / BASE_PX`. Both compute the box with `spriteBox`, so
 * they cannot disagree.
 */
import type { SheetData, SheetFrame } from './types.js';

/** `BASE_SPRITE_PX` in @pylinka/core: the quad edge, in px, at scale 1. */
export const BASE_PX = 8;

/** Size assumed for a texture the converter has no frame data for. */
export const FALLBACK_SIZE = 64;

export interface SpriteBox {
  /** square canvas edge, px */
  side: number;
  /** where the untrimmed source frame's top-left goes inside the square */
  offsetX: number;
  offsetY: number;
  /** untrimmed source size */
  width: number;
  height: number;
}

/** Untrimmed size of a sheet frame. */
export function sourceSize(f: SheetFrame): { w: number; h: number } {
  return f.sourceSize ?? { w: f.frame.w, h: f.frame.h };
}

/**
 * The square that holds a `w × h` sprite with its anchor at the centre.
 * Padding the near side by `w·|1 − 2a|` moves the anchor point to the middle;
 * the result is then centred in a square of the larger edge.
 */
export function spriteBox(w: number, h: number, anchorX = 0.5, anchorY = 0.5): SpriteBox {
  const padX = w * Math.abs(1 - 2 * anchorX);
  const padY = h * Math.abs(1 - 2 * anchorY);
  const bw = w + padX;
  const bh = h + padY;
  const side = Math.max(1, Math.ceil(Math.max(bw, bh)));
  // anchor < 0.5: padding goes on the left/top so the anchor moves right/down
  const leftPad = anchorX < 0.5 ? padX : 0;
  const topPad = anchorY < 0.5 ? padY : 0;
  return {
    side,
    offsetX: (side - bw) / 2 + leftPad,
    offsetY: (side - bh) / 2 + topPad,
    width: w,
    height: h,
  };
}

/**
 * Frame names RevoltFX treats as one movie clip: every `mc_<group>_*` key,
 * in sheet order. This is `FX.parseObject`, which splits on `_` and takes
 * part 1, so `mc_fx-explo_0018` belongs to group `fx-explo`.
 */
export function movieClipFrames(sheet: SheetData | undefined, group: string): string[] {
  if (sheet === undefined) return [];
  return Object.keys(sheet.frames).filter((k) => k.startsWith('mc_') && k.split('_')[1] === group);
}

/**
 * Pixel size of a component: a sprite's frame, or the largest frame of a
 * movie clip (the strip atlas uses one cell size).
 */
export function componentSize(
  sheet: SheetData | undefined,
  componentType: number,
  componentId: string,
): { w: number; h: number } | undefined {
  if (sheet === undefined) return undefined;
  if (componentType === 1) {
    const names = movieClipFrames(sheet, componentId);
    if (names.length === 0) return undefined;
    let w = 0;
    let h = 0;
    for (const n of names) {
      const s = sourceSize(sheet.frames[n]!);
      w = Math.max(w, s.w);
      h = Math.max(h, s.h);
    }
    return { w, h };
  }
  const f = sheet.frames[componentId];
  return f === undefined ? undefined : sourceSize(f);
}
