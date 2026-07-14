/**
 * Compiled WebGL2 transform-feedback backend (REQUIREMENTS.md §13.12). Runs the
 * compiler's 'webgl2' output: the fused step vertex shader (emitSrc) with the
 * discard fragment stage (updateSrc), over ping-pong interleaved 56-byte state
 * buffers (WEBGL2_LAYOUT). Spawning is the cursor-window scheme — the runtime
 * advances `u_spawnCursor` by spawnCount each frame. Rendering mirrors §13.8.
 *
 * This is the compiled counterpart of the interpreted `@pylinka/core/webgl`
 * engine: same driving surface, but the whole graph runs as generated code.
 */
import { compile, WEBGL2_LAYOUT, type CompiledSystem } from '@pylinka/compiler';
import { hashGraph, V1_CATALOG, type ParamDef, type PylinkaProject, type System } from '@pylinka/graph';
import { SystemClock } from '../compiled/emitter.js';
import {
  BASE_SPRITE_PX,
  resolveAnim,
  resolveSprite,
  softDisc,
  STATIC_ANIM,
  type AtlasAnim,
  type SpriteSource,
} from '../compiled/sprite.js';
import { ValueTable } from '../compiled/staging.js';
import type {
  CompiledParticlesHandle,
  CompiledParticlesOptions,
  CompiledStats,
} from '../compiled/types.js';
import { KnobStore } from '../knobs.js';
import { clampDt } from '../time.js';
import { pickSystem } from '../webgpu/engine.js';
import { COMPILED_RENDER_FS, COMPILED_RENDER_VS } from './shaders.js';

