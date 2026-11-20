/**
 * WebGL1 particle engine: CPU simulation (sim.ts) plus an instanced draw
 * (renderer.ts). Same driving surface as the interpreted `WebGL2Engine`, so
 * `createParticles` in `@pylinka/core/webgl` can pick either one.
 *
 * Context loss costs less here than on the GPU engines: the particle state
 * lives on the CPU, so after a restore the GL objects are rebuilt and the
 * effect continues where it was.
 */
import type { AtlasConfig, MaskConfig } from '../webgl/engine.js';
import type { EngineParams } from '../webgl/params.js';
import { CpuSim } from './sim.js';
import { CpuRenderer, type AnyGL } from './renderer.js';

/** A sub-emitter's parent on the CPU path. */
export interface CpuSubSource {
  parent: WebGL1Engine;
}

export class WebGL1Engine {
  /** The CPU simulation. Readable so a sub-emitter can bind to its parent. */
  readonly sim: CpuSim;
  private readonly gl: AnyGL;
  private readonly renderer: CpuRenderer;
  private readonly sizeScale: number;
  private lost = false;
  private needsRebuild = false;
  private readonly onLost: () => void;
  private readonly onRestored: () => void;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly handleLost = (e: Event): void => {
    // without preventDefault the browser never fires webglcontextrestored
    e.preventDefault();
    this.lost = true;
    this.onLost();
  };
  private readonly handleRestored = (): void => {
    this.lost = false;
    this.needsRebuild = true;
  };

  constructor(
    gl: AnyGL,
    params: EngineParams,
    sizeScale = 1,
    atlas?: AtlasConfig,
    sub?: CpuSubSource,
    mask?: MaskConfig,
    hooks?: { onContextLost?: () => void; onContextRestored?: () => void },
  ) {
    this.gl = gl;
    this.sizeScale = sizeScale;
    this.sim = new CpuSim(params, {
      ...(sub ? { parent: sub.parent.sim } : {}),
      ...(mask ? { mask } : {}),
    });
    this.renderer = new CpuRenderer(gl, this.sim.capacity, atlas);
    this.onLost = hooks?.onContextLost ?? (() => undefined);
    this.onRestored = hooks?.onContextRestored ?? (() => undefined);
    this.canvas = gl.canvas;
    this.canvas.addEventListener('webglcontextlost', this.handleLost as EventListener);
    this.canvas.addEventListener('webglcontextrestored', this.handleRestored as EventListener);
  }

  /** True while the GL context is gone. The simulation keeps running; drawing stops. */
  get contextLost(): boolean {
    return this.lost;
  }

  /** Advance the simulation by dt, spawning `spawnCount` new particles. */
  step(
    dt: number,
    spawnCount: number,
    emitter: readonly [number, number],
    wind: readonly [number, number],
    p: EngineParams,
  ): void {
    this.sim.step(dt, spawnCount, emitter, wind, p);
  }

  /** Draw the current state into the bound framebuffer at the given size. */
  render(width: number, height: number, p: EngineParams, viewX = 0, viewY = 0): void {
    if (this.lost) return;
    if (this.needsRebuild) {
      this.needsRebuild = false;
      this.renderer.createResources();
      this.onRestored();
    }
    this.renderer.draw(
      this.sim.state,
      this.sim.capacity,
      p,
      this.sizeScale,
      2 / width,
      -2 / height,
      -1 - (2 * viewX) / width,
      1 + (2 * viewY) / height,
    );
  }

  /** Alive particle count. Cheap here: the state is already on the CPU. */
  aliveCount(): number {
    return this.sim.aliveCount();
  }

  destroy(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleLost as EventListener);
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored as EventListener);
    this.renderer.destroy();
  }
}
