/**
 * Emission masks for the compiled backends. A painted image is rasterised into
 * a point table of emitter-relative spawn offsets (px); the emit kernel samples
 * one per spawn instead of the graph's analytic shape. Mirrors the interpreted
 * WebGL builder (webgl/index.ts buildMaskTable) so both backends look the same.
 */

export interface CompiledMaskOptions {
  /** mask image — see `channel` for which pixels emit */
  image: TexImageSource;
  /** world width the mask maps to (px); height defaults to the aspect ratio */
  width: number;
  height?: number;
  /** offset of the mask centre from the emitter (px, default [0, 0]) */
  offset?: [number, number];
  /** 'alpha' | 'luminance' | 'auto' (alpha if the image has transparency) */
  channel?: 'auto' | 'alpha' | 'luminance';
  /** weighted: grey = spawn density (1..4 points); else a hard 50% stencil */
  weighted?: boolean;
}

export interface MaskTable {
  /** emitter-relative xy offsets, one pair per emitting sample */
  points: Float32Array;
  count: number;
}

/** Rasterise an emission mask into an emitter-relative point table. */
export function buildMaskTable(o: CompiledMaskOptions | undefined): MaskTable | undefined {
  if (!o) return undefined;
  const im = o.image as { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number };
  const iw = im.naturalWidth ?? im.width ?? 0;
  const ih = im.naturalHeight ?? im.height ?? 0;
  if (!iw || !ih) return undefined;
  const worldW = o.width;
  const worldH = o.height ?? (worldW * ih) / iw;
  const [ox, oy] = o.offset ?? [0, 0];

  const MAX_SIDE = 192;
  const k = Math.min(1, MAX_SIDE / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * k));
  const h = Math.max(1, Math.round(ih * k));
  const cnv =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  cnv.width = w;
  cnv.height = h;
  const ctx = cnv.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return undefined;
  ctx.drawImage(o.image as CanvasImageSource, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  let channel = o.channel ?? 'auto';
  if (channel === 'auto') {
    channel = 'luminance';
    for (let i = 3; i < px.length; i += 4)
      if (px[i]! < 250) {
        channel = 'alpha';
        break;
      }
  }
  const weighted = o.weighted ?? true;

  const pts: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v =
        channel === 'alpha'
          ? px[i + 3]!
          : ((0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!) * px[i + 3]!) / 255;
      const n = weighted ? (v < 24 ? 0 : Math.max(1, Math.round((v / 255) * 4))) : v > 127 ? 1 : 0;
      for (let j = 0; j < n; j++) {
        pts.push(((x + 0.5) / w - 0.5) * worldW + ox, ((y + 0.5) / h - 0.5) * worldH + oy);
      }
    }
  }
  const count = pts.length / 2;
  return count > 0 ? { points: new Float32Array(pts), count } : undefined;
}

/** Max texture width for the WebGL2 RG32F mask table (matches interpreted). */
export const MASK_TEX_WIDTH = 2048;

/**
 * WebGPU storage-buffer layout: `[count, 0, x0, y0, x1, y1, …]`. The emit
 * kernel reads the count from `maskTbl[0].x` and points at indices 1..N. A
 * no-mask buffer is a single zero header (count 0) so the binding is always
 * valid.
 */
export function maskBufferData(mask: MaskTable | undefined): Float32Array {
  if (!mask || mask.count === 0) return new Float32Array([0, 0]);
  const out = new Float32Array(2 + mask.count * 2);
  out[0] = mask.count;
  out.set(mask.points, 2);
  return out;
}
