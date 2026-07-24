/**
 * Brackeys VFX bundle — a curated, CC0 texture catalog shared by the recipe
 * gallery (each `vfx()` recipe binds one of these as its atlas) and the editor's
 * Asset Manager (the "built-in VFX" picker adds them to a project).
 *
 * Textures: CC0 (public domain). Particle sprites by Picster & Kenney,
 * flipbooks by Thomas Iché, pre-drawn sheets by CodeManu. Repackaged by
 * Brackeys. Downscaled + re-sliced to exact grid multiples for clean UVs.
 * See /vfx/CREDITS.txt.
 *
 * `kind` drives the sensible blend default: opaque sprites sit on black, so
 * they READ as light under `add`; alpha sprites carry their own transparency,
 * so they composite under `normal`. Animated `sheet`s are flipbooks/pre-drawn
 * grids — one particle plays the whole animation.
 */

export type VfxKind = 'opaque' | 'alpha' | 'sheet';

export interface VfxAsset {
  /** stable id, used as the recipe key and the built-in picker key */
  key: string;
  /** display name in the Asset Manager */
  name: string;
  /** public URL (served from apps/site/public/vfx) */
  url: string;
  cols: number;
  rows: number;
  frameW: number;
  frameH: number;
  pad: number;
  fps: number;
  play: 'loop' | 'once';
  pick: 'per-particle' | 'per-spawn';
  /** the blend a recipe/system should use to make this texture read right */
  blend: 'add' | 'normal' | 'screen';
  kind: VfxKind;
}

/** Single 128×128 sprite (opaque → additive, or alpha → normal). */
function sprite(dir: 'opaque' | 'alpha', key: string, name: string): VfxAsset {
  const opaque = dir === 'opaque';
  return {
    key, name, url: `/vfx/${dir}/${key}.png`,
    cols: 1, rows: 1, frameW: 128, frameH: 128, pad: 0,
    fps: 1, play: 'loop', pick: 'per-particle',
    blend: opaque ? 'add' : 'normal', kind: opaque ? 'opaque' : 'alpha',
  };
}

/** Animated flipbook / pre-drawn grid — one particle plays the whole sheet. */
function sheet(
  key: string, name: string, cols: number, rows: number, frame: number,
  o: { fps: number; play?: 'loop' | 'once' } ,
): VfxAsset {
  return {
    key, name, url: `/vfx/sheets/${key}.png`,
    cols, rows, frameW: frame, frameH: frame, pad: 0,
    fps: o.fps, play: o.play ?? 'once', pick: 'per-particle',
    blend: 'add', kind: 'sheet',
  };
}

export const VFX_ASSETS: VfxAsset[] = [
  // ── opaque particle sprites (additive) ────────────────────────────────────
  sprite('opaque', 'spark_01', 'Spark 1'),
  sprite('opaque', 'spark_02', 'Spark 2'),
  sprite('opaque', 'spark_03', 'Spark 3'),
  sprite('opaque', 'spark_04', 'Spark 4'),
  sprite('opaque', 'spark_05', 'Spark 5'),
  sprite('opaque', 'spark_06', 'Spark 6'),
  sprite('opaque', 'spark_07', 'Spark 7'),
  sprite('opaque', 'magic_01', 'Magic 1'),
  sprite('opaque', 'magic_02', 'Magic 2'),
  sprite('opaque', 'magic_03', 'Magic 3'),
  sprite('opaque', 'magic_04', 'Magic 4'),
  sprite('opaque', 'magic_05', 'Magic 5'),
  sprite('opaque', 'star_01', 'Star 1'),
  sprite('opaque', 'star_02', 'Star 2'),
  sprite('opaque', 'star_03', 'Star 3'),
  sprite('opaque', 'star_04', 'Star 4'),
  sprite('opaque', 'star_05', 'Star 5'),
  sprite('opaque', 'light_01', 'Light 1'),
  sprite('opaque', 'light_02', 'Light 2'),
  sprite('opaque', 'flare_01', 'Flare'),
  sprite('opaque', 'flame_01', 'Flame 1'),
  sprite('opaque', 'flame_02', 'Flame 2'),
  sprite('opaque', 'flame_03', 'Flame 3'),
  sprite('opaque', 'circle_02', 'Glow Circle'),
  sprite('opaque', 'twirl_01', 'Twirl'),
  sprite('opaque', 'muzzle_01', 'Muzzle'),
  // ── alpha particle sprites (normal blend) ─────────────────────────────────
  sprite('alpha', 'spark_01_a', 'Spark (alpha)'),
  sprite('alpha', 'spark_03_a', 'Spark 3 (alpha)'),
  sprite('alpha', 'magic_01_a', 'Magic (alpha)'),
  sprite('alpha', 'smoke_01_a', 'Smoke 1 (alpha)'),
  sprite('alpha', 'smoke_03_a', 'Smoke 3 (alpha)'),
  sprite('alpha', 'smoke_05_a', 'Smoke 5 (alpha)'),
  sprite('alpha', 'star_01_a', 'Star (alpha)'),
  sprite('alpha', 'dirt_01_a', 'Dirt (alpha)'),
  // ── animated flipbooks (8×8, 64 frames) ───────────────────────────────────
  sheet('explosion_smoke_01_8x8', 'Magic Blast', 8, 8, 96, { fps: 34 }),
  sheet('explosion_01_8x8', 'Explosion 1', 8, 8, 96, { fps: 38 }),
  sheet('explosion_02_8x8', 'Explosion 2', 8, 8, 96, { fps: 38 }),
  sheet('fire_01_8x8', 'Fire Plume 1', 8, 8, 96, { fps: 30 }),
  sheet('fire_02_8x8', 'Fire Plume 2', 8, 8, 96, { fps: 30 }),
  sheet('fire_03_8x8', 'Fire Plume 3', 8, 8, 96, { fps: 30 }),
  sheet('fire_04_8x8', 'Fire Plume 4', 8, 8, 96, { fps: 30 }),
  sheet('wispy_smoke_01_8x8', 'Wispy Smoke 1', 8, 8, 96, { fps: 24 }),
  sheet('wispy_smoke_02_8x8', 'Wispy Smoke 2', 8, 8, 96, { fps: 24 }),
  sheet('wispy_smoke_03_8x8', 'Wispy Smoke 3', 8, 8, 96, { fps: 24 }),
  sheet('cloud_01_8x8', 'Cloud Puff', 8, 8, 96, { fps: 22 }),
  // ── pre-drawn sheets ──────────────────────────────────────────────────────
  sheet('explosion_6x5', 'Cartoon Boom', 6, 5, 128, { fps: 30 }),
  sheet('star_explosion_6x5', 'Star Burst', 6, 5, 128, { fps: 30 }),
  sheet('charge_7x6', 'Power Charge', 7, 6, 128, { fps: 34, play: 'loop' }),
  sheet('vortex_6x5', 'Vortex Portal', 6, 5, 128, { fps: 28, play: 'loop' }),
  sheet('electric_ring_6x5', 'Shock Ring', 6, 5, 128, { fps: 30 }),
  sheet('flame_01_16x4', 'Torch Flame', 16, 4, 64, { fps: 30, play: 'loop' }),
];

export const VFX_BY_KEY: Record<string, VfxAsset> = Object.fromEntries(
  VFX_ASSETS.map((a) => [a.key, a]),
);
