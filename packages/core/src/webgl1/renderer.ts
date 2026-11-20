/**
 * Instanced draw of CPU-simulated particles on WebGL1 (or a WebGL2 context
 * used through the WebGL1 API).
 *
 * Each draw copies the alive particles into a compact buffer and uploads it,
 * so the GPU only sees particles that are visible. Instancing comes from
 * `ANGLE_instanced_arrays` on WebGL1, which every WebGL1 implementation in use
 * exposes; a context without it throws at construction rather than drawing
 * nothing.
 *
 * The renderer touches only global GL state that it can leave clean: it unbinds
 * any VAO before it sets attributes (so a host VAO is never modified), and it
 * resets the divisors and disables the arrays it enabled after the draw. A host
 * such as pixi still has to re-sync its own caches afterwards.
 */
import type { AtlasConfig } from '../webgl/engine.js';
import type { EngineParams } from '../webgl/params.js';
import { EASE_LUT_CHANNELS, EASE_LUT_N } from '../webgl/shaders.js';
import { CPU_STATE_FLOATS } from './sim.js';
import { ATTR, CPU_RENDER_FS, CPU_RENDER_UNIFORMS, CPU_RENDER_VS, DRAW_FLOATS } from './shaders.js';

const INSTANCED = [ATTR.pos, ATTR.age, ATTR.life, ATTR.seed] as const;

/** A WebGL1 context, or a WebGL2 context driven through the WebGL1 API. */
export type AnyGL = WebGLRenderingContext | WebGL2RenderingContext;

/** WebGL2 detection that does not throw where `WebGL2RenderingContext` is undefined. */
export function isWebGL2(gl: AnyGL): gl is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
}

interface Instancing {
  divisor(loc: number, n: number): void;
  draw(instances: number): void;
}

function instancing(gl: AnyGL): Instancing | null {
  if (isWebGL2(gl)) {
    return {
      divisor: (l, n) => gl.vertexAttribDivisor(l, n),
      draw: (i) => gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, i),
    };
  }
  const ext = gl.getExtension('ANGLE_instanced_arrays');
  if (!ext) return null;
  return {
    divisor: (l, n) => ext.vertexAttribDivisorANGLE(l, n),
    draw: (i) => ext.drawElementsInstancedANGLE(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, i),
  };
}

/** Unbind the current VAO, if the context has VAOs, so attribute calls hit the default one. */
function unbindVao(gl: AnyGL): void {
  if (isWebGL2(gl)) {
    gl.bindVertexArray(null);
    return;
  }
  gl.getExtension('OES_vertex_array_object')?.bindVertexArrayOES(null);
}

