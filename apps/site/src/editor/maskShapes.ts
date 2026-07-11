/**
 * Predefined emission-area shapes: white-on-transparent SVGs as data URLs.
 * Used as one-click presets in the mask editor and as recipe masks — white
 * (opaque) = emit, and gray/soft edges become spawn DENSITY in the runtime.
 */

/** Wrap white shapes in a data-URL SVG (240×240 canvas by default). */
export function svgMask(inner: string, w = 240, h = 240): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g fill="#fff">${inner}</g></svg>`,
  )}`;
}

export const MASK_CIRCLE = svgMask('<circle cx="120" cy="120" r="96"/>');
export const MASK_RING = svgMask('<path d="M120 26 A94 94 0 1 0 120.1 26 Z M120 62 A58 58 0 1 1 119.9 62 Z" fill-rule="evenodd"/>');
export const MASK_HEART = svgMask('<path d="M120 210 C 30 140 10 80 55 48 C 90 24 115 44 120 64 C 125 44 150 24 185 48 C 230 80 210 140 120 210 Z"/>');
export const MASK_STAR = svgMask('<polygon points="120,14 149,86 226,86 164,132 186,206 120,161 54,206 76,132 14,86 91,86"/>');
export const MASK_BOLT = svgMask('<polygon points="134,8 58,132 108,132 94,232 184,94 128,94"/>');
export const MASK_DIAMOND = svgMask('<polygon points="120,16 224,120 120,224 16,120"/>');
export const MASK_CRESCENT = svgMask('<path d="M120 24 A96 96 0 1 0 120 216 A76 76 0 1 1 120 24 Z"/>');
export const MASK_WIN = svgMask('<text x="120" y="152" font-family="Arial, Helvetica, sans-serif" font-size="88" font-weight="900" text-anchor="middle">WIN</text>');

/** Palette shown in the mask editor. */
export const MASK_PRESETS: { name: string; src: string }[] = [
  { name: 'circle', src: MASK_CIRCLE },
  { name: 'ring', src: MASK_RING },
  { name: 'heart', src: MASK_HEART },
  { name: 'star', src: MASK_STAR },
  { name: 'bolt', src: MASK_BOLT },
  { name: 'diamond', src: MASK_DIAMOND },
  { name: 'crescent', src: MASK_CRESCENT },
  { name: 'WIN', src: MASK_WIN },
];
