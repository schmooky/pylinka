/**
 * The set of effects the example apps render — one per Brackeys VFX texture, so
 * the grid shows OPAQUE sprites (additive), ALPHA sprites (normal blend) and
 * animated SHEETS (flipbooks) side by side. Textures are CC0 (see /vfx/CREDITS).
 *
 * A `Scene` is just: which image to load, how to slice/animate it, and the
 * emitter that throws the particles. `buildScenes()` turns the list into one
 * pylinka project (a system per scene) — the apps load the textures however
 * they like (Assets.load / AssetPack) and hand them over by system name.
 */
import { emitter, project, type EmitterOpts } from './scene';
import type { PylinkaProject } from '@pylinka/graph';
import type { TextureInput } from '@pylinka/core/pixi';

export type VfxKind = 'opaque' | 'alpha' | 'sheet';

export interface SceneAtlas {
  cols: number;
  rows: number;
  fps: number;
  play: 'loop' | 'once';
  pick: 'per-particle' | 'per-spawn';
}

export interface Scene {
  /** system name — also the key of the textures map handed to createPylinka */
  name: string;
  /** caption shown under the cell (Fira Code) */
  label: string;
  /** which texture family — drives the badge + which blend reads right */
  kind: VfxKind;
  /** file to load */
  url: string;
  /** grid slicing + playback */
  atlas: SceneAtlas;
  /** additive for opaque/sheets, normal for alpha */
  blend: 'add' | 'normal';
  /** the emitter that throws the particles */
  o: EmitterOpts;
}

const single = (cols = 1, rows = 1): SceneAtlas => ({ cols, rows, fps: 1, play: 'loop', pick: 'per-particle' });
const sheet = (cols: number, rows: number, fps: number, play: 'loop' | 'once' = 'once'): SceneAtlas => ({ cols, rows, fps, play, pick: 'per-particle' });

