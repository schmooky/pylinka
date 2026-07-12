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
import { registerSimBackend, type Affine, type SimBackend, type SimBackendDeps, type SimStats } from './sim.js';

/** Map a pixi worldTransform (scale/translate; rotation unsupported in v1) +
 *  logical target size onto the §13.8 scaleOffset. */
function scaleOffset(
  m: Affine,
  w: number,
  h: number,
): [number, number, number, number] {
  return [(2 * m.a) / w, (-2 * m.d) / h, (2 * m.tx) / w - 1, 1 - (2 * m.ty) / h];
}

class WebGPUSimBackend implements SimBackend {
  private readonly sim: WebGPUSystemSim;
  private readonly device: GPUDevice;
  private readonly renderer: WebGPURenderer;
  private pending = false;
  private dt = 0;

  constructor(deps: SimBackendDeps) {
    this.device = deps.device as GPUDevice;
    this.renderer = deps.renderer as WebGPURenderer;
    const gpu = (navigator as { gpu?: GPU }).gpu;
    const format: GPUTextureFormat = gpu?.getPreferredCanvasFormat() ?? 'bgra8unorm';
    const antialias = (this.renderer as unknown as { view?: { antialias?: boolean } }).view?.antialias === true;
    this.sim = new WebGPUSystemSim(this.device, deps.system, deps.params, {
      format,
      multisample: antialias ? 4 : 1,
      knobs: deps.knobs,
      ...(deps.seed !== undefined ? { seed: deps.seed } : {}),
    });
  }

  get stats(): SimStats {
    return this.sim.stats;
  }

  prepare(dtSeconds: number): void {
    if (this.pending) this.simulate(); // fixed-step: flush the previous step first
    this.dt = dtSeconds;
    this.sim.prepare(dtSeconds);
    this.pending = true;
  }

  setEmitter(x: number, y: number): void {
    this.sim.clock.ex = x;
    this.sim.clock.ey = y;
  }

  spawnBurst(count: number): void {
    this.sim.clock.spawnBurst(count);
  }

  simulate(): void {
    if (!this.pending) return;
    this.pending = false;
    const enc = this.device.createCommandEncoder();
    this.sim.encodeCompute(enc);
    const wantStats = this.sim.maybeEncodeStats(enc);
    this.device.queue.submit([enc.finish()]);
    if (wantStats) this.sim.resolveStats();
    this.sim.endFrame(this.dt);
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
      width: number;
      height: number;
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
    const [sx, sy, ox, oy] = scaleOffset(worldTransform, renderer.width, renderer.height);
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
  private readonly sim: WebGL2CompiledSim;
  private readonly renderer: Renderer;
  private pending = false;
  private dt = 0;
  private statClock = 0;

  constructor(deps: SimBackendDeps) {
    this.renderer = deps.renderer as Renderer;
    this.sim = new WebGL2CompiledSim(deps.device as WebGL2RenderingContext, deps.system, deps.params, {
      knobs: deps.knobs,
      ...(deps.seed !== undefined ? { seed: deps.seed } : {}),
    });
  }

  get stats(): SimStats {
    return this.sim.stats;
  }

  prepare(dtSeconds: number): void {
    if (this.pending) this.simulate(); // fixed-step: flush the previous step first
    this.dt = dtSeconds;
    this.pending = true;
  }

  setEmitter(x: number, y: number): void {
    this.sim.clock.ex = x;
    this.sim.clock.ey = y;
  }

  spawnBurst(count: number): void {
    this.sim.clock.spawnBurst(count);
  }

  simulate(): void {
    if (!this.pending) return;
    this.pending = false;
    this.sim.step(this.dt);
    // GL has no cheap async counter readback — refresh the stat on the same
    // 30-frame cadence as the WebGPU backend (debug-tier sync readback)
    this.statClock += 1;
    if (this.statClock % 30 === 0) this.sim.aliveCount();
  }

  draw(worldTransform: Affine): void {
    const [sx, sy, ox, oy] = scaleOffset(worldTransform, this.renderer.width, this.renderer.height);
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
