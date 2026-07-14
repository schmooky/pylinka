/**
 * WebGPU compute backend (REQUIREMENTS.md §13). The graph is compiled to the
 * §13.5/§13.6 WGSL kernels and dispatched per frame — emit → update → draw in
 * one command encoder (§13.11), particle state in STORAGE|VERTEX buffers
 * (§13.2), inline literals + knobs in the vec4 value table (§13.3) so value
 * edits never recompile. Structural edits rebuild the compute pipelines and
 * reset the pool (§7.5).
 */
import { compile, type CompiledSystem } from '@pylinka/compiler';
import { hashGraph, V1_CATALOG, type ParamDef, type PylinkaProject, type System } from '@pylinka/graph';
import { SystemClock } from '../compiled/emitter.js';
import { BASE_SPRITE_PX, resolveSprite, softDisc, type CompiledAtlasOptions, type SpriteSource } from '../compiled/sprite.js';
import { ValueTable } from '../compiled/staging.js';
import type {
  CompiledParticlesHandle,
  CompiledParticlesOptions,
  CompiledStats,
} from '../compiled/types.js';
import { KnobStore } from '../knobs.js';
import { clampDt } from '../time.js';
import { blendState, RENDER_WGSL } from './shaders.js';

const HOT_STRIDE = 24;
const RND_STRIDE = 12;
const META_STRIDE = 8;
const COUNTERS_SIZE = 12;
const STATS_INTERVAL = 30; // frames between counter readbacks (§13.11 step 7)

/** Pick the system a handle drives (same rule as the interpreted backend). */
export function pickSystem(project: PylinkaProject, systemName?: string): System | undefined {
  return (
    project.systems.find((s) => s.name === systemName) ??
    project.systems.find((s) => s.enabled) ??
    project.systems[0]
  );
}

export interface WebGPUSimOptions {
  /** render target format (canvas preferred format / pixi's target) */
  format: GPUTextureFormat;
  /** sample count of the target pass (pixi antialias → 4); default 1 */
  multisample?: number;
  sprite?: SpriteSource;
  /** share a project-wide knob store (KnobBus fan-out); defaults to its own */
  knobs?: KnobStore;
  seed?: number;
  startX?: number;
  startY?: number;
  onRecompile?: (info: { ms: number; reason: 'structural' | 'blend' }) => void;
}

/**
 * Per-system WebGPU simulation + draw. Owns every §13.2 resource; reusable by
 * the standalone canvas runtime and the pixi render-pipe SimBackend.
 */
export class WebGPUSystemSim {
  readonly stats: CompiledStats = { aliveCount: 0, overflowCount: 0, gpuMs: null };
  readonly knobs: KnobStore;
  readonly clock: SystemClock;
  compiled: CompiledSystem;
  system: System;

  private readonly device: GPUDevice;
  private readonly format: GPUTextureFormat;
  private readonly multisample: number;
  private readonly onRecompile: WebGPUSimOptions['onRecompile'];
  private params: ParamDef[];
  private valueTable: ValueTable;

  private readonly hot: GPUBuffer;
  private readonly rnd: GPUBuffer;
  private readonly meta: GPUBuffer;
  private readonly counters: GPUBuffer;
  private readonly freeList: GPUBuffer;
  private readonly uBuf: GPUBuffer;
  private vBuf: GPUBuffer;
  private readonly rBuf: GPUBuffer;
  private readonly readback: GPUBuffer;
  private readonly sampler: GPUSampler;
  private texture: GPUTexture;
  private spriteCols = 1;
  private spriteRows = 1;

  private computeLayout: GPUBindGroupLayout;
  private computeBind: GPUBindGroup;
  private emitPipe: GPUComputePipeline;
  private updatePipe: GPUComputePipeline;
  private renderLayout: GPUBindGroupLayout;
  private renderBind: GPUBindGroup;
  private renderPipe: GPURenderPipeline;

  private readonly uStage = new Float32Array(12);
  private readonly uStageU32: Uint32Array;
  private readonly rStage = new Float32Array(8);
  private rDirty = true;
  private readbackInflight = false;
  private destroyed = false;

