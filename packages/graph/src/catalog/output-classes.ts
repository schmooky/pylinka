/**
 * Write-combination model for `output.*` kinds (REQUIREMENTS.md §6).
 *
 * This metadata is NOT on the NodeSchema (schemas have no such field) — it lives
 * here as the single source of truth shared by the validator (V004/V005/V006)
 * and, later, the compiler's write-combination stage.
 */

/** Required output kinds — a valid system has exactly one of each (V004). */
export const REQUIRED_OUTPUTS: ReadonlySet<string> = new Set([
  'output.spawnPosition',
  'output.initLife',
]);

/**
 * Single-writer output kinds: a second writer is V005. Set-like writes plus the
 * required spawn writes. `writeAlpha` is single-writer but may coexist with
 * `writeColor` (it's a post-color lane-masked write).
 */
export const SINGLE_WRITER_OUTPUTS: ReadonlySet<string> = new Set([
  'output.spawnPosition',
  'output.initVelocity',
  'output.initLife',
  'output.initTexIndex',
  'output.setVelocity',
  'output.writePosition',
  'output.writeColor',
  'output.writeAlpha',
  'output.writeScale',
  'output.writeRotation',
]);

/** Accumulating outputs: multiple writers are legal and add together. */
export const ACCUMULATING_OUTPUTS: ReadonlySet<string> = new Set([
  'output.addForce',
  'output.drag',
  'output.killIf',
  'output.killIfOutOfRect',
  'output.reflectInRect',
]);

/** Force-model outputs that accumulate into `force`/`dragK` (§13.6). */
export const FORCE_LIKE_OUTPUTS: ReadonlySet<string> = new Set([
  'output.addForce',
  'output.drag',
]);

export const SET_VELOCITY = 'output.setVelocity';
export const ADD_FORCE = 'output.addForce';

/** Every kind in the `output.*` namespace that this catalog understands. */
export const ALL_OUTPUT_KINDS: ReadonlySet<string> = new Set([
  ...REQUIRED_OUTPUTS,
  ...SINGLE_WRITER_OUTPUTS,
  ...ACCUMULATING_OUTPUTS,
]);
