/**
 * The RevoltFX bundle format, as `revolt-fx@1.3.6` reads it.
 *
 * Field names, enum values and defaults come from that package's
 * `lib/Sanitizer.js` (`_presetStructure`), `lib/model/*` and the emitter cores.
 * Nothing here is inferred from examples alone. See MAPPING.md for what each
 * field means at runtime.
 */

/** `FX._bundleHash`: every exported bundle carries it in `__h`. */
export const REVOLTFX_BUNDLE_HASH = '80c6df7fb0d3d898f34ce0031c037fef';
/** `FX.settingsVersion`: the `__v` a bundle must carry. */
export const REVOLTFX_SETTINGS_VERSION = 0;

/** Penner ease names (`EasingType`). */
export type RfxEase = string;

/** `ComponentType`: 0 sprite, 1 movie clip. */
export type RfxComponentType = 0 | 1;

/** `EffectSequenceComponentType`: 0 sprite, 1 movie clip, 2 emitter, 3 trigger. */
export type RfxSequenceComponentType = 0 | 1 | 2 | 3;

/** `SpawnType`: 0 particle emitter, 1 effect sequence. */
export type RfxSpawnType = 0 | 1;

export interface RfxComponentParams {
  animationSpeedMin: number;
  animationSpeedMax: number;
  anchorX: number;
  anchorY: number;
  loop: boolean;
}

/** One entry of `childs` or `spawn.*`. */
export interface RfxSpawnDef {
  type: RfxSpawnType;
  /** emitter or sequence id */
  id: number;
  scale: number;
  adoptRotation: boolean;
  containerId: string;
}

export interface RfxSpawns {
  onComplete: RfxSpawnDef[];
  onBounce: RfxSpawnDef[];
  onHalfway: RfxSpawnDef[];
  onStart: RfxSpawnDef[];
}

export interface RfxCoreParams {
  radius: number;
  radial: boolean;
  /** radians; 0 on a circle core means "full circle" */
  angle: number;
  uniform: boolean;
  width: number;
  height: number;
}

export interface RfxParticleSettings {
  componentType: RfxComponentType;
  /** texture name (sprite) or movie-clip group (`mc_<group>_<frame>`) */
  componentId: string;
  componentParams: RfxComponentParams;
  durationMin: number;
  durationMax: number;
  distanceMin: number;
  distanceMax: number;
  distanceEase: RfxEase;
  moveSpeedMin: number;
  moveSpeedMax: number;
  bounceFacMin: number;
  bounceFacMax: number;
  frictionMin: number;
  frictionMax: number;
  useMotion: boolean;
  useRotation: boolean;
  useAlpha: boolean;
  useScale: boolean;
  useTint: boolean;
  useChilds: boolean;
  useSpawns: boolean;
  stopOnBounce: boolean;
  align: boolean;
  /** index into ['normal', 'add', 'multiply', 'screen'] */
  blendMode: number;
  addOnTop: boolean;
  rotationSpeedMin: number;
  rotationSpeedMax: number;
  randomRotationDirection: boolean;
  randomStartRotation: boolean;
  fadeIn: boolean;
  fadeInDurationFac: number;
  fadeInEase: RfxEase;
  alphaStartMin: number;
  alphaStartMax: number;
  alphaEndMin: number;
  alphaEndMax: number;
  alphaEase: RfxEase;
  /** 0xRRGGBB */
  tintStart: number;
  tintEnd: number;
  tintEase: RfxEase;
  scaleIn: boolean;
  scaleInDurationFac: number;
  scaleInEase: RfxEase;
  uniformScale: boolean;
  scaleXStartMin: number;
  scaleXStartMax: number;
  scaleXEndMin: number;
  scaleXEndMax: number;
  scaleXEase: RfxEase;
  scaleYStartMin: number;
  scaleYStartMax: number;
  scaleYEndMin: number;
  scaleYEndMax: number;
  scaleYEase: RfxEase;
  scaleStartMin: number;
  scaleStartMax: number;
  scaleEndMin: number;
  scaleEndMax: number;
  scaleEase: RfxEase;
  childs: RfxSpawnDef[];
  spawn: RfxSpawns;
}

export interface RfxEmitter {
  id: number;
  name: string;
  type: 0;
  core: { type: 'circle' | 'ring' | 'box'; params: RfxCoreParams };
  spawnFrequencyMin: number;
  spawnFrequencyMax: number;
  maxParticles: number;
  spawnCountMin: number;
  spawnCountMax: number;
  /** seconds; 0 with `infinite: false` is a single spawn */
  duration: number;
  infinite: boolean;
  useGravity: boolean;
  /** px per frame² (60 fps frames) */
  gravity: number;
  useFloor: boolean;
  floorY: number;
  /** radians */
  rotation: number;
  /** radians per frame */
  autoRotation: number;
  particleSettings: RfxParticleSettings;
  childs: RfxSpawnDef[];
  containerId?: string;
}

export interface RfxSequenceEffect {
  id: number;
  /** texture/movie-clip name (0/1), emitter id (2), null (3) */
  componentId: string | number | null;
  componentType: RfxSequenceComponentType;
  /** seconds from the sequence start */
  delay: number;
  componentParams: RfxComponentParams;
  scaleMin: number;
  scaleMax: number;
  alphaMin: number;
  alphaMax: number;
  rotationMin: number;
  rotationMax: number;
  blendMode: number;
  /** seconds a sprite element stays up */
  duration: number;
  tint: number;
  containerId: string;
  triggerValue: string;
}

export interface RfxSequence {
  id: number;
  name: string;
  type: 1;
  delay: number;
  scaleMin: number;
  scaleMax: number;
  effects: RfxSequenceEffect[];
}

export interface RfxBundle {
  name?: string;
  spritesheetFilter?: string;
  maxParticles?: number;
  useBlendModes?: boolean;
  emitters: RfxEmitter[];
  sequences: RfxSequence[];
  __h?: string;
  __v?: number;
}

/**
 * One frame of a TexturePacker "JSON (Hash)" sheet, the format RevoltFX's
 * default spritesheet uses and that pixi's Spritesheet parser reads.
 */
export interface SheetFrame {
  frame: { x: number; y: number; w: number; h: number };
  rotated?: boolean;
  trimmed?: boolean;
  spriteSourceSize?: { x: number; y: number; w: number; h: number };
  sourceSize?: { w: number; h: number };
}

export interface SheetData {
  frames: Record<string, SheetFrame>;
  meta?: { image?: string; size?: { w: number; h: number } };
}
