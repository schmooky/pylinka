/**
 * @pylinka/core/webgpu — the WebGPU compute backend (REQUIREMENTS.md §13).
 * The project graph is compiled to WGSL kernels and dispatched per frame;
 * inline values + knobs live in the vec4 value table, so edits and knob moves
 * never recompile.
 *
 * @example
 * ```ts
 * import { createParticles } from '@pylinka/core/webgpu';
 * const fx = await createParticles(canvas, project);
 * fx.setEmitter(x, y);
 * ticker(() => fx.update(1 / 60));
 * fx.setKnob('windPower', 40); // live — zero recompile
 * ```
 */
export { createParticles, pickSystem, WebGPUSystemSim } from './engine.js';
export type { WebGPUSimOptions } from './engine.js';
export { blendState, RENDER_WGSL } from './shaders.js';
export type {
  CompiledParticlesHandle,
  CompiledParticlesOptions,
  CompiledStats,
} from '../compiled/types.js';
export type { CompiledAtlasOptions } from '../compiled/sprite.js';
