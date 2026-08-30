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
 */
import type { Renderer, WebGPURenderer } from 'pixi.js';
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
    // use pixi's CURRENT render-target projection so a filtered / cached
    // container renders the particles into its off-screen FBO, not the screen.
    const proj = (this.renderer as unknown as { renderTarget: { projectionMatrix: Mat2D } }).renderTarget.projectionMatrix;
    const [sx, sy, ox, oy] = projScaleOffset(proj, worldTransform);
    this.sim.draw(sx, sy, ox, oy, 1);
    // invalidate exactly the pixi GL caches the raw draw dirtied (program, VAO,
    // blend, texture units). renderer.resetState() would also null the CURRENT
    // RENDER TARGET mid-frame and break pixi's pass teardown.
    const r = this.renderer as unknown as {
      shader: { resetState(): void };
      geometry: { resetState(): void };
      state: { resetState(): void };
      texture: { resetState(): void };
    };
    r.shader.resetState();
    r.geometry.resetState();
    r.state.resetState();
    r.texture.resetState();
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

/** Register both built-in factories. Runs on import of '@pylinka/core/pixi'. */
export function registerCompiledBackends(): void {
  registerSimBackend('webgpu', (deps) => new WebGPUSimBackend(deps));
  registerSimBackend('webgl2', (deps) => new WebGL2SimBackend(deps));
}