export const SCENES: Scene[] = [
  // ── opaque sprites → additive ─────────────────────────────────────────────
  { name: 'sparkJet', label: 'spark_01 · opaque', kind: 'opaque', url: '/vfx/opaque/spark_01.png', atlas: single(), blend: 'add',
    o: { rate: 80, velMin: [-40, -200], velMax: [40, -120], lifeMin: 0.8, lifeMax: 1.5, gravity: [0, 240], colorFrom: '#ffe6a8ff', colorTo: '#ff5a0000', colorEase: 'sine.in', scaleFrom: 1.4, scaleTo: 0.5 } },
  { name: 'sparkBurst', label: 'spark_03 · opaque', kind: 'opaque', url: '/vfx/opaque/spark_03.png', atlas: single(), blend: 'add',
    o: { mode: 'burst', burst: { count: 70, interval: 1.3 }, velMin: [-160, -160], velMax: [160, 160], lifeMin: 0.7, lifeMax: 1.2, gravity: [0, 120], drag: 0.7, colorFrom: '#c3f0ffff', colorTo: '#1f6bff00', colorEase: 'sine.in', scaleFrom: 1.6, scaleTo: 0.4 } },
  { name: 'magicSwirl', label: 'magic_03 · opaque', kind: 'opaque', url: '/vfx/opaque/magic_03.png', atlas: single(), blend: 'add',
    o: { rate: 120, shape: 'circle', radius: 26, velMin: [-10, -10], velMax: [10, 10], lifeMin: 1.2, lifeMax: 2, drag: 0.06, vortex: [1400, 90, 180], colorFrom: '#e0c0ffff', colorTo: '#5a1fd000', colorEase: 'sine.out', scaleFrom: 2, scaleTo: 0.8 } },
  { name: 'arcaneMotes', label: 'magic_01 · opaque', kind: 'opaque', url: '/vfx/opaque/magic_01.png', atlas: single(), blend: 'add',
    o: { rate: 55, shape: 'rect', size: [140, 40], velMin: [-12, -40], velMax: [12, -12], lifeMin: 1.4, lifeMax: 2.4, colorFrom: '#bfe0ffff', colorTo: '#7a4bff00', colorEase: 'sine.inOut', scaleFrom: 1.8, scaleTo: 0.9 } },
  { name: 'starFall', label: 'star_01 · opaque', kind: 'opaque', url: '/vfx/opaque/star_01.png', atlas: single(), blend: 'add',
    o: { rate: 40, shape: 'rect', size: [180, 8], velMin: [-16, 40], velMax: [16, 120], lifeMin: 1.4, lifeMax: 2.4, gravity: [0, 50], colorFrom: '#fff4c0ff', colorTo: '#ffcf5a00', colorEase: 'sine.in', scaleFrom: 2.2, scaleTo: 1.2 } },
  { name: 'candleFlames', label: 'flame_01 · opaque', kind: 'opaque', url: '/vfx/opaque/flame_01.png', atlas: single(), blend: 'add',
    o: { rate: 55, shape: 'rect', size: [24, 6], velMin: [-10, -100], velMax: [10, -60], lifeMin: 0.6, lifeMax: 1.1, colorFrom: '#ffe0a0ff', colorTo: '#ff300000', colorEase: 'sine.in', scaleFrom: 3, scaleTo: 1.2 } },

  // ── alpha sprites → normal blend ──────────────────────────────────────────
  { name: 'softSparks', label: 'spark_01_a · alpha', kind: 'alpha', url: '/vfx/alpha/spark_01_a.png', atlas: single(), blend: 'normal',
    o: { rate: 70, velMin: [-36, -190], velMax: [36, -110], lifeMin: 0.8, lifeMax: 1.5, gravity: [0, 240], colorFrom: '#fff2d0ff', colorTo: '#ffb86633', colorEase: 'sine.in', scaleFrom: 1.4, scaleTo: 0.6 } },
  { name: 'softSmoke', label: 'smoke_01_a · alpha', kind: 'alpha', url: '/vfx/alpha/smoke_01_a.png', atlas: single(), blend: 'normal',
    o: { rate: 22, shape: 'rect', size: [40, 8], velMin: [-12, -60], velMax: [12, -26], lifeMin: 1.6, lifeMax: 2.8, colorFrom: '#c8c8c8cc', colorTo: '#20202000', colorEase: 'sine.in', scaleFrom: 4, scaleTo: 9 } },
  { name: 'softStars', label: 'star_01_a · alpha', kind: 'alpha', url: '/vfx/alpha/star_01_a.png', atlas: single(), blend: 'normal',
    o: { rate: 26, shape: 'rect', size: [160, 30], velMin: [-12, -50], velMax: [12, -18], lifeMin: 1.4, lifeMax: 2.4, colorFrom: '#ffffffff', colorTo: '#cfe0ff22', colorEase: 'sine.inOut', scaleFrom: 1.8, scaleTo: 0.9 } },

  // ── animated flipbooks → one particle plays the whole sheet ────────────────
  { name: 'firePlume', label: 'fire_01_8x8 · sheet', kind: 'sheet', url: '/vfx/sheets/fire_01_8x8.png', atlas: sheet(8, 8, 30), blend: 'add',
    o: { rate: 7, velMin: [-8, -26], velMax: [8, -8], lifeMin: 1.9, lifeMax: 2.3, colorFrom: '#ffffffff', colorTo: '#ffffff00', colorEase: 'sine.in', scaleFrom: 12, scaleTo: 14 } },
  { name: 'wispySmoke', label: 'wispy_smoke_01_8x8 · sheet', kind: 'sheet', url: '/vfx/sheets/wispy_smoke_01_8x8.png', atlas: sheet(8, 8, 24), blend: 'add',
    o: { rate: 4, velMin: [-12, -30], velMax: [12, -12], lifeMin: 2.4, lifeMax: 2.8, colorFrom: '#ffffffff', colorTo: '#ffffff00', colorEase: 'sine.in', scaleFrom: 12, scaleTo: 18 } },
  { name: 'magicBlast', label: 'explosion_smoke_01_8x8 · sheet', kind: 'sheet', url: '/vfx/sheets/explosion_smoke_01_8x8.png', atlas: sheet(8, 8, 34), blend: 'add',
    o: { mode: 'burst', burst: { count: 2, interval: 1.9 }, velMin: [-20, -26], velMax: [20, 0], lifeMin: 1.7, lifeMax: 2, colorFrom: '#ffffffff', colorTo: '#ffffff00', colorEase: 'sine.in', scaleFrom: 14, scaleTo: 17 } },
];

/** Build the whole grid as ONE pylinka project — a system per scene. */
export function buildScenes(scenes: Scene[] = SCENES): PylinkaProject {
  return project('vfx-gallery', scenes.map((s, i) => emitter(s.name, `x${i}`, { ...s.o, blend: s.blend, capacity: s.o.capacity ?? 900 })));
}

/** The `textures` map for createPylinka: system name → texture (image + atlas). */
export function scenesTextures(loaded: Record<string, TextureInput['image']>, scenes: Scene[] = SCENES): Record<string, TextureInput> {
  const out: Record<string, TextureInput> = {};
  for (const s of scenes) out[s.name] = { image: loaded[s.url]!, ...s.atlas };
  return out;
}
