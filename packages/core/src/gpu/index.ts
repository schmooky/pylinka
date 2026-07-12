/**
 * @pylinka/core/gpu — one call, best available compiled backend.
 *
 * `createCompiledParticles` compiles the project graph to real GPU code and
 * runs it: WebGPU compute kernels where available, the compiled WebGL2
 * transform-feedback path everywhere else. Same handle either way.
 *
 * @example
 * ```ts
 * import { createCompiledParticles } from '@pylinka/core/gpu';
 * const fx = await createCompiledParticles(canvas, project); // picks webgpu|webgl2
 * console.log(fx.backendName);
 * ```
 */
import type { PylinkaProject } from '@pylinka/graph';
import type { CompiledParticlesHandle, CompiledParticlesOptions } from '../compiled/types.js';
import { createParticles as createWebgl2 } from '../webgl2/engine.js';
import { createParticles as createWebgpu } from '../webgpu/engine.js';

export type CompiledBackend = 'auto' | 'webgpu' | 'webgl2';

export interface CreateCompiledOptions extends CompiledParticlesOptions {
  /** 'auto' (default): webgpu when the browser has it, else webgl2. */
  backend?: CompiledBackend;
}

export async function createCompiledParticles(
  canvas: HTMLCanvasElement,
  project: PylinkaProject,
  opts: CreateCompiledOptions = {},
): Promise<CompiledParticlesHandle> {
  const { backend = 'auto', ...rest } = opts;
  const hasWebGPU = typeof navigator !== 'undefined' && (navigator as { gpu?: unknown }).gpu !== undefined;
  if (backend === 'webgpu' || (backend === 'auto' && hasWebGPU)) {
    return createWebgpu(canvas, project, rest);
  }
  return createWebgl2(canvas, project, rest);
}

export type {
  CompiledParticlesHandle,
  CompiledParticlesOptions,
  CompiledStats,
} from '../compiled/types.js';
export type { CompiledAtlasOptions } from '../compiled/sprite.js';
export { ValueTable, writeLiteral, writeHexColor, pcg } from '../compiled/staging.js';
export { SystemClock } from '../compiled/emitter.js';
export { resolveSprite, softDisc } from '../compiled/sprite.js';