  get capacity(): number {
    return this.system.capacity;
  }

  constructor(device: GPUDevice, system: System, params: ParamDef[], opts: WebGPUSimOptions) {
    this.device = device;
    this.format = opts.format;
    this.multisample = opts.multisample ?? 1;
    this.onRecompile = opts.onRecompile;
    this.system = system;
    this.params = params;
    this.uStageU32 = new Uint32Array(this.uStage.buffer);

    this.compiled = compile({ system, params, assets: [] }, V1_CATALOG, 'webgpu');
    this.knobs = opts.knobs ?? new KnobStore(params);
    this.valueTable = new ValueTable(this.compiled.uniforms, params);
    this.valueTable.refreshNodeValues(system);
    this.clock = new SystemClock(
      system.emitter,
      system.capacity,
      opts.startX ?? 0,
      opts.startY ?? 0,
      opts.seed,
    );

    const cap = system.capacity;
    const mk = (size: number, usage: GPUBufferUsageFlags) => device.createBuffer({ size, usage });
    const simUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST;
    this.hot = mk(cap * HOT_STRIDE, simUsage);
    this.rnd = mk(cap * RND_STRIDE, simUsage);
    this.meta = mk(cap * META_STRIDE, simUsage);
    this.counters = mk(COUNTERS_SIZE, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.freeList = mk(cap * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.uBuf = mk(48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.vBuf = mk(this.valueTable.data.byteLength, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.rBuf = mk(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.readback = mk(COUNTERS_SIZE, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

    this.sampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.texture = this.uploadSprite(opts.sprite ?? softDisc());

    this.computeLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    ({ emit: this.emitPipe, update: this.updatePipe } = this.buildComputePipelines());
    this.computeBind = this.buildComputeBind();

    this.renderLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });
    this.renderPipe = this.buildRenderPipeline();
    this.renderBind = this.buildRenderBind();

    this.resetPool();
  }

  private uploadSprite(sprite: SpriteSource): GPUTexture {
    this.spriteCols = sprite.cols;
    this.spriteRows = sprite.rows;
    const tex = this.device.createTexture({
      size: [Math.max(1, sprite.width), Math.max(1, sprite.height)],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: sprite.image as GPUCopyExternalImageSource },
      { texture: tex, premultipliedAlpha: true },
      [Math.max(1, sprite.width), Math.max(1, sprite.height)],
    );
    return tex;
  }

  private buildComputePipelines(): { emit: GPUComputePipeline; update: GPUComputePipeline } {
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.computeLayout] });
    const emit = this.device.createComputePipeline({
      layout,
      compute: { module: this.device.createShaderModule({ code: this.compiled.emitSrc }), entryPoint: 'emit' },
    });
    const update = this.device.createComputePipeline({
      layout,
      compute: { module: this.device.createShaderModule({ code: this.compiled.updateSrc }), entryPoint: 'update' },
    });
    return { emit, update };
  }

  private buildComputeBind(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.computeLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uBuf } },
        { binding: 1, resource: { buffer: this.vBuf } },
        { binding: 2, resource: { buffer: this.hot } },
        { binding: 3, resource: { buffer: this.rnd } },
        { binding: 4, resource: { buffer: this.meta } },
        { binding: 5, resource: { buffer: this.counters } },
        { binding: 6, resource: { buffer: this.freeList } },
      ],
    });
  }

  private buildRenderPipeline(): GPURenderPipeline {
    const module = this.device.createShaderModule({ code: RENDER_WGSL });
    return this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.renderLayout] }),
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: HOT_STRIDE,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
          {
            arrayStride: RND_STRIDE,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'unorm8x4' },
              { shaderLocation: 2, offset: 4, format: 'float32' },
              { shaderLocation: 3, offset: 8, format: 'float32' },
            ],
          },
          {
            arrayStride: META_STRIDE,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 4, offset: 4, format: 'uint32' }],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [{ format: this.format, blend: blendState(this.system.blendMode) }],
      },
      primitive: { topology: 'triangle-list' },
      ...(this.multisample > 1 ? { multisample: { count: this.multisample } } : {}),
    });
  }

  private buildRenderBind(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.renderLayout,
      entries: [
        { binding: 0, resource: { buffer: this.rBuf } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.texture.createView() },
      ],
    });
  }

  /** Re-init freeList/counters/flags (§13.2 init; §7.5 pool reset). */
  resetPool(): void {
    const cap = this.capacity;
    const free = new Uint32Array(cap);
    for (let i = 0; i < cap; i++) free[i] = i;
    this.device.queue.writeBuffer(this.freeList, 0, free);
    this.device.queue.writeBuffer(this.counters, 0, new Int32Array([cap, 0, 0]));
    this.device.queue.writeBuffer(this.meta, 0, new Uint32Array(cap * 2));
    this.stats.aliveCount = 0;
    this.stats.overflowCount = 0;
  }

  /** §13.11 steps 1–4: schedule, stage, and flush the two uniform buffers. */
  prepare(dt: number): void {
    this.clock.tick(dt);
    const u = this.uStage;
    const c = this.clock;
    u[0] = c.ex;
    u[1] = c.ey;
    u[2] = c.px;
    u[3] = c.py;
    u[4] = c.velX(dt);
    u[5] = c.velY(dt);
    u[6] = dt;
    u[7] = c.time;
    this.uStageU32[8] = c.frame;
    this.uStageU32[9] = c.spawnCount;
    this.uStageU32[10] = this.capacity;
    this.uStageU32[11] = c.baseSeed;
    this.valueTable.refreshKnobs(this.knobs);
    this.device.queue.writeBuffer(this.uBuf, 0, this.uStage);
    this.device.queue.writeBuffer(this.vBuf, 0, this.valueTable.data);
  }

  /** §13.11 step 5: emit dispatch (if any) then update dispatch. */
  encodeCompute(encoder: GPUCommandEncoder): void {
    const pass = encoder.beginComputePass();
    pass.setBindGroup(0, this.computeBind);
    if (this.clock.spawnCount > 0) {
      pass.setPipeline(this.emitPipe);
      pass.dispatchWorkgroups(Math.ceil(this.clock.spawnCount / 64));
    }
    pass.setPipeline(this.updatePipe);
    pass.dispatchWorkgroups(Math.ceil(this.capacity / 256));
    pass.end();
  }

  /** Instanced §13.8 draw into an open render pass. */
  draw(pass: GPURenderPassEncoder, sx: number, sy: number, ox: number, oy: number, sizeScale: number): void {
    const r = this.rStage;
    if (
      this.rDirty ||
      r[0] !== sx || r[1] !== sy || r[2] !== ox || r[3] !== oy ||
      r[4] !== this.spriteCols || r[5] !== this.spriteRows || r[6] !== sizeScale * BASE_SPRITE_PX
    ) {
      r[0] = sx;
      r[1] = sy;
      r[2] = ox;
      r[3] = oy;
      r[4] = this.spriteCols;
      r[5] = this.spriteRows;
      r[6] = sizeScale * BASE_SPRITE_PX;
      r[7] = 0;
      this.device.queue.writeBuffer(this.rBuf, 0, r);
      this.rDirty = false;
    }
    pass.setPipeline(this.renderPipe);
    pass.setBindGroup(0, this.renderBind);
    pass.setVertexBuffer(0, this.hot);
    pass.setVertexBuffer(1, this.rnd);
    pass.setVertexBuffer(2, this.meta);
    pass.draw(6, this.capacity);
  }

  /** §13.11 step 7: encode the async counters copy every 30 frames. */
  maybeEncodeStats(encoder: GPUCommandEncoder): boolean {
    if (this.readbackInflight || this.clock.frame % STATS_INTERVAL !== 0) return false;
    encoder.copyBufferToBuffer(this.counters, 0, this.readback, 0, COUNTERS_SIZE);
    return true;
  }

  /** Kick the mapAsync after the encoder containing the stats copy was submitted. */
  resolveStats(): void {
    if (this.readbackInflight) return;
    this.readbackInflight = true;
    this.readback
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const words = new Uint32Array(this.readback.getMappedRange().slice(0));
        this.readback.unmap();
        this.stats.aliveCount = words[1] ?? 0;
        this.stats.overflowCount = words[2] ?? 0;
        this.readbackInflight = false;
      })
      .catch(() => {
        this.readbackInflight = false;
      });
  }

  endFrame(dt: number): void {
    this.clock.endFrame(dt);
  }

  /**
   * Apply an edited project. Value edits refresh the table (zero recompile);
   * a changed graph hash rebuilds compute pipelines + resets the pool; a blend
   * change rebuilds the render pipeline. Returns false when only a full
   * re-create can honor the edit (capacity change).
   */
  applyProject(next: PylinkaProject, systemName?: string): boolean {
    const sys = pickSystem(next, systemName ?? this.system.name);
    if (sys === undefined || sys.capacity !== this.capacity) return false;

    for (const pd of next.params) {
      if (!this.knobs.has(pd.name)) {
        const d = pd.default;
        if (d.t === 'f32') this.knobs.set(pd.name, d.v);
        else if (d.t === 'vec2') this.knobs.set(pd.name, d.v[0], d.v[1]);
      }
    }
    this.params = next.params;

    const newHash = hashGraph(sys.graph);
    if (newHash !== this.compiled.graphHash) {
      const t0 = performance.now();
      let compiled: CompiledSystem;
      try {
        compiled = compile({ system: sys, params: next.params, assets: [] }, V1_CATALOG, 'webgpu');
      } catch (err) {
        // an invalid intermediate edit must never kill a running effect —
        // keep the previous pipelines until the graph compiles again
        console.warn('[pylinka] recompile failed; keeping previous pipelines:', err);
        this.clock.setEmitterSettings(sys.emitter, this.capacity);
        return true;
      }
      this.compiled = compiled;
      this.system = sys;
      const table = new ValueTable(compiled.uniforms, next.params);
      table.refreshNodeValues(sys);
      if (table.data.byteLength !== this.valueTable.data.byteLength) {
        this.vBuf.destroy();
        this.vBuf = this.device.createBuffer({
          size: table.data.byteLength,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.computeBind = this.buildComputeBind();
      }
      this.valueTable = table;
      ({ emit: this.emitPipe, update: this.updatePipe } = this.buildComputePipelines());
      this.resetPool();
      this.onRecompile?.({ ms: performance.now() - t0, reason: 'structural' });
    } else {
      const blendChanged = sys.blendMode !== this.system.blendMode;
      this.system = sys;
      this.valueTable = new ValueTable(this.compiled.uniforms, next.params);
      this.valueTable.refreshNodeValues(sys);
      if (blendChanged) {
        const t0 = performance.now();
        this.renderPipe = this.buildRenderPipeline();
        this.onRecompile?.({ ms: performance.now() - t0, reason: 'blend' });
      }
    }
    this.clock.setEmitterSettings(sys.emitter, this.capacity);
    return true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const b of [this.hot, this.rnd, this.meta, this.counters, this.freeList, this.uBuf, this.vBuf, this.rBuf, this.readback]) {
      b.destroy();
    }
    this.texture.destroy();
  }
}

