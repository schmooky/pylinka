/**
 * The compiled-backend handle: same driving surface as the interpreted
 * `@pylinka/core/webgl` handle, produced by the true graph→GPU codegen path
 * (REQUIREMENTS.md §13). Value edits and knobs are zero-recompile (they live in
 * the vec4 value table); structural edits recompile pipelines and reset the
 * pool (§7.5).
 */
import type { PylinkaProject } from '@pylinka/graph';
import type { CompiledAtlasOptions } from './sprite.js';

export interface CompiledStats {
  aliveCount: number;
  overflowCount: number;
  gpuMs: number | null;
}

export interface CompiledParticlesHandle {
  /** Step the simulation and render one frame. Call once per rAF tick. */
  update(dtSeconds: number): void;
  /** Move where new particles are born (canvas pixels). */
  setEmitter(x: number, y: number): void;
  /** Emit an extra burst next frame. */
  spawnBurst(count: number): void;
  /** Set a named knob live — writes a value-table slot, never recompiles. */
  setKnob(name: string, x: number, y?: number, z?: number, w?: number): void;
  /**
   * Re-read an edited project into the running effect. Value-only edits are
   * zero-recompile; a changed graph hash rebuilds pipelines and resets the pool
   * (§7.5); a changed blend mode rebuilds the render pipeline. Returns false if
   * the change needs a full re-create (only pool capacity does).
   */
  apply(project: PylinkaProject): boolean;
  /** Reset the pool + scheduler (§11.5 restart). */
  restart(): void;
  /** Whether the canvas is cleared each frame (default true). */
  autoClear: boolean;
  /**
   * Alive particle count. webgl2: synchronous readback on call (debug-tier);
   * webgpu: the §13.11 async counter readback, refreshed every 30 frames.
   */
  aliveCount(): number;
  /** Async-refreshed stats (§11.5) — reading never triggers a readback. */
  readonly stats: CompiledStats;
  readonly backendName: 'webgpu' | 'webgl2';
  destroy(): void;
}

export interface CompiledParticlesOptions {
  /** Which system to run (defaults to the first enabled system). */
  systemName?: string;
  /** dt clamp in seconds (default 0.05). */
  maxDt?: number;
  /** View zoom-out factor (default 1) — see the interpreted backend. */
  zoom?: number;
  /** Particle sprite size multiplier (default 1). */
  sizeScale?: number;
  /** Deterministic base seed (capture mode). Default: Date.now(). */
  seed?: number;
  /** Sprite / uniform-grid atlas; cell picked by `output.initTexIndex` (§13.8). */
  atlas?: CompiledAtlasOptions;
  /** Called after any pipeline rebuild with the time it took. */
  onRecompile?: (info: { ms: number; reason: 'structural' | 'blend' }) => void;
}