const STRIDE = WEBGL2_LAYOUT.strideBytes;
const FLOATS = STRIDE / 4;
const FLAGS_WORD = 7; // uint offset 28 / 4

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Pylinka compiled shader failed: ${log}`);
  }
  return sh;
}

function link(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string,
  tfVaryings?: readonly string[],
): WebGLProgram {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fs));
  if (tfVaryings !== undefined) gl.transformFeedbackVaryings(prog, tfVaryings as string[], gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`Pylinka compiled program link failed: ${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

export interface WebGL2SimOptions {
  sprite?: SpriteSource;
  /** atlas animation config (column advance + row pick); defaults to static */
  anim?: AtlasAnim;
  /** share a project-wide knob store (KnobBus fan-out); defaults to its own */
  knobs?: KnobStore;
  seed?: number;
  startX?: number;
  startY?: number;
  onRecompile?: (info: { ms: number; reason: 'structural' | 'blend' }) => void;
}

/** Per-system compiled TF simulation + §13.8-style draw. */
export class WebGL2CompiledSim {
  readonly stats: CompiledStats = { aliveCount: 0, overflowCount: 0, gpuMs: null };
  readonly knobs: KnobStore;
  readonly clock: SystemClock;
  compiled: CompiledSystem;
  system: System;

  private readonly gl: WebGL2RenderingContext;
  private readonly onRecompile: WebGL2SimOptions['onRecompile'];
  private valueTable: ValueTable;
  private spawnCursor = 0;
  private cur = 0;

  private stepProg: WebGLProgram;
  private readonly renderProg: WebGLProgram;
  private readonly bufs: [WebGLBuffer, WebGLBuffer];
  private stepVAOs: [WebGLVertexArrayObject, WebGLVertexArrayObject];
  private readonly renderVAOs: [WebGLVertexArrayObject, WebGLVertexArrayObject];
  private readonly tf: WebGLTransformFeedback;
  private readonly cornerBuf: WebGLBuffer;
  private uStep = new Map<string, WebGLUniformLocation | null>();
  private readonly uRender = new Map<string, WebGLUniformLocation | null>();
  private readonly tex: WebGLTexture;
  private spriteCols = 1;
  private spriteRows = 1;
  private spriteFrameW = 64;
  private spriteFrameH = 64;
  private spriteAtlasW = 64;
  private spriteAtlasH = 64;
  private spritePad = 0;
  private anim: AtlasAnim = STATIC_ANIM;
  /** scratch for the flags readback (aliveCount) */
  private readbackWords: Uint32Array;

  get capacity(): number {
    return this.system.capacity;
  }

  constructor(gl: WebGL2RenderingContext, system: System, params: ParamDef[], opts: WebGL2SimOptions) {
    this.gl = gl;
    this.onRecompile = opts.onRecompile;
    this.system = system;

    this.compiled = compile({ system, params, assets: [] }, V1_CATALOG, 'webgl2');
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
    this.readbackWords = new Uint32Array(cap * FLOATS);
    const zero = new Float32Array(cap * FLOATS);
    this.bufs = [this.makeBuffer(zero), this.makeBuffer(zero)];

    this.stepProg = link(gl, this.compiled.emitSrc, this.compiled.updateSrc, WEBGL2_LAYOUT.varyings);
    this.renderProg = link(gl, COMPILED_RENDER_VS, COMPILED_RENDER_FS);
    this.cacheStepUniforms();
    for (const n of ['u_scaleOffset', 'u_grid', 'u_anim', 'u_frame', 'u_tex']) {
      this.uRender.set(n, gl.getUniformLocation(this.renderProg, n));
    }

    this.stepVAOs = [this.makeStepVAO(this.bufs[0]), this.makeStepVAO(this.bufs[1])];
    const corner = new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5]);
    this.cornerBuf = this.makeBuffer(corner);
    this.renderVAOs = [
      this.makeRenderVAO(this.cornerBuf, this.bufs[0]),
      this.makeRenderVAO(this.cornerBuf, this.bufs[1]),
    ];
    this.tf = gl.createTransformFeedback()!;

    const sprite = opts.sprite ?? softDisc();
    this.anim = opts.anim ?? STATIC_ANIM;
    this.tex = this.uploadSprite(sprite);
  }

  private cacheStepUniforms(): void {
    const gl = this.gl;
    this.uStep = new Map();
    const names = [
      'U.emitterPos', 'U.prevEmitterPos', 'U.emitterVel', 'U.dt', 'U.time',
      'U.frame', 'U.spawnCount', 'U.capacity', 'U.baseSeed', 'V[0]',
      WEBGL2_LAYOUT.spawnCursorUniform,
    ];
    for (const n of names) this.uStep.set(n, gl.getUniformLocation(this.stepProg, n));
  }

  private uploadSprite(sprite: SpriteSource): WebGLTexture {
    const gl = this.gl;
    this.spriteCols = sprite.cols;
    this.spriteRows = sprite.rows;
    this.spriteFrameW = sprite.frameW;
    this.spriteFrameH = sprite.frameH;
    this.spriteAtlasW = sprite.width;
    this.spriteAtlasH = sprite.height;
    this.spritePad = sprite.pad;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sprite.image);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  private makeBuffer(data: Float32Array): WebGLBuffer {
    const gl = this.gl;
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_COPY);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return b;
  }

  private makeStepVAO(buf: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const a of WEBGL2_LAYOUT.attribs) {
      const loc = gl.getAttribLocation(this.stepProg, a.name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      if (a.type === 'uint') gl.vertexAttribIPointer(loc, a.size, gl.UNSIGNED_INT, STRIDE, a.offsetBytes);
      else gl.vertexAttribPointer(loc, a.size, gl.FLOAT, false, STRIDE, a.offsetBytes);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);
    return vao;
  }

  private makeRenderVAO(corner: WebGLBuffer, state: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, state);
    const inst = (loc: number, size: number, off: number, uint = false) => {
      gl.enableVertexAttribArray(loc);
      if (uint) gl.vertexAttribIPointer(loc, size, gl.UNSIGNED_INT, STRIDE, off);
      else gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, off);
      gl.vertexAttribDivisor(loc, 1);
    };
    inst(1, 2, 0); // a_pos
    inst(2, 4, 32); // a_color
    inst(3, 1, 48); // a_size
    inst(4, 1, 52); // a_rot
    inst(5, 1, 28, true); // a_flags
    inst(6, 1, 16); // a_age
    inst(7, 1, 20); // a_life
    inst(8, 1, 24, true); // a_seed
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);
    return vao;
  }

  /** Zero both state buffers (flags 0 = dead) and rewind the cursor. */
  resetPool(): void {
    const gl = this.gl;
    const zero = new Float32Array(this.capacity * FLOATS);
    for (const b of this.bufs) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, zero, gl.DYNAMIC_COPY);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.spawnCursor = 0;
    this.stats.aliveCount = 0;
    this.stats.overflowCount = 0;
  }

  /** One TF step: schedule spawns, flush uniforms, run the fused kernel. */
  step(dt: number): void {
    const gl = this.gl;
    const c = this.clock;
    c.tick(dt);
    this.valueTable.refreshKnobs(this.knobs);

    const u = this.uStep;
    gl.useProgram(this.stepProg);
    gl.uniform2f(u.get('U.emitterPos')!, c.ex, c.ey);
    gl.uniform2f(u.get('U.prevEmitterPos')!, c.px, c.py);
    gl.uniform2f(u.get('U.emitterVel')!, c.velX(dt), c.velY(dt));
    gl.uniform1f(u.get('U.dt')!, dt);
    gl.uniform1f(u.get('U.time')!, c.time);
    gl.uniform1ui(u.get('U.frame')!, c.frame);
    gl.uniform1ui(u.get('U.spawnCount')!, c.spawnCount);
    gl.uniform1ui(u.get('U.capacity')!, this.capacity);
    gl.uniform1ui(u.get('U.baseSeed')!, c.baseSeed);
    gl.uniform4fv(u.get('V[0]')!, this.valueTable.data);
    gl.uniform1ui(u.get(WEBGL2_LAYOUT.spawnCursorUniform)!, this.spawnCursor);

    const dst = 1 - this.cur;
    gl.bindVertexArray(this.stepVAOs[this.cur]!);
    // the TF output buffer must not stay bound to a generic non-TF target
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.bufs[dst]!);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, this.capacity);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);

    this.cur = dst;
    this.spawnCursor = (this.spawnCursor + c.spawnCount) % this.capacity;
    c.endFrame(dt);
  }

  /** Instanced draw of the current state into the bound framebuffer. */
  draw(sx: number, sy: number, ox: number, oy: number, sizeScale: number): void {
    const gl = this.gl;
    gl.useProgram(this.renderProg);
    gl.uniform4f(this.uRender.get('u_scaleOffset')!, sx, sy, ox, oy);
    gl.uniform4f(this.uRender.get('u_grid')!, this.spriteCols, this.spriteRows, sizeScale * BASE_SPRITE_PX, this.spritePad);
    gl.uniform4f(this.uRender.get('u_anim')!, this.anim.fps, this.anim.play, this.anim.pick, this.anim.row);
    gl.uniform4f(this.uRender.get('u_frame')!, this.spriteFrameW, this.spriteFrameH, this.spriteAtlasW, this.spriteAtlasH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.uRender.get('u_tex')!, 0);

    gl.enable(gl.BLEND);
    const mode = this.system.blendMode;
    if (mode === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else if (mode === 'screen') gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.bindVertexArray(this.renderVAOs[this.cur]!);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.capacity);
    gl.bindVertexArray(null);
  }

  /** Synchronous flags readback (debug tier — mirrors the interpreted engine). */
  aliveCount(): number {
    const gl = this.gl;
    if (this.readbackWords.length !== this.capacity * FLOATS) {
      this.readbackWords = new Uint32Array(this.capacity * FLOATS);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[this.cur]!);
    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, this.readbackWords);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      if ((this.readbackWords[i * FLOATS + FLAGS_WORD]! & 1) !== 0) alive++;
    }
    this.stats.aliveCount = alive;
    return alive;
  }

  /** Same semantics as the WebGPU sim: zero-recompile for value edits. */
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

    const newHash = hashGraph(sys.graph);
    if (newHash !== this.compiled.graphHash) {
      const t0 = performance.now();
      let compiled: CompiledSystem;
      let prog: WebGLProgram;
      const gl = this.gl;
      try {
        compiled = compile({ system: sys, params: next.params, assets: [] }, V1_CATALOG, 'webgl2');
        prog = link(gl, compiled.emitSrc, compiled.updateSrc, WEBGL2_LAYOUT.varyings);
      } catch (err) {
        // an invalid intermediate edit must never kill a running effect —
        // keep the previous program until the graph compiles again
        console.warn('[pylinka] recompile failed; keeping previous program:', err);
        this.clock.setEmitterSettings(sys.emitter, this.capacity);
        return true;
      }
      gl.deleteProgram(this.stepProg);
      for (const v of this.stepVAOs) gl.deleteVertexArray(v);
      this.stepProg = prog;
      this.compiled = compiled;
      this.system = sys;
      this.cacheStepUniforms();
      this.stepVAOs = [this.makeStepVAO(this.bufs[0]), this.makeStepVAO(this.bufs[1])];
      this.valueTable = new ValueTable(compiled.uniforms, next.params);
      this.valueTable.refreshNodeValues(sys);
      this.resetPool();
      this.onRecompile?.({ ms: performance.now() - t0, reason: 'structural' });
    } else {
      this.system = sys;
      this.valueTable = new ValueTable(this.compiled.uniforms, next.params);
      this.valueTable.refreshNodeValues(sys);
    }
    this.clock.setEmitterSettings(sys.emitter, this.capacity);
    return true;
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteProgram(this.stepProg);
    gl.deleteProgram(this.renderProg);
    for (const b of this.bufs) gl.deleteBuffer(b);
    gl.deleteBuffer(this.cornerBuf);
    for (const v of this.stepVAOs) gl.deleteVertexArray(v);
    for (const v of this.renderVAOs) gl.deleteVertexArray(v);
    gl.deleteTransformFeedback(this.tf);
    gl.deleteTexture(this.tex);
  }
}

