/**
 * The WebGL1 SimBackend: CPU simulation (webgl1/sim.ts) plus one instanced
 * WebGL1 draw in pixi's GL context. Kept out of backends.ts so that only a
 * WebGL1 host loads it: `ensureSimBackend('webgl1')` imports this module.
 */
import type { ParamDef, System } from '@pylinka/graph';
import type { Renderer } from 'pixi.js';
import { SystemClock } from '../compiled/emitter.js';
import { resolveAnim, resolveSprite } from '../compiled/sprite.js';
import type { KnobStore } from '../knobs.js';
import { pickSystem } from '../system.js';
import type { AtlasConfig } from '../webgl/engine.js';
import { extractParams, type EngineParams, type KnobValues } from '../webgl/params.js';
import { unsupportedNodes } from '../webgl/support.js';
import { CpuRenderer, NoInstancingError } from '../webgl1/renderer.js';
import { CpuSim } from '../webgl1/sim.js';
import { glScaleOffset, queueStep, resyncPixiGl, type QueuedStep } from './backends.js';
import type { Affine, SimBackend, SimBackendDeps, SimStats } from './sim.js';

/** Warnings already printed, so a rebuild loop (an editor) does not spam the console. */
const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/** A per-instance seed for the CPU sim when the host gave none. */
function autoSeed(): number {
  return (Math.random() * 0x100000000) >>> 0 || 1;
}

/** The interpreted engine's atlas config, from the compiled backends' options. */
function atlasConfig(deps: SimBackendDeps): AtlasConfig | undefined {
  if (deps.atlas === undefined) return undefined; // procedural soft sprite
  const s = resolveSprite(deps.atlas);
  const a = resolveAnim(deps.atlas);
  return { ...s, fps: a.fps, play: a.play, pick: a.pick, row: a.row };
}

/**
 * Reads the f32 and vec2 knobs the interpreted params understand out of the
 * shared KnobStore, and tells when one changed since the last read. Lets the
 * CPU backend re-extract its params only on a knob edit, not every frame.
 */
class KnobSnapshot {
  readonly values: KnobValues = {};
  private readonly tmp = new Float32Array(4);
  private defs: ParamDef[];

  constructor(
    private readonly knobs: KnobStore,
    defs: ParamDef[],
  ) {
    this.defs = defs;
    this.refresh();
  }

  setDefs(defs: ParamDef[]): void {
    this.defs = defs;
    this.refresh();
  }

  /** The values `defs` would read, without changing this snapshot. */
  peek(defs: ParamDef[]): KnobValues {
    const out: KnobValues = {};
    for (const d of defs) {
      if (d.default.t !== 'f32' && d.default.t !== 'vec2') continue;
      this.knobs.vec4(d.name, this.tmp, 0);
      out[d.name] = d.default.t === 'f32' ? this.tmp[0]! : [this.tmp[0]!, this.tmp[1]!];
    }
    return out;
  }

  /** Knobs this snapshot cannot carry into the interpreted params (not f32 / vec2). */
  skipped(): string[] {
    return this.defs
      .filter((d) => d.default.t !== 'f32' && d.default.t !== 'vec2')
      .map((d) => d.name);
  }

  /** Re-read the store. True when any value differs from the last read. */
  refresh(): boolean {
    let changed = false;
    for (const d of this.defs) {
      if (d.default.t !== 'f32' && d.default.t !== 'vec2') continue;
      this.knobs.vec4(d.name, this.tmp, 0);
      const prev = this.values[d.name];
      if (d.default.t === 'f32') {
        const x = this.tmp[0]!;
        if (prev !== x) {
          this.values[d.name] = x;
          changed = true;
        }
      } else {
        const x = this.tmp[0]!;
        const y = this.tmp[1]!;
        if (!Array.isArray(prev) || prev[0] !== x || prev[1] !== y) {
          this.values[d.name] = [x, y];
          changed = true;
        }
      }
    }
    return changed;
  }
}

export class WebGL1SimBackend implements SimBackend {
  /** Readable by a sibling: a sub-emitter child steps off its parent's state. */
  readonly sim: CpuSim;
  readonly clock: SystemClock;
  private readonly renderer: Renderer;
  /** null when the context cannot instance (no ANGLE_instanced_arrays): the effect simulates but draws nothing. */
  private readonly draw1: CpuRenderer | null;
  private readonly gl: WebGLRenderingContext;
  private needsRebuild = false;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas | undefined;
  private readonly onRestored = (): void => {
    // pixi restores its own objects on this event; ours are rebuilt lazily in
    // draw(), inside pixi's pass, where a resync follows
    this.needsRebuild = true;
  };
  private readonly queue: QueuedStep[] = [];
  private readonly knobs: KnobSnapshot;
  private readonly wind: [number, number] = [0, 0];
  private readonly emitter: [number, number] = [0, 0];
  private readonly isChild: boolean;
  private system: System;
  private params: EngineParams;
  private defs: ParamDef[];
  private readonly _stats: SimStats = { aliveCount: 0, overflowCount: 0, gpuMs: null };

