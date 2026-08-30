/**
 * The preview backdrop, drawn INTO the canvas.
 *
 * It has to be in the framebuffer, not a div behind it. A light blend mode adds
 * to the pixels it finds in the same buffer and cannot reach the page — so a
 * checkerboard sitting behind a transparent canvas would look like a backdrop
 * while `add` kept behaving as if the backdrop were black. Putting it here
 * means what you see under the particles is what they are actually adding to.
 *
 * It runs before the particle handles each frame, which is why they are all
 * created with `autoClear: false`: this pass owns the clear.
 */

export interface Backdrop {
  /** checkerboard squares, or a flat fill when both colours match */
  a: string;
  b: string;
  /** square size in device px */
  size: number;
}

const VS = `#version 300 es
precision highp float;
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform vec3 u_a;
uniform vec3 u_b;
uniform float u_size;
out vec4 frag;
void main() {
  vec2 cell = floor(gl_FragCoord.xy / max(u_size, 1.0));
  float odd = mod(cell.x + cell.y, 2.0);
  // opaque: the particles need something real to add to
  frag = vec4(mix(u_a, u_b, odd), 1.0);
}`;

/** '#rrggbb' → [r,g,b] in 0..1. */
function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').padEnd(6, '0');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4)];
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return sh;
}

/**
 * A backdrop pass bound to one GL context. Returns null when the context is not
 * WebGL2 (the compiled WebGPU backend owns its own canvas), in which case the
 * caller falls back to a plain clear.
 */
export function createBackdrop(gl: WebGL2RenderingContext): {
  draw(bg: Backdrop): void;
  destroy(): void;
} {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  const uA = gl.getUniformLocation(prog, 'u_a');
  const uB = gl.getUniformLocation(prog, 'u_b');
  const uSize = gl.getUniformLocation(prog, 'u_size');
  // a 3-vertex full-screen triangle needs no buffers, but WebGL2 still wants a
  // VAO bound for the draw
  const vao = gl.createVertexArray();

  return {
    draw(bg) {
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniform3fv(uA, rgb(bg.a));
      gl.uniform3fv(uB, rgb(bg.b));
      gl.uniform1f(uSize, bg.size);
      // the backdrop replaces whatever was there; the engines turn blending
      // back on for their own draw
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },
    destroy() {
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
    },
  };
}
