/**
 * The built-in SimBackend implementations (REQUIREMENTS.md §13.11, §13.13,
 * docs/SPIKE-RESULTS): thin adapters that run the compiled engines inside a
 * host pixi renderer's frame.
 *
 * WebGPU: compute work is recorded into its OWN command encoder and submitted
 * during execute() — queue order puts it before pixi's pass submit, which is
 * the §13.6 emit→update→draw ordering without touching pixi's encoder. The
 * draw records raw commands into pixi's open GPURenderPassEncoder, then
 * `encoder.restoreRenderPass()` re-syncs pixi's state cache.
 *
 * WebGL2: the TF step + instanced draw run between pixi's own draws;
 * `renderer.resetState()` re-syncs pixi's GL state cache afterwards.
 *
 * WebGL1: no transform feedback, so the step runs on the CPU (webgl1/sim.ts)
 * and only the instanced draw touches GL, with the same re-sync after it.
 */
import type { ParamDef, System } from '@pylinka/graph';
import type { Renderer, WebGPURenderer } from 'pixi.js';
import { SystemClock } from '../compiled/emitter.js';
import type { KnobStore } from '../knobs.js';
import { pickSystem } from '../system.js';
import { extractParams, type EngineParams, type KnobValues } from '../webgl/params.js';
import type { AtlasConfig } from '../webgl/engine.js';
import { CpuSim } from '../webgl1/sim.js';
import { CpuRenderer, NoInstancingError } from '../webgl1/renderer.js';
import { unsupportedNodes } from '../webgl/support.js';
import { WebGL2CompiledSim } from '../webgl2/engine.js';
import { WebGPUSystemSim } from '../webgpu/engine.js';
import { resolveAnim, resolveSprite } from '../compiled/sprite.js';
import { registerSimBackend, type Affine, type SimBackend, type SimBackendDeps, type SimStats } from './sim.js';

/** Resolve a system's atlas (if any) to the sim's sprite + anim options. */
function spriteOpts(deps: SimBackendDeps): { sprite: ReturnType<typeof resolveSprite>; anim: ReturnType<typeof resolveAnim> } | undefined {
  return deps.atlas === undefined ? undefined : { sprite: resolveSprite(deps.atlas), anim: resolveAnim(deps.atlas) };
}

/** A sim step requested by prepare() but not yet run. GL/GPU work must happen
 *  ONLY inside execute() (in pixi's pass, wrapped by resetState), so prepare
 *  just queues the step + the emitter position it was requested at. */
interface QueuedStep {
  dt: number;
  ex: number;
  ey: number;
}
/** Bound the queue so a view that stops rendering (e.g. `visible = false`) can't
 *  accumulate work and then storm a catch-up when it reappears — it resumes. */
const MAX_QUEUED_STEPS = 4;
function queueStep(q: QueuedStep[], dt: number, ex: number, ey: number): void {
  q.push({ dt, ex, ey });
  if (q.length > MAX_QUEUED_STEPS) q.splice(0, q.length - MAX_QUEUED_STEPS);
}

/** A 2D affine matrix (pixi `Matrix`): x' = a·x + c·y + tx, y' = b·x + d·y + ty. */
interface Mat2D {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

/** Clip-space scaleOffset (§13.8) for the CURRENT render target: pixi's
 *  projection matrix (the screen OR a filter / render-texture FBO, with its own
 *  size, offset and flipY) composed with the view's world transform. Axis-
 *  aligned only — rotation is unsupported in v1. For the root projection this is
 *  byte-identical to the old `(2m.a/w, -2m.d/h, 2m.tx/w-1, 1-2m.ty/h)` form, so
 *  normal (unfiltered) rendering is unchanged; when a container is filtered or
 *  cached-as-texture, using pixi's own projection makes the particles land in
 *  the off-screen target instead of the screen. */
function projScaleOffset(p: Mat2D, m: Affine): [number, number, number, number] {
  return [p.a * m.a, p.d * m.d, p.a * m.tx + p.tx, p.d * m.ty + p.ty];
}

class WebGPUSimBackend implements SimBackend {
  /** Readable by a sibling: a sub-emitter child binds to its parent's buffers
   *  directly, and only the concrete sim has them. */
  readonly sim: WebGPUSystemSim;
  private readonly device: GPUDevice;
  private readonly renderer: WebGPURenderer;
  private readonly queue: QueuedStep[] = [];

