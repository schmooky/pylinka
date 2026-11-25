/**
 * @pylinka/revoltfx — play RevoltFX effect bundles with Pylinka.
 *
 * ```ts
 * import { convertEffect } from '@pylinka/revoltfx';
 * const fx = convertEffect(bundle, 'side-torch', { sheet: spritesheetJson });
 * fx.project;   // a PylinkaProject: one System per emitter the effect reaches
 * fx.issues;    // every RevoltFX setting that did not carry over exactly
 * ```
 *
 * To play it with RevoltFX's timing (delays, durations, triggers, spawn clock),
 * use `createRevoltFxPlayer` from `@pylinka/revoltfx/pixi`. MAPPING.md lists
 * how each RevoltFX setting maps and how faithfully.
 */
export {
  convertBundle,
  convertEffect,
  listEffects,
  type ConvertOptions,
  type ConvertedEffect,
  type EmitTrack,
  type SpawnClock,
  type SystemTexture,
  type Timeline,
  type TriggerTrack,
} from './convert.js';
export { summarizeIssues, type FidelityIssue, type IssueLevel } from './report.js';
export { sanitizeBundle } from './sanitize.js';
export { PENNER, PRESET_EQUIVALENT, mapEase, fitDrag, fitCurve, type FittedEase } from './ease.js';
export { BASE_PX, FALLBACK_SIZE, spriteBox, movieClipFrames, componentSize, sourceSize, type SpriteBox } from './frames.js';
export { SpawnClockRunner } from './clock.js';
export {
  REVOLTFX_BUNDLE_HASH,
  REVOLTFX_SETTINGS_VERSION,
  type RfxBundle,
  type RfxEmitter,
  type RfxParticleSettings,
  type RfxSequence,
  type RfxSequenceEffect,
  type RfxSpawnDef,
  type SheetData,
  type SheetFrame,
} from './types.js';