/**
 * Standalone compiled WebGL2 runtime — same handle surface as the webgpu
 * backend, synchronous creation (no adapter/device round-trip).
 */
export function createParticles(
  target: HTMLCanvasElement | WebGL2RenderingContext,
  project: PylinkaProject,
  opts: CompiledParticlesOptions = {},
): CompiledParticlesHandle {
  const gl =
    target instanceof WebGL2RenderingContext
      ? target
      : target.getContext('webgl2', { premultipliedAlpha: true, alpha: true });
  if (!gl) throw new Error('WebGL2 is not available on this target.');

  const system = pickSystem(project, opts.systemName);
  if (system === undefined) throw new Error('Project has no systems.');

  const canvas = gl.canvas as HTMLCanvasElement;
  const zoom = opts.zoom ?? 1;
  const sizeScale = opts.sizeScale ?? 1;
  const maxDt = opts.maxDt ?? 0.05;

  const sim = new WebGL2CompiledSim(gl, system, project.params, {
    sprite: resolveSprite(opts.atlas),
    anim: resolveAnim(opts.atlas),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    startX: (canvas.width * zoom) / 2,
    startY: (canvas.height * zoom) / 2,
    ...(opts.onRecompile !== undefined ? { onRecompile: opts.onRecompile } : {}),
  });

  let destroyed = false;
  const handle: CompiledParticlesHandle = {
    autoClear: true,
    backendName: 'webgl2',
    stats: sim.stats,
    update(dtSeconds: number) {
      if (destroyed) return;
      const dt = clampDt(dtSeconds, maxDt);
      sim.step(dt);
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (this.autoClear) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      const w = canvas.width * zoom;
      const h = canvas.height * zoom;
      sim.draw(2 / w, -2 / h, -1, 1, sizeScale);
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
      return sim.aliveCount();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      sim.destroy();
    },
  };
  return handle;
}
