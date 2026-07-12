/**
 * The GPU simulation boundary (REQUIREMENTS.md §7, §11.5, §13). This is the
 * seam between the pixi-facing render integration and the GPU backends. Both
 * compiled backends implement it (see backends.ts): 'webgpu' runs the §13
 * compute kernels on the host renderer's device; 'webgl2' runs the compiled
 * transform-feedback step in the host's GL context.
 *
 * Per-frame split: `prepare(dt)` runs on the app tick (CPU scheduling +
 * uniform staging, §13.11 steps 1–4); `simulate()` + `draw()` run inside the
 * pixi render pass via PylinkaRenderPipe.execute (§13.11 step 5). simulate()
 * is a no-op unless a prepare() is pending, so extra renders never
 * double-integrate.
 */
import type { ParamDef, PylinkaProject, System } from '@pylinka/graph';
import type { KnobStore } from '../knobs.js';

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
 * Per-system GPU simulation, owned by a ParticleView. All methods run inside
 * the host renderer's frame. Steady-state methods allocate nothing (§7.4).
 */
export interface SimBackend {
  /** Advance the CPU scheduler and stage uniforms for this frame. */
  prepare(dtSeconds: number): void;
  /** Move where new particles are born (view-local px). */
  setEmitter(x: number, y: number): void;
  /** Queue extra spawns for the next frame. */
  spawnBurst(count: number): void;
  /** Emit + update GPU work for the pending prepare (§13.11 step 5). */
  simulate(): void;
  /** Instanced draw into the host's open pass, using the view's transform. */
  draw(worldTransform: Affine): void;
  /**
   * Re-read an edited project (§7.5): value edits are zero-recompile; a graph
   * hash change swaps pipelines + resets the pool. False = needs re-create.
   */
  apply(project: PylinkaProject): boolean;
  /** Reset the pool + scheduler. */
  restart(): void;
  readonly stats: SimStats;
  destroy(): void;
}

/** Everything a backend factory needs to build a SimBackend for one system. */
export interface SimBackendDeps {
  backend: 'webgpu' | 'webgl2';
  /** 'webgpu' → GPUDevice; 'webgl2' → WebGL2RenderingContext. Opaque here. */
  device: unknown;
  /** The host pixi Renderer — draw() records into its pass / restores state. */
  renderer: unknown;
  system: System;
  params: ParamDef[];
  /** Project-wide knob store shared across systems (KnobBus fan-out). */
  knobs: KnobStore;
  seed?: number;
}

export type SimBackendFactory = (deps: SimBackendDeps) => SimBackend;

const factories = new Map<'webgpu' | 'webgl2', SimBackendFactory>();

/** Register a GPU backend factory (the built-ins self-register on import). */
export function registerSimBackend(kind: 'webgpu' | 'webgl2', factory: SimBackendFactory): void {
  factories.set(kind, factory);
}

export function getSimBackendFactory(kind: 'webgpu' | 'webgl2'): SimBackendFactory | undefined {
  return factories.get(kind);
}