  constructor(deps: SimBackendDeps) {
    this.device = deps.device as GPUDevice;
    this.renderer = deps.renderer as WebGPURenderer;
    const gpu = (navigator as { gpu?: GPU }).gpu;
    const format: GPUTextureFormat = gpu?.getPreferredCanvasFormat() ?? 'bgra8unorm';
    const antialias = (this.renderer as unknown as { view?: { antialias?: boolean } }).view?.antialias === true;
    const parent = deps.subParent instanceof WebGPUSimBackend ? deps.subParent.sim : undefined;
    this.sim = new WebGPUSystemSim(this.device, deps.system, deps.params, {
      format,
      multisample: antialias ? 4 : 1,
      knobs: deps.knobs,
      // the child reads the parent's live buffers, so it binds to them rather
      // than to the parent object
      ...(parent !== undefined
        ? { subParent: { hot: parent.hotBuffer, meta: parent.metaBuffer, capacity: parent.capacity } }
        : {}),
      ...(deps.seed !== undefined ? { seed: deps.seed } : {}),
      ...spriteOpts(deps),
      ...(deps.mask !== undefined ? { mask: deps.mask } : {}),
    });
  }

  get stats(): SimStats {
    return this.sim.stats;
  }

  prepare(dtSeconds: number): void {
    // Queue the step at the current emitter position; no GPU work here — it runs
    // in simulate() (called from execute(), inside pixi's render pass).
    queueStep(this.queue, dtSeconds, this.sim.clock.ex, this.sim.clock.ey);
  }

  setEmitter(x: number, y: number): void {
    this.sim.clock.ex = x;
    this.sim.clock.ey = y;
  }

  spawnBurst(count: number): void {
    this.sim.clock.spawnBurst(count);
  }

  simulate(): void {
    for (const s of this.queue) {
      this.sim.clock.ex = s.ex;
      this.sim.clock.ey = s.ey;
      this.sim.prepare(s.dt);
      const enc = this.device.createCommandEncoder();
      this.sim.encodeCompute(enc);
      const wantStats = this.sim.maybeEncodeStats(enc);
      this.device.queue.submit([enc.finish()]);
      if (wantStats) this.sim.resolveStats();
      this.sim.endFrame(s.dt);
    }
    this.queue.length = 0;
  }

  draw(worldTransform: Affine): void {
    // pixi's pass is open and its encoder cache is hot — the sanctioned interop
    // (see GpuEncoderSystem.restoreRenderPass) is: end pixi's pass, record our
    // own pass on the same command encoder with loadOp 'load' (content kept),
    // then restoreRenderPass() reopens pixi's pass and replays its cache.
    const renderer = this.renderer as unknown as {
      encoder: {
        commandEncoder: GPUCommandEncoder;
        finishRenderPass(): void;
        restoreRenderPass(): void;
      };
      renderTarget: {
        renderTarget: unknown;
        mipLevel: number;
        layer: number;
        viewport: { x: number; y: number; width: number; height: number };
        projectionMatrix: Mat2D;
        adaptor: {
          getDescriptor(
            renderTarget: unknown,
            clear: boolean,
            clearColor: [number, number, number, number],
            mipLevel?: number,
            layer?: number,
          ): GPURenderPassDescriptor;
        };
      };
    };
    const encoder = renderer.encoder;
    const rtSys = renderer.renderTarget;
    encoder.finishRenderPass();
    const descriptor = rtSys.adaptor.getDescriptor(
      rtSys.renderTarget,
      false,
      [0, 0, 0, 1],
      rtSys.mipLevel,
      rtSys.layer,
    );
    const pass = encoder.commandEncoder.beginRenderPass(descriptor);
    const vp = rtSys.viewport;
    pass.setViewport(vp.x, vp.y, vp.width, vp.height, 0, 1);
    // pixi's current render-target projection (screen or a filter/cache FBO)
    const [sx, sy, ox, oy] = projScaleOffset(rtSys.projectionMatrix, worldTransform);
    this.sim.draw(pass, sx, sy, ox, oy, 1);
    pass.end();
    encoder.restoreRenderPass();
  }

  apply(project: Parameters<SimBackend['apply']>[0]): boolean {
    return this.sim.applyProject(project);
  }

  restart(): void {
    this.sim.resetPool();
    this.sim.clock.reset();
  }

