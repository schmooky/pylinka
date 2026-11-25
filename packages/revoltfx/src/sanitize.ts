/**
 * Default-filling, ported from `revolt-fx/lib/Sanitizer.js`.
 *
 * RevoltFX fills missing keys in place before it plays a bundle, so a bundle
 * written by an older editor still loads. The converter has to see the same
 * values RevoltFX would, so this walks the same preset structure, with the same
 * rules: an absent (`null`/`undefined`) key takes the default, an object recurses,
 * and an array's entries take the spawn-entry defaults. Unlike the original it
 * never mutates its input.
 */
import type { RfxBundle, RfxEmitter, RfxSequence } from './types.js';

type Plain = Record<string, unknown>;

const componentParams = {
  animationSpeedMin: 1,
  animationSpeedMax: 1,
  anchorX: 0.5,
  anchorY: 0.5,
  loop: false,
};

/** `Sanitizer._presetStructure`, verbatim. */
export const PRESET = {
  sequence: { id: 0, name: '', type: 1, delay: 0, scaleMin: 1, scaleMax: 1, effects: [] },
  sequenceEffect: {
    id: 0,
    componentId: null,
    componentType: 0,
    delay: 0,
    componentParams,
    scaleMin: 1,
    scaleMax: 1,
    alphaMin: 1,
    alphaMax: 1,
    rotationMin: 0,
    rotationMax: 0,
    blendMode: 0,
    duration: 0.1,
    tint: 0xffffff,
    containerId: '',
    triggerValue: '',
  },
  emitter: {
    id: 0,
    name: '',
    type: 0,
    core: {
      type: 'circle',
      params: { radius: 100, radial: true, angle: 6.28318530718, uniform: false, width: 100, height: 100 },
    },
    spawnFrequencyMin: 0.1,
    spawnFrequencyMax: 0.1,
    maxParticles: 1000,
    spawnCountMin: 1,
    spawnCountMax: 1,
    duration: 0,
    infinite: true,
    useGravity: false,
    gravity: 0,
    useFloor: false,
    floorY: 700,
    rotation: 0,
    autoRotation: 0,
    particleSettings: {
      componentType: 0,
      componentId: '',
      componentParams,
      durationMin: 1,
      durationMax: 2,
      distanceMin: 0,
      distanceMax: 0,
      distanceEase: 'linear',
      moveSpeedMin: 0,
      moveSpeedMax: 0,
      bounceFacMin: 0,
      bounceFacMax: 0,
      frictionMin: 0,
      frictionMax: 0,
      useMotion: false,
      useRotation: false,
      useAlpha: false,
      useScale: false,
      useTint: false,
      useChilds: false,
      useSpawns: false,
      stopOnBounce: false,
      align: false,
      blendMode: 1,
      addOnTop: true,
      rotationSpeedMin: 0,
      rotationSpeedMax: 0,
      randomRotationDirection: false,
      randomStartRotation: false,
      fadeIn: true,
      fadeInDurationFac: 0.1,
      fadeInEase: 'linear',
      alphaStartMin: 0.7,
      alphaStartMax: 0.9,
      alphaEndMin: 0.7,
      alphaEndMax: 0.8,
      alphaEase: 'linear',
      tintStart: 0xffffff,
      tintEnd: 0xffffff,
      tintEase: 'linear',
      scaleIn: false,
      scaleInDurationFac: 0.2,
      scaleInEase: 'linear',
      uniformScale: true,
      scaleXStartMin: 1,
      scaleXStartMax: 1,
      scaleXEndMin: 1,
      scaleXEndMax: 1,
      scaleXEase: 'linear',
      scaleYStartMin: 1,
      scaleYStartMax: 1,
      scaleYEndMin: 1,
      scaleYEndMax: 1,
      scaleYEase: 'linear',
      scaleStartMin: 1,
      scaleStartMax: 1,
      scaleEndMin: 1,
      scaleEndMax: 1,
      scaleEase: 'linear',
      childs: [],
      spawn: { onComplete: [], onBounce: [], onHalfway: [], onStart: [] },
    },
    childs: [],
  },
  emitterSpawn: { type: 0, id: 0, scale: 1, adoptRotation: true, containerId: '' },
} as const;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** `Sanitizer.parse`, on a copy. */
function fill(target: Plain, structure: Plain, spawnStructure: Plain): void {
  for (const key of Object.keys(structure)) {
    const have = target[key];
    if (have === null || have === undefined) {
      target[key] = clone(structure[key]);
      continue;
    }
    if (typeof have !== 'object') continue;
    if (Array.isArray(have)) {
      for (const entry of have) {
        if (entry === null || typeof entry !== 'object') continue;
        for (const sk of Object.keys(spawnStructure)) {
          const e = entry as Plain;
          if (e[sk] === null || e[sk] === undefined) e[sk] = clone(spawnStructure[sk]);
        }
      }
    } else {
      fill(have as Plain, structure[key] as Plain, spawnStructure);
    }
  }
}

/** A sanitized deep copy of `bundle`, with the values RevoltFX itself would play. */
export function sanitizeBundle(bundle: RfxBundle): RfxBundle {
  const out = clone(bundle);
  out.emitters = Array.isArray(out.emitters) ? out.emitters : [];
  out.sequences = Array.isArray(out.sequences) ? out.sequences : [];
  for (const e of out.emitters) fill(e as unknown as Plain, PRESET.emitter, PRESET.emitterSpawn);
  for (const s of out.sequences) fill(s as unknown as Plain, PRESET.sequence, PRESET.sequenceEffect);
  return out;
}

export type { RfxEmitter, RfxSequence };