  constructor(deps: SimBackendDeps) {
    this.renderer = deps.renderer as Renderer;
    this.system = deps.system;
    this.defs = deps.params;
    this.knobs = new KnobSnapshot(deps.knobs, deps.params);
    this.params = extractParams(deps.system, deps.params, this.knobs.values);
    this.recomputeWind();
    const parent = deps.subParent instanceof WebGL1SimBackend ? deps.subParent.sim : undefined;
    if (deps.subParent !== undefined && parent === undefined) {
      throw new Error('A WebGL1 sub-emitter needs a parent on the WebGL1 backend too.');
    }
    this.isChild = parent !== undefined;
    this.sim = new CpuSim(this.params, {
      ...(parent !== undefined ? { parent } : {}),
      ...(deps.mask !== undefined ? { mask: deps.mask } : {}),
      // without a per-instance seed, two views of one system started on the
      // same frame would draw identical particles
      seed: deps.seed ?? autoSeed(),
    });
    this.clock = new SystemClock(deps.system.emitter, this.sim.capacity, 0, 0, deps.seed);
    this.gl = deps.device as WebGLRenderingContext;
    this.draw1 = this.makeRenderer(deps);
    // creating GL objects moved pixi's VAO, element-buffer and texture-unit
    // bindings behind its back: drop its caches before it draws again
    resyncPixiGl(this.renderer);
    this.canvas = (this.gl as { canvas?: HTMLCanvasElement | OffscreenCanvas }).canvas;
    this.canvas?.addEventListener?.('webglcontextrestored', this.onRestored as EventListener);

    const skippedNodes = unsupportedNodes(this.system);
    if (skippedNodes.length > 0) {
      warnOnce(
        `nodes:${this.system.id}`,
        `Pylinka (WebGL1): system '${this.system.name}' uses nodes the CPU simulation does not run ` +
          `(${skippedNodes.join(', ')}). They contribute nothing on WebGL1; see INTERPRETED_KINDS.`,
      );
    }
    const skippedKnobs = this.knobs.skipped();
    if (skippedKnobs.length > 0) {
      warnOnce(
        `knobs:${this.system.id}`,
        `Pylinka (WebGL1): knobs ${skippedKnobs.join(', ')} are not f32/vec2 and do not reach the CPU simulation.`,
      );
    }
  }

  private makeRenderer(deps: SimBackendDeps): CpuRenderer | null {
    try {
      return new CpuRenderer(this.gl, this.sim.capacity, atlasConfig(deps));
    } catch (e) {
      if (!(e instanceof NoInstancingError)) throw e;
      warnOnce('instancing', `${e.message} Pylinka effects will not draw on this device.`);
      return null;
    }
  }

  get stats(): SimStats {
    return this._stats;
  }

  private recomputeWind(): void {
    this.wind[0] = Math.cos(this.params.windDir) * this.params.windPower;
    this.wind[1] = Math.sin(this.params.windDir) * this.params.windPower;
  }

  prepare(dtSeconds: number): void {
    // same queueing as the GPU backends, so a parent and its child step in
    // the order pixi draws them and an off-screen view does not pile up work
    queueStep(this.queue, dtSeconds, this.clock.ex, this.clock.ey);
  }

  setEmitter(x: number, y: number): void {
    this.clock.ex = x;
    this.clock.ey = y;
  }

  spawnBurst(count: number): void {
    this.clock.spawnBurst(count);
  }

  simulate(): void {
    if (this.queue.length === 0) return;
    if (this.knobs.refresh()) {
      Object.assign(this.params, extractParams(this.system, this.defs, this.knobs.values));
      this.recomputeWind();
    }
    for (const s of this.queue) {
      const c = this.clock;
      c.ex = s.ex;
      c.ey = s.ey;
      c.tick(s.dt);
      this.emitter[0] = c.ex;
      this.emitter[1] = c.ey;
      // a child spawns on its parent's events, never from the emitter window
      this.sim.step(s.dt, this.isChild ? 0 : c.spawnCount, this.emitter, this.wind, this.params);
      c.endFrame(s.dt);
    }
    this.queue.length = 0;
  }

  draw(worldTransform: Affine): void {
    this._stats.aliveCount = this.sim.drawCount;
    const r = this.draw1;
    if (r === null || this.gl.isContextLost()) return;
    if (this.needsRebuild) {
      // the restored context has none of the old objects; the particle state
      // lives on the CPU, so the effect carries on where it was
      this.needsRebuild = false;
      r.createResources();
    }
    const [sx, sy, ox, oy] = glScaleOffset(this.renderer, worldTransform);
    r.draw(this.sim.drawData, this.sim.drawCount, this.params, 1, sx, sy, ox, oy);
    resyncPixiGl(this.renderer);
  }

  apply(project: Parameters<SimBackend['apply']>[0]): boolean {
    // by ID first: a rename must not rebind this view to another system
    const sys = pickSystem(project, this.system.name, this.system.id);
    if (sys === undefined) return false;
    // decide before touching the knob snapshot, so a rejected apply leaves
    // this backend exactly as it was
    const np = extractParams(sys, project.params, this.knobs.peek(project.params));
    if (!this.sim.fits(np)) return false;
    this.knobs.setDefs(project.params);
    this.system = sys;
    this.defs = project.params;
    Object.assign(this.params, np);
    this.recomputeWind();
    this.clock.setEmitterSettings(sys.emitter, this.sim.capacity);
    return true;
  }

  restart(): void {
    this.sim.reset();
    this.clock.reset();
  }

  destroy(): void {
    this.canvas?.removeEventListener?.('webglcontextrestored', this.onRestored as EventListener);
    this.draw1?.destroy();
  }
}