  destroy(): void {
    this.sim.destroy();
  }
}

class WebGL2SimBackend implements SimBackend {
  /** Readable by a sibling — see WebGPUSimBackend.sim. */
  readonly sim: WebGL2CompiledSim;
  private readonly renderer: Renderer;
  private readonly queue: QueuedStep[] = [];
  private statClock = 0;

  constructor(deps: SimBackendDeps) {
    this.renderer = deps.renderer as Renderer;
    const parent = deps.subParent instanceof WebGL2SimBackend ? deps.subParent.sim : undefined;
    this.sim = new WebGL2CompiledSim(deps.device as WebGL2RenderingContext, deps.system, deps.params, {
      knobs: deps.knobs,
      ...(parent !== undefined ? { subParent: parent } : {}),
      ...(deps.seed !== undefined ? { seed: deps.seed } : {}),
      ...spriteOpts(deps),
      ...(deps.mask !== undefined ? { mask: deps.mask } : {}),
    });
    // building the TF program, buffers and VAOs moved bindings pixi caches
    resyncPixiGl(this.renderer);
  }

  get stats(): SimStats {
    return this.sim.stats;
  }

  prepare(dtSeconds: number): void {
    // Queue only — the TF step mutates GL heavily, so it must run in simulate()
    // (from execute(), inside pixi's pass) where resetState() re-syncs pixi.
    queueStep(this.queue, dtSeconds, this.sim.clock.ex, this.sim.clock.ey);
  }

  setEmitter(x: number, y: number): void {
    this.sim.clock.ex = x;
    this.sim.clock.ey = y;
  }

  spawnBurst(count: number): void {
    this.sim.clock.spawnBurst(count);
  }

  simulate(): void {
    if (this.queue.length === 0) return;
    for (const s of this.queue) {
      this.sim.clock.ex = s.ex;
      this.sim.clock.ey = s.ey;
      this.sim.step(s.dt);
    }
    this.queue.length = 0;
    // GL has no cheap async counter readback — refresh the stat on the same
    // 30-frame cadence as the WebGPU backend (debug-tier sync readback)
    this.statClock += 1;
    if (this.statClock % 30 === 0) this.sim.aliveCount();
  }

  draw(worldTransform: Affine): void {
    const [sx, sy, ox, oy] = glScaleOffset(this.renderer, worldTransform);
    this.sim.draw(sx, sy, ox, oy, 1);
    resyncPixiGl(this.renderer);
  }

  apply(project: Parameters<SimBackend['apply']>[0]): boolean {
    return this.sim.applyProject(project);
  }

  restart(): void {
    this.sim.resetPool();
    this.sim.clock.reset();
  }

  destroy(): void {
    this.sim.destroy();
  }
}

/** Use pixi's CURRENT render-target projection, so a filtered / cached
 *  container renders the particles into its off-screen FBO, not the screen. */
function glScaleOffset(renderer: Renderer, worldTransform: Affine): [number, number, number, number] {
  const proj = (renderer as unknown as { renderTarget: { projectionMatrix: Mat2D } }).renderTarget.projectionMatrix;
  return projScaleOffset(proj, worldTransform);
}

/** Invalidate exactly the pixi GL caches a raw draw dirtied (program, VAO,
 *  blend, texture units). renderer.resetState() would also null the CURRENT
 *  RENDER TARGET mid-frame and break pixi's pass teardown. */
function resyncPixiGl(renderer: Renderer): void {
  // optional calls: a construction-time resync can run against a renderer that
  // is only partly set up (or a test double), and must not throw there
  const r = renderer as unknown as {
    shader?: { resetState?(): void };
    geometry?: { resetState?(): void };
    state?: { resetState?(): void };
    texture?: { resetState?(): void };
  };
  r.shader?.resetState?.();
  r.geometry?.resetState?.();
  r.state?.resetState?.();
  r.texture?.resetState?.();
}

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
    return this.defs.filter((d) => d.default.t !== 'f32' && d.default.t !== 'vec2').map((d) => d.name);
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

class WebGL1SimBackend implements SimBackend {
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

/** Register the built-in factories. Runs on import of '@pylinka/core/pixi'. */
export function registerCompiledBackends(): void {
  registerSimBackend('webgpu', (deps) => new WebGPUSimBackend(deps));
  registerSimBackend('webgl2', (deps) => new WebGL2SimBackend(deps));
  registerSimBackend('webgl1', (deps) => new WebGL1SimBackend(deps));
}