/** Resolve images that copyExternalImageToTexture can't take directly. */
async function toUploadable(atlas: CompiledAtlasOptions | undefined): Promise<CompiledAtlasOptions | undefined> {
  if (atlas === undefined) return undefined;
  if (typeof HTMLImageElement !== 'undefined' && atlas.image instanceof HTMLImageElement) {
    return { ...atlas, image: await createImageBitmap(atlas.image) };
  }
  return atlas;
}

interface SharedContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  refs: number;
}

/**
 * One device + configured context per canvas, shared by every handle on it
 * (multi-system compositing — a second `configure()` with a different device
 * would detach the first handle's swapchain). Keyed weakly; the promise is
 * stored so concurrent creates don't race into two devices.
 */
const canvasContexts = new WeakMap<HTMLCanvasElement, Promise<SharedContext>>();

async function acquireContext(canvas: HTMLCanvasElement): Promise<SharedContext> {
  const pending = canvasContexts.get(canvas);
  if (pending !== undefined) {
    const shared = await pending;
    shared.refs += 1;
    return shared;
  }
  const build = (async (): Promise<SharedContext> => {
    const gpu = (navigator as { gpu?: GPU }).gpu;
    if (gpu === undefined) throw new Error('WebGPU is not available in this browser.');
    const adapter = await gpu.requestAdapter();
    if (adapter === null) throw new Error('WebGPU adapter request failed.');
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (context === null) throw new Error('Could not create a webgpu canvas context.');
    const format = gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied' });
    return { device, context, format, refs: 1 };
  })();
  canvasContexts.set(canvas, build);
  try {
    return await build;
  } catch (e) {
    canvasContexts.delete(canvas);
    throw e;
  }
}

