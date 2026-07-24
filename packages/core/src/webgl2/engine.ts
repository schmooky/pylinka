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
import { buildMaskTable, MASK_TEX_WIDTH, type MaskTable } from '../compiled/mask.js';
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

/** handle → sim, so a sub-emitter child can reach its parent's state buffers. */
const simOf = new WeakMap<CompiledParticlesHandle, WebGL2CompiledSim>();

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
  /** emission-mask point table (overrides the analytic spawn shape) */
  mask?: MaskTable;
  /** sub-emitter parent sim: this child spawns on the parent's particle deaths */
  subParent?: WebGL2CompiledSim;
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
  private readonly _capacity: number;
  private readonly subParent: WebGL2CompiledSim | null = null;
  /** parent-slot count (death detection loops these); child pool = parentCap × burstMax. */
  private parentCap = 0;
  /** death-burst copies: `max` k-region passes per frame (1 = classic sub-emitter). */
  private burstMax = 1;
  private subProg: WebGLProgram | null = null;
  /** [childCur][parentCur][burstK] — one VAO per ping-pong × burst copy. */
  private subVAOs: WebGLVertexArrayObject[][][] = [];
  private uSub = new Map<string, WebGLUniformLocation | null>();

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
  private maskTex: WebGLTexture | null = null;
  private maskCount = 0;
  private maskW = 1;
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
    return this._capacity;
  }
  /** Live ping-pong index + state buffers, so a sub-emitter child can bind them. */
  get curIndex(): number {
    return this.cur;
  }
  bufferAt(i: number): WebGLBuffer {
    return this.bufs[i]!;
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

    // a sub-emitter mirrors its parent slot-for-slot → shares its capacity. A
    // death-burst spawns up to `max` children per parent death, so the child
    // pool is parentCapacity × max, laid out in `max` blocked regions; the
    // sub-step runs one pass per region (see subStep).
    this.subParent = opts.subParent ?? null;
    this.burstMax = this.subParent ? (this.compiled.burst?.max ?? 1) : 1;
    this.parentCap = this.subParent ? this.subParent.capacity : system.capacity;
    const cap = this.subParent ? this.parentCap * this.burstMax : system.capacity;
    this._capacity = cap;
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

    if (this.subParent) this.buildSubStep();

    const sprite = opts.sprite ?? softDisc();
    this.anim = opts.anim ?? STATIC_ANIM;
    this.tex = this.uploadSprite(sprite);
    if (opts.mask && opts.mask.count > 0) this.uploadMask(opts.mask);
  }

  /** Sub-emitter program + VAOs: child state[childCur] + parent cur/prev state
   *  ([childCur][parentCur]), so death is read from the parent's ping-pong. */
  private buildSubStep(): void {
    const gl = this.gl;
    const p = this.subParent!;
    // updateSrc is the rasterizer-discard fragment stage for this target
    this.subProg = link(gl, this.compiled.subSrc, this.compiled.updateSrc, WEBGL2_LAYOUT.varyings);
    for (const n of [
      'U.emitterPos', 'U.prevEmitterPos', 'U.emitterVel', 'U.dt', 'U.time',
      'U.frame', 'U.spawnCount', 'U.capacity', 'U.baseSeed', 'V[0]',
    ]) this.uSub.set(n, gl.getUniformLocation(this.subProg, n));
    if (this.compiled.burst) this.uSub.set('u_burstK', gl.getUniformLocation(this.subProg, 'u_burstK'));
    const regionBytes = this.parentCap * STRIDE;
    this.subVAOs = [0, 1].map((childCur) =>
      [0, 1].map((parentCur) =>
        Array.from({ length: this.burstMax }, (_, k) =>
          this.makeSubVAO(
            this.bufs[childCur]!,
            k * regionBytes,
            p.bufferAt(parentCur),
            p.bufferAt(1 - parentCur),
          ),
        ),
      ),
    );
  }

  /** VAO for the sub-step. Own state is read from the child region for this
   *  burst copy (`childOff` = k · parentCap · stride), so `max` passes cover the
   *  whole child pool; parent cur/prev are always read from region 0 (parent
   *  slot = vertex id). i_pVel feeds velocity inheritance under a burst. */
  private makeSubVAO(
    child: WebGLBuffer,
    childOff: number,
    pCur: WebGLBuffer,
    pPrev: WebGLBuffer,
  ): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, child);
    for (const a of WEBGL2_LAYOUT.attribs) {
      const loc = gl.getAttribLocation(this.subProg!, a.name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      if (a.type === 'uint') gl.vertexAttribIPointer(loc, a.size, gl.UNSIGNED_INT, STRIDE, childOff + a.offsetBytes);
      else gl.vertexAttribPointer(loc, a.size, gl.FLOAT, false, STRIDE, childOff + a.offsetBytes);
    }
    const bind = (buf: WebGLBuffer, name: string, size: number, off: number, uint: boolean) => {
      const loc = gl.getAttribLocation(this.subProg!, name);
      if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      if (uint) gl.vertexAttribIPointer(loc, size, gl.UNSIGNED_INT, STRIDE, off);
      else gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, off);
    };
    bind(pCur, 'i_pPos', 2, 0, false); // parent pos (offset 0)
    bind(pCur, 'i_pVel', 2, 8, false); // parent death-velocity (burst inheritance; absent → skipped)
    bind(pCur, 'i_pFlags', 1, 28, true); // parent flags now (offset 28)
    bind(pPrev, 'i_pFlagsPrev', 1, 28, true); // parent flags prev
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);
    return vao;
  }

  /** RG32F row-major point table (2048 wide), sampled with texelFetch. */
  private uploadMask(mask: MaskTable): void {
    const gl = this.gl;
    const w = Math.min(mask.count, MASK_TEX_WIDTH);
    const h = Math.ceil(mask.count / MASK_TEX_WIDTH);
    const data = new Float32Array(w * h * 2);
    data.set(mask.points.subarray(0, mask.count * 2));
    this.maskTex = gl.createTexture();
    this.maskCount = mask.count;
    this.maskW = w;
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, w, h, 0, gl.RG, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private cacheStepUniforms(): void {
    const gl = this.gl;
    this.uStep = new Map();
    const names = [
      'U.emitterPos', 'U.prevEmitterPos', 'U.emitterVel', 'U.dt', 'U.time',
      'U.frame', 'U.spawnCount', 'U.capacity', 'U.baseSeed', 'V[0]',
      WEBGL2_LAYOUT.spawnCursorUniform, 'u_maskTbl', 'u_maskCount', 'u_maskW',
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

    if (this.subProg && this.subParent) {
      this.subStep(dt);
      return;
    }

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
    gl.uniform1f(u.get('u_maskCount')!, this.maskCount);
    gl.uniform1f(u.get('u_maskW')!, this.maskW);
    if (this.maskTex) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.uniform1i(u.get('u_maskTbl')!, 1);
      gl.activeTexture(gl.TEXTURE0);
    }

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

  /** Sub-emitter TF step: spawn on parent deaths (read from the parent's
   *  current + previous state), then run the child's own update. The parent
   *  is stepped earlier this frame, so its `curIndex` is the fresh buffer. */
  private subStep(dt: number): void {
    const gl = this.gl;
    const c = this.clock;
    const u = this.uSub;
    gl.useProgram(this.subProg!);
    gl.uniform2f(u.get('U.emitterPos')!, c.ex, c.ey);
    gl.uniform2f(u.get('U.prevEmitterPos')!, c.px, c.py);
    gl.uniform2f(u.get('U.emitterVel')!, c.velX(dt), c.velY(dt));
    gl.uniform1f(u.get('U.dt')!, dt);
    gl.uniform1f(u.get('U.time')!, c.time);
    gl.uniform1ui(u.get('U.frame')!, c.frame);
    gl.uniform1ui(u.get('U.spawnCount')!, 0);
    gl.uniform1ui(u.get('U.capacity')!, this.capacity);
    gl.uniform1ui(u.get('U.baseSeed')!, c.baseSeed);
    gl.uniform4fv(u.get('V[0]')!, this.valueTable.data);

    const dst = 1 - this.cur;
    const parentCur = this.subParent!.curIndex;
    const uK = this.uSub.get('u_burstK') ?? null;
    const regionBytes = this.parentCap * STRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
    gl.enable(gl.RASTERIZER_DISCARD);
    // one pass per burst copy k: read child region k + parent region 0, write
    // child region k. Without a burst this is a single whole-buffer pass.
    for (let k = 0; k < this.burstMax; k++) {
      if (uK) gl.uniform1i(uK, k);
      gl.bindVertexArray(this.subVAOs[this.cur]![parentCur]![k]!);
      gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.bufs[dst]!, k * regionBytes, regionBytes);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, this.parentCap);
      gl.endTransformFeedback();
    }
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);

    this.cur = dst;
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
    if (this.maskTex) gl.deleteTexture(this.maskTex);
    if (this.subProg) gl.deleteProgram(this.subProg);
    for (const a of this.subVAOs) for (const row of a) for (const v of row) gl.deleteVertexArray(v);
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
  const maskTable = buildMaskTable(opts.emissionMask);
  const parentSim = opts.subParent ? simOf.get(opts.subParent) : undefined;
  if (opts.subParent && !parentSim) throw new Error('subParent is not a live WebGL2 compiled handle.');

  // The project can be edited live, so the rebuild after a context loss has to
  // use the LATEST one, not the one we were constructed with.
  let curProject = project;
  const makeSim = () =>
    new WebGL2CompiledSim(gl, pickSystem(curProject, opts.systemName) ?? system, curProject.params, {
      sprite: resolveSprite(opts.atlas),
      anim: resolveAnim(opts.atlas),
      ...(maskTable ? { mask: maskTable } : {}),
      ...(parentSim ? { subParent: parentSim } : {}),
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      startX: (canvas.width * zoom) / 2,
      startY: (canvas.height * zoom) / 2,
      ...(opts.onRecompile !== undefined ? { onRecompile: opts.onRecompile } : {}),
    });
  let sim = makeSim();

  // Context loss throws away every GL object, so the sim is rebuilt from
  // scratch when the browser gives the context back. Knob writes and the
  // emitter position are replayed onto the new one; particle state is not,
  // because the buffers come back empty.
  let lost = false;
  let needsRebuild = false;
  const knobLog = new Map<string, [number, number, number, number]>();
  const onLost = (e: Event) => {
    e.preventDefault(); // without this the browser never restores the context
    lost = true;
    opts.onContextLost?.();
  };
  const onRestored = () => {
    lost = false;
    needsRebuild = true;
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  let destroyed = false;
  const handle: CompiledParticlesHandle = {
    autoClear: true,
    backendName: 'webgl2',
    get stats() {
      return sim.stats;
    },
    get contextLost() {
      return lost;
    },
    update(dtSeconds: number) {
      if (destroyed || lost) return;
      if (needsRebuild) {
        needsRebuild = false;
        const { ex, ey } = sim.clock;
        sim = makeSim();
        sim.clock.ex = ex;
        sim.clock.ey = ey;
        for (const [name, v] of knobLog) sim.knobs.set(name, v[0], v[1], v[2], v[3]);
        simOf.set(handle, sim);
        opts.onContextRestored?.();
      }
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
      knobLog.set(name, [x, y ?? 0, z ?? 0, w ?? 0]);
      sim.knobs.set(name, x, y, z, w);
    },
    apply(next: PylinkaProject): boolean {
      curProject = next;
      return sim.applyProject(next, opts.systemName);
    },
    restart() {
      sim.resetPool();
      sim.clock.reset();
    },
    aliveCount() {
      return lost || needsRebuild ? 0 : sim.aliveCount();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      simOf.delete(handle);
      if (!lost) sim.destroy(); // a lost context already freed everything
    },
  };
  simOf.set(handle, sim);
  return handle;
}
