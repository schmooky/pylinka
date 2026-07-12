/**
 * @pylinka/core/webgl2 — the compiled WebGL2 transform-feedback backend
 * (REQUIREMENTS.md §13.12). Runs the compiler's 'webgl2' GLSL output — the
 * whole graph as generated code — on any WebGL2 context. Same handle surface
 * as `@pylinka/core/webgpu`, synchronous creation.
 */
export { createParticles, WebGL2CompiledSim } from './engine.js';
export type { WebGL2SimOptions } from './engine.js';
export { COMPILED_RENDER_FS, COMPILED_RENDER_VS } from './shaders.js';
export type {
  CompiledParticlesHandle,
  CompiledParticlesOptions,
  CompiledStats,
} from '../compiled/types.js';
export type { CompiledAtlasOptions } from '../compiled/sprite.js';
