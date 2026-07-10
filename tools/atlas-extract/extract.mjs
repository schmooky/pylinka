/**
 * Extract the coin flip from the piggy-cash Spine/libgdx atlas and bake tinted
 * colour variants into one pixi spritesheet (frames + animations), one row per
 * colour. Coin only — no cup, no glow. Clean straight alpha.
 *
 *   node extract.mjs
 *
 * Output: ../../apps/site/public/atlas/coins.{png,json}
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '.cache');
const OUT = join(HERE, '../../apps/site/public/atlas');
mkdirSync(SRC, { recursive: true });
mkdirSync(OUT, { recursive: true });

const BASE =
  'https://cdn1.checkingames.com/piggy-cash-sw/5ef28ace-a9d1-44c1-9c5e-ec7dfc42e0b2/spine/game_elements';

async function ensure(name) {
  const p = join(SRC, name);
  if (existsSync(p)) return p;
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`download ${name}: ${res.status}`);
  writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  return p;
}

const atlasPath = await ensure('game_elements.atlas');
const pagePath = await ensure('game_elements.webp');

// ---- parse atlas ----
const regions = {};
let region = null;
for (const raw of readFileSync(atlasPath, 'utf8').split(/\r?\n/)) {
  if (raw === '') continue;
  if (!raw.includes(':')) {
    if (!/\.(webp|png)$/i.test(raw.trim())) {
      region = { name: raw.trim(), rotate: 0 };
      regions[region.name] = region;
    }
    continue;
  }
  const [k, v] = raw.split(':');
  const nums = v.split(',').map((s) => Number(s.trim()));
  if (k.trim() === 'bounds') region.bounds = nums;
  else if (k.trim() === 'offsets') region.offsets = nums;
  else if (k.trim() === 'rotate') region.rotate = Number(v.trim());
}

const page = sharp(pagePath);
async function untrimmed(r) {
  const [x, y, w, h] = r.bounds;
  const [offX, offY, origW, origH] = r.offsets ?? [0, 0, w, h];
  const piece = await page.clone().extract({ left: x, top: y, width: w, height: h }).png().toBuffer();
  return sharp({ create: { width: origW, height: origH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: piece, left: offX, top: origH - offY - h }])
    .png()
    .toBuffer();
}

const CW = 138;
const CH = 138;
const coinFrames = [];
for (let i = 1; i <= 10; i++) coinFrames.push(await untrimmed(regions[`cup/coin/coin_${i}`]));

const VARIANTS = [
  { name: 'gold', tint: null },
  { name: 'ruby', tint: { r: 235, g: 55, b: 80 } },
  { name: 'emerald', tint: { r: 55, g: 205, b: 120 } },
  { name: 'sapphire', tint: { r: 90, g: 140, b: 255 } },
  { name: 'amethyst', tint: { r: 180, g: 100, b: 240 } },
  { name: 'rose', tint: { r: 255, g: 125, b: 185 } },
  { name: 'silver', tint: { r: 220, g: 228, b: 242 }, gray: true },
];
const tinted = async (buf, v) => {
  if (!v.tint) return buf;
  let s = sharp(buf);
  if (v.gray) s = s.grayscale();
  return s.tint(v.tint).png().toBuffer();
};

const PAD = 2;
const atlasW = 10 * (CW + PAD);
const atlasH = VARIANTS.length * (CH + PAD);
const composites = [];
const framesJson = {};
const animations = {};
for (let vi = 0; vi < VARIANTS.length; vi++) {
  const v = VARIANTS[vi];
  const y = vi * (CH + PAD);
  const anim = [];
  for (let fi = 0; fi < 10; fi++) {
    const x = fi * (CW + PAD);
    composites.push({ input: await tinted(coinFrames[fi], v), left: x, top: y });
    const fname = `coin_${v.name}_${fi}`;
    framesJson[fname] = {
      frame: { x, y, w: CW, h: CH },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: CW, h: CH },
      sourceSize: { w: CW, h: CH },
    };
    anim.push(fname);
  }
  animations[`coin_${v.name}`] = anim;
}

await sharp({ create: { width: atlasW, height: atlasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(composites)
  .png()
  .toFile(join(OUT, 'coins.png'));

writeFileSync(
  join(OUT, 'coins.json'),
  JSON.stringify(
    {
      frames: framesJson,
      meta: { app: 'pylinka atlas-extract', image: 'coins.png', format: 'RGBA8888', size: { w: atlasW, h: atlasH }, scale: '1' },
      animations,
      pylinka: { cols: 10, rows: VARIANTS.length, frameW: CW, frameH: CH, pad: PAD, sequences: VARIANTS.map((v) => `coin_${v.name}`) },
    },
    null,
    2,
  ),
);
console.log('wrote coins.png', atlasW + 'x' + atlasH, '·', VARIANTS.map((v) => v.name).join(', '));
