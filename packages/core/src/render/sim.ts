/**
 * The GPU simulation boundary (REQUIREMENTS.md §7, §13). This interface is the
 * seam between the pixi-facing render integration (which is settled — see
 * docs/SPIKE-RESULTS.md) and the GPU backend (which is gated on the M1.0 spike).
 *
 * The WebGPU implementation (Pool + UniformBus + PipelineCache + compute
 * dispatch + instanced draw) plugs in here once the spike validates device
 * sharing and the color-storage/transform decisions. Until then the render
 * integration is complete and typed, but no `SimBackend` is constructed.
 */
import type { CompiledSystem } from '@pylinka/compiler';

/** A 2×3 affine (pixi worldTransform: a, b, c, d, tx, ty). */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface SimStats {
  aliveCount: number;
  overflowCount: number;
  gpuMs: number | null;
}

/**
 * Per-system GPU simulation, owned by a ParticleView. All methods run inside the
 * host renderer's frame (WebGPU device or WebGL2 context). Steady-state methods
 * allocate nothing (§7.4).
 */
export interface SimBackend {
  /** Advance the CPU scheduler and stage uniforms for this frame. */
  prepare(dtSeconds: number, spawnCount: number): void;
  /** Encode emit + update compute dispatches (§13.11 step 5). */
  simulate(): void;
  /** Instanced draw using the view's world transform (§13.8 scaleOffset). */
  draw(worldTransform: Affine): void;
  /** Swap pipelines after a structural recompile; pool resets (§7.5). */
  recompile(compiled: CompiledSystem): void;
  /** Reset the pool + scheduler (+ prewarm). */
  restart(): void;
  readonly stats: SimStats;
  destroy(): void;
}

/**
 * Factory the backend package will provide (WebGPU M1, WebGL2 M2). Absent until
 * the spike lands; `createParticleSystem`/`createPylinka` throw a clear error
 * until a factory is registered.
 */
export type SimBackendFactory = (compiled: CompiledSystem, deps: SimBackendDeps) => SimBackend;

export interface SimBackendDeps {
  /** 'webgpu' → a GPUDevice; 'webgl2' → a WebGL2RenderingContext. Opaque here. */
  backend: 'webgpu' | 'webgl2';
  device: unknown;
  /** Pool capacity for this system. */
  capacity: number;
}

let registeredFactory: SimBackendFactory | undefined;

/** Register the GPU backend factory (called by the future backend module). */
export function registerSimBackend(factory: SimBackendFactory): void {
  registeredFactory = factory;
}

export function getSimBackendFactory(): SimBackendFactory | undefined {
  return registeredFactory;
}