function releaseContext(canvas: HTMLCanvasElement, shared: SharedContext): void {
  shared.refs -= 1;
  if (shared.refs > 0) return;
  canvasContexts.delete(canvas);
  shared.context.unconfigure();
  shared.device.destroy();
}

/**
 * Standalone WebGPU runtime: one system per handle; handles on the same canvas
 * share a device + context (first clears, the rest composite) — the compiled
 * counterpart of `@pylinka/core/webgl`'s createParticles.
 */
export async function createParticles(
  canvas: HTMLCanvasElement,
  project: PylinkaProject,
  opts: CompiledParticlesOptions = {},
): Promise<CompiledParticlesHandle> {
  const shared = await acquireContext(canvas);
  const { device, context, format } = shared;

  const system = pickSystem(project, opts.systemName);
  if (system === undefined) throw new Error('Project has no systems.');

  const zoom = opts.zoom ?? 1;
  const sizeScale = opts.sizeScale ?? 1;
  const maxDt = opts.maxDt ?? 0.05;
  const sprite = resolveSprite(await toUploadable(opts.atlas));

  const sim = new WebGPUSystemSim(device, system, project.params, {
    format,
    sprite,
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    startX: (canvas.width * zoom) / 2,
    startY: (canvas.height * zoom) / 2,
    ...(opts.onRecompile !== undefined ? { onRecompile: opts.onRecompile } : {}),
  });

  let destroyed = false;
  const handle: CompiledParticlesHandle = {
    autoClear: true,
    backendName: 'webgpu',
    stats: sim.stats,
    update(dtSeconds: number) {
      if (destroyed) return;
      const dt = clampDt(dtSeconds, maxDt);
      sim.prepare(dt);
      const encoder = device.createCommandEncoder();
      sim.encodeCompute(encoder);
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            loadOp: this.autoClear ? 'clear' : 'load',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      const w = canvas.width * zoom;
      const h = canvas.height * zoom;
      sim.draw(pass, 2 / w, -2 / h, -1, 1, sizeScale);
      pass.end();
      const wantStats = sim.maybeEncodeStats(encoder);
      device.queue.submit([encoder.finish()]);
      if (wantStats) sim.resolveStats();
      sim.endFrame(dt);
    },
    setEmitter(x: number, y: number) {
      sim.clock.ex = x * zoom;
      sim.clock.ey = y * zoom;
    },
    spawnBurst(count: number) {
      sim.clock.spawnBurst(count);
    },
    setKnob(name: string, x: number, y?: number, z?: number, w?: number) {
      sim.knobs.set(name, x, y, z, w);
    },
    apply(next: PylinkaProject): boolean {
      return sim.applyProject(next, opts.systemName);
    },
    restart() {
      sim.resetPool();
      sim.clock.reset();
    },
    aliveCount() {
      return sim.stats.aliveCount;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      sim.destroy();
      releaseContext(canvas, shared);
    },
  };
  return handle;
}
