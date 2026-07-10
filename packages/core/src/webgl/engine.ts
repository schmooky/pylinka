/**
 * WebGL2 transform-feedback particle engine (REQUIREMENTS.md §13.12). The
 * simulation runs entirely on the GPU (TF vertex program, ping-pong buffers);
 * spawning uses the cursor-window scheme (no atomics). Rendering is one instanced
 * draw. No per-particle CPU work in steady state.
 */
import {
  RENDER_FS,
  RENDER_VS,
  STATE_FLOATS,
  TF_VARYINGS,
  UPDATE_FS,
  UPDATE_VS,
} from './shaders.js';
import type { EngineParams } from './params.js';

/** Resolved atlas-sequence config the engine renders. */
export interface AtlasConfig {
  image: TexImageSource;
  width: number;
  height: number;
  cols: number;
  rows: number;
  frameW: number;
  frameH: number;
  pad: number;
  fps: number;
  play: 0 | 1; // 0 once-over-life, 1 loop
  pick: 0 | 1; // 0 per-particle random row, 1 fixed row
  row: number; // fixed row when pick == 1
}

const STRIDE = STATE_FLOATS * 4; // bytes

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Pylinka shader compile failed: ${log}`);
  }
  return sh;
}

function link(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string,
  tfVaryings?: string[],
): WebGLProgram {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
  if (tfVaryings) gl.transformFeedbackVaryings(prog, tfVaryings, gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`Pylinka program link failed: ${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

export class WebGL2Engine {
  private readonly gl: WebGL2RenderingContext;
  private readonly capacity: number;
  private readonly updateProg: WebGLProgram;
  private readonly renderProg: WebGLProgram;
  private readonly bufs: [WebGLBuffer, WebGLBuffer];
  private readonly updateVAOs: [WebGLVertexArrayObject, WebGLVertexArrayObject];
  private readonly renderVAOs: [WebGLVertexArrayObject, WebGLVertexArrayObject];
  private readonly tf: WebGLTransformFeedback;
  private readonly uUpdate = new Map<string, WebGLUniformLocation | null>();
  private readonly uRender = new Map<string, WebGLUniformLocation | null>();

  private cur = 0;
  private spawnBase = 0;
  private frame = 0;

  private readonly sizeScale: number;
  private readonly atlas: AtlasConfig | undefined;
  private readonly tex: WebGLTexture | null = null;

  constructor(gl: WebGL2RenderingContext, params: EngineParams, sizeScale = 1, atlas?: AtlasConfig) {
    this.gl = gl;
    this.capacity = params.capacity;
    this.sizeScale = sizeScale;
    this.atlas = atlas;
    this.updateProg = link(gl, UPDATE_VS, UPDATE_FS, TF_VARYINGS);
    this.renderProg = link(gl, RENDER_VS, RENDER_FS);

    if (atlas) {
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // image-space uv (0 = top)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.image);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    const zero = new Float32Array(this.capacity * STATE_FLOATS);
    this.bufs = [this.makeBuffer(zero), this.makeBuffer(zero)];

    const corner = new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
    const cornerBuf = this.makeBuffer(corner);
    const idxBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

    this.updateVAOs = [this.makeUpdateVAO(this.bufs[0]), this.makeUpdateVAO(this.bufs[1])];
    this.renderVAOs = [
      this.makeRenderVAO(cornerBuf, this.bufs[0], idxBuf),
      this.makeRenderVAO(cornerBuf, this.bufs[1], idxBuf),
    ];
    this.tf = gl.createTransformFeedback()!;

    for (const n of UPDATE_UNIFORMS) this.uUpdate.set(n, gl.getUniformLocation(this.updateProg, n));
    for (const n of RENDER_UNIFORMS) this.uRender.set(n, gl.getUniformLocation(this.renderProg, n));
  }

  private makeBuffer(data: Float32Array): WebGLBuffer {
    const gl = this.gl;
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_COPY);
    return b;
  }

  private makeUpdateVAO(buf: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const attr = (name: string, size: number, off: number) => {
      const l = gl.getAttribLocation(this.updateProg, name);
      if (l < 0) return;
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, gl.FLOAT, false, STRIDE, off);
    };
    attr('i_pos', 2, 0);
    attr('i_vel', 2, 8);
    attr('i_age', 1, 16);
    attr('i_life', 1, 20);
    attr('i_seed', 1, 24);
    gl.bindVertexArray(null);
    return vao;
  }

  private makeRenderVAO(
    corner: WebGLBuffer,
    state: WebGLBuffer,
    idx: WebGLBuffer,
  ): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, state);
    const inst = (loc: number, size: number, off: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, off);
      gl.vertexAttribDivisor(loc, 1);
    };
    inst(1, 2, 0); // a_pos
    inst(2, 1, 16); // a_age
    inst(3, 1, 20); // a_life
    inst(4, 1, 24); // a_seed
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bindVertexArray(null);
    return vao;
  }

  /** Advance the simulation by dt, spawning `spawnCount` new particles. */
  step(
    dt: number,
    spawnCount: number,
    emitter: readonly [number, number],
    wind: readonly [number, number],
    p: EngineParams,
  ): void {
    const gl = this.gl;
    const u = this.uUpdate;
    gl.useProgram(this.updateProg);
    gl.uniform1f(u.get('u_dt')!, dt);
    gl.uniform2f(u.get('u_gravity')!, p.gravity[0], p.gravity[1]);
    gl.uniform2f(u.get('u_wind')!, wind[0], wind[1]);
    gl.uniform1f(u.get('u_drag')!, p.drag);
    gl.uniform2f(u.get('u_emitter')!, emitter[0], emitter[1]);
    gl.uniform2f(u.get('u_velMin')!, p.velMin[0], p.velMin[1]);
    gl.uniform2f(u.get('u_velMax')!, p.velMax[0], p.velMax[1]);
    gl.uniform1f(u.get('u_lifeMin')!, p.lifeMin);
    gl.uniform1f(u.get('u_lifeMax')!, p.lifeMax);
    gl.uniform1f(u.get('u_spawnBase')!, this.spawnBase);
    gl.uniform1f(u.get('u_spawnCount')!, spawnCount);
    gl.uniform1f(u.get('u_capacity')!, this.capacity);
    gl.uniform1f(u.get('u_frame')!, this.frame);
    gl.uniform1i(u.get('u_shape')!, p.shape);
    gl.uniform1f(u.get('u_shapeR')!, p.shapeRadius);
    gl.uniform2f(u.get('u_shapeSize')!, p.shapeSize[0], p.shapeSize[1]);

    const dst = 1 - this.cur;
    gl.bindVertexArray(this.updateVAOs[this.cur]!);
    // The generic ARRAY_BUFFER binding must not reference the TF output buffer
    // (WebGL2 forbids a buffer bound to both a TF and a non-TF target). The VAO
    // holds the attribute bindings, so clearing the generic point is safe.
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
    this.spawnBase = (this.spawnBase + spawnCount) % this.capacity;
    this.frame += 1;
  }

  /** Draw the current state into the bound framebuffer at the given size. */
  render(width: number, height: number, p: EngineParams): void {
    const gl = this.gl;
    const u = this.uRender;
    gl.useProgram(this.renderProg);
    gl.uniform2f(u.get('u_resolution')!, width, height);
    gl.uniform4fv(u.get('u_colorFrom')!, p.colorFrom);
    gl.uniform4fv(u.get('u_colorTo')!, p.colorTo);
    gl.uniform1f(u.get('u_sizeFrom')!, p.sizeFrom * this.sizeScale);
    gl.uniform1f(u.get('u_sizeTo')!, p.sizeTo * this.sizeScale);
    gl.uniform1i(u.get('u_colorEase')!, p.colorEase);
    gl.uniform1i(u.get('u_sizeEase')!, p.sizeEase);

    const a = this.atlas;
    gl.uniform1i(u.get('u_textured')!, a ? 1 : 0);
    if (a) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.uniform1i(u.get('u_atlas')!, 0);
      gl.uniform2f(u.get('u_atlasSize')!, a.width, a.height);
      gl.uniform2f(u.get('u_frameSize')!, a.frameW, a.frameH);
      gl.uniform2f(u.get('u_grid')!, a.cols, a.rows);
      gl.uniform1f(u.get('u_pad')!, a.pad);
      gl.uniform1f(u.get('u_fps')!, a.fps);
      gl.uniform1i(u.get('u_play')!, a.play);
      gl.uniform1i(u.get('u_pick')!, a.pick);
      gl.uniform1f(u.get('u_seqRow')!, a.row);
    }

    gl.enable(gl.BLEND);
    if (p.blend === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else if (p.blend === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.bindVertexArray(this.renderVAOs[this.cur]!);
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, this.capacity);
    gl.bindVertexArray(null);
  }

  /**
   * Count alive particles by reading back the current state buffer. NOTE: this
   * is a synchronous GPU readback and stalls the pipeline — use for debugging /
   * a stats HUD, not every frame.
   */
  aliveCount(): number {
    const gl = this.gl;
    const out = new Float32Array(this.capacity * STATE_FLOATS);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[this.cur]!);
    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, out);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      const life = out[i * STATE_FLOATS + 5]!;
      const age = out[i * STATE_FLOATS + 4]!;
      if (life > 0 && age < life) alive++;
    }
    return alive;
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteProgram(this.updateProg);
    gl.deleteProgram(this.renderProg);
    for (const b of this.bufs) gl.deleteBuffer(b);
    for (const v of this.updateVAOs) gl.deleteVertexArray(v);
    for (const v of this.renderVAOs) gl.deleteVertexArray(v);
    gl.deleteTransformFeedback(this.tf);
    if (this.tex) gl.deleteTexture(this.tex);
  }
}

const UPDATE_UNIFORMS = [
  'u_dt', 'u_gravity', 'u_wind', 'u_drag', 'u_emitter', 'u_velMin', 'u_velMax',
  'u_lifeMin', 'u_lifeMax', 'u_spawnBase', 'u_spawnCount', 'u_capacity', 'u_frame',
  'u_shape', 'u_shapeR', 'u_shapeSize',
];
const RENDER_UNIFORMS = [
  'u_resolution', 'u_colorFrom', 'u_colorTo', 'u_sizeFrom', 'u_sizeTo', 'u_colorEase', 'u_sizeEase',
  'u_textured', 'u_atlas', 'u_atlasSize', 'u_frameSize', 'u_grid', 'u_pad', 'u_fps', 'u_play',
  'u_pick', 'u_seqRow',
];