function compile(gl: AnyGL, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Pylinka WebGL1 shader compile failed: ${log}`);
  }
  return sh;
}

function link(gl: AnyGL): WebGLProgram {
  const prog = gl.createProgram()!;
  const vs = compile(gl, gl.VERTEX_SHADER, CPU_RENDER_VS);
  const fs = compile(gl, gl.FRAGMENT_SHADER, CPU_RENDER_FS);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, ATTR.corner, 'a_corner');
  gl.bindAttribLocation(prog, ATTR.pos, 'a_pos');
  gl.bindAttribLocation(prog, ATTR.age, 'a_age');
  gl.bindAttribLocation(prog, ATTR.life, 'a_life');
  gl.bindAttribLocation(prog, ATTR.seed, 'a_seed');
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`Pylinka WebGL1 program link failed: ${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

/** Repack the channel-major float LUT into vec4-per-sample order. */
export function packEaseLut(lut: readonly number[], out: Float32Array): void {
  for (let i = 0; i < EASE_LUT_N; i++) {
    for (let ch = 0; ch < EASE_LUT_CHANNELS; ch++) out[i * 4 + ch] = lut[ch * EASE_LUT_N + i] ?? 0;
  }
}

/**
 * Copy alive particles from a state buffer into a compact draw buffer.
 * Returns how many were copied.
 */
export function compactAlive(state: Float32Array, capacity: number, out: Float32Array): number {
  let n = 0;
  for (let i = 0; i < capacity; i++) {
    const o = i * CPU_STATE_FLOATS;
    const age = state[o + 4]!;
    const life = state[o + 5]!;
    if (!(life > 0 && age < life)) continue;
    const d = n * DRAW_FLOATS;
    out[d] = state[o]!;
    out[d + 1] = state[o + 1]!;
    out[d + 2] = age;
    out[d + 3] = life;
    out[d + 4] = state[o + 6]!;
    n++;
  }
  return n;
}

export class CpuRenderer {
  private readonly gl: AnyGL;
  private readonly capacity: number;
  private readonly atlas: AtlasConfig | undefined;
  private readonly inst: Instancing;
  private readonly drawData: Float32Array;
  private readonly lut = new Float32Array(EASE_LUT_N * 4);
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();

  private prog!: WebGLProgram;
  private cornerBuf!: WebGLBuffer;
  private idxBuf!: WebGLBuffer;
  private instBuf!: WebGLBuffer;
  private tex: WebGLTexture | null = null;

  /** Particles drawn by the last draw() (the alive count). */
  drawn = 0;

  constructor(gl: AnyGL, capacity: number, atlas?: AtlasConfig) {
    const inst = instancing(gl);
    if (!inst) throw new Error('Pylinka on WebGL1 needs the ANGLE_instanced_arrays extension.');
    this.gl = gl;
    this.inst = inst;
    this.capacity = capacity;
    this.atlas = atlas;
    this.drawData = new Float32Array(capacity * DRAW_FLOATS);
    this.createResources();
  }

  /** (Re)create every GL object. Call again after a context restore. */
  createResources(): void {
    const gl = this.gl;
    this.uniforms.clear();
    this.prog = link(gl);
    for (const n of CPU_RENDER_UNIFORMS) this.uniforms.set(n, gl.getUniformLocation(this.prog, n));

    this.cornerBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]),
      gl.STATIC_DRAW,
    );
    this.instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.drawData.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // the element binding lives in the VAO, so bind it with none bound
    unbindVao(gl);
    this.idxBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

    const a = this.atlas;
    this.tex = null;
    if (a) {
      this.tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      // same upload as the interpreted engine: image-space uv, straight alpha
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, a.image);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      // WebGL1 cannot mip or wrap a non-power-of-two texture: linear + clamp only
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  /**
   * Draw `state` into the bound framebuffer. `sx, sy, ox, oy` map world px to
   * clip space: clip = world * (sx, sy) + (ox, oy).
   */
  draw(
    state: Float32Array,
    stateCapacity: number,
    p: EngineParams,
    sizeScale: number,
    sx: number,
    sy: number,
    ox: number,
    oy: number,
  ): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const n = compactAlive(state, Math.min(stateCapacity, this.capacity), this.drawData);
    this.drawn = n;
    if (n === 0) return;

    const u = this.uniforms;
    gl.useProgram(this.prog);
    gl.uniform4f(u.get('u_scaleOffset')!, sx, sy, ox, oy);
    gl.uniform4fv(u.get('u_colorFrom')!, p.colorFrom);
    gl.uniform4fv(u.get('u_colorTo')!, p.colorTo);
    gl.uniform1f(u.get('u_sizeFrom')!, p.sizeFrom * sizeScale);
    gl.uniform1f(u.get('u_sizeTo')!, p.sizeTo * sizeScale);
    gl.uniform1i(u.get('u_colorEase')!, p.colorEase);
    gl.uniform1i(u.get('u_sizeEase')!, p.sizeEase);
    gl.uniform1f(u.get('u_alphaFrom')!, p.alphaFrom);
    gl.uniform1f(u.get('u_alphaTo')!, p.alphaTo);
    gl.uniform1i(u.get('u_alphaEase')!, p.alphaEase);
    gl.uniform2f(u.get('u_rotStart')!, p.rotStart[0], p.rotStart[1]);
    gl.uniform2f(u.get('u_spin')!, p.spin[0], p.spin[1]);
    gl.uniform1f(u.get('u_rotFrom')!, p.rotFrom);
    gl.uniform1f(u.get('u_rotTo')!, p.rotTo);
    gl.uniform1i(u.get('u_rotEase')!, p.rotEase);
    if (p.colorEase < 0 || p.sizeEase < 0 || p.alphaEase < 0 || p.rotEase < 0) {
      packEaseLut(p.easeLut, this.lut);
      gl.uniform4fv(u.get('u_easeLut')!, this.lut);
    }

    const a = this.atlas;
    gl.uniform1f(u.get('u_textured')!, a ? 1 : 0);
    if (a) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.uniform1i(u.get('u_atlas')!, 0);
      gl.uniform2f(u.get('u_atlasSize')!, a.width, a.height);
      gl.uniform2f(u.get('u_frameSize')!, a.frameW, a.frameH);
      gl.uniform2f(u.get('u_grid')!, a.cols, a.rows);
      gl.uniform1f(u.get('u_pad')!, a.pad);
      gl.uniform1f(u.get('u_fps')!, a.fps);
      gl.uniform1f(u.get('u_play')!, a.play);
      gl.uniform1f(u.get('u_pick')!, a.pick);
      gl.uniform1f(u.get('u_seqRow')!, a.row);
    }

    gl.enable(gl.BLEND);
    // additive blends alpha too: see webgl/engine.ts render()
    if (p.blend === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else if (p.blend === 'screen')
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    unbindVao(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.drawData.subarray(0, n * DRAW_FLOATS));

    const stride = DRAW_FLOATS * 4;
    const inst = (loc: number, size: number, off: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
      this.inst.divisor(loc, 1);
    };
    inst(ATTR.pos, 2, 0);
    inst(ATTR.age, 1, 8);
    inst(ATTR.life, 1, 12);
    inst(ATTR.seed, 1, 16);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.enableVertexAttribArray(ATTR.corner);
    gl.vertexAttribPointer(ATTR.corner, 2, gl.FLOAT, false, 0, 0);
    this.inst.divisor(ATTR.corner, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);

    this.inst.draw(n);

    // leave the default attribute state as a non-instanced host expects it
    for (const loc of INSTANCED) this.inst.divisor(loc, 0);
    gl.disableVertexAttribArray(ATTR.corner);
    for (const loc of INSTANCED) gl.disableVertexAttribArray(loc);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  destroy(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.deleteProgram(this.prog);
    gl.deleteBuffer(this.cornerBuf);
    gl.deleteBuffer(this.idxBuf);
    gl.deleteBuffer(this.instBuf);
    if (this.tex) gl.deleteTexture(this.tex);
  }
}
