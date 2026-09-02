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


/*
 * The scene reference, drawn INTO the canvas between the backdrop and the
 * particles.
 *
 * As a DOM layer it could only be wholly behind the canvas — invisible, since
 * the backdrop above is opaque — or wholly in front, painting over the effect
 * it exists to be judged against. Inside the framebuffer there is a middle,
 * which is where a reference belongs: the particles land on top of it, the way
 * they will in the game.
 */
const IMG_VS = `#version 300 es
precision highp float;
uniform vec4 u_rect;   // x, y, w, h in clip space
out vec2 v_uv;
const vec2 C[6] = vec2[6](
  vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(0.0, 1.0),
  vec2(1.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 1.0));
void main() {
  vec2 c = C[gl_VertexID];
  // c.y 0 is the TOP edge of the rect (the rect's height is negative in clip
  // space, which is where the flip already happened), so v follows it directly
  v_uv = c;
  gl_Position = vec4(u_rect.xy + c * u_rect.zw, 0.0, 1.0);
}`;

const IMG_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_opacity;
out vec4 frag;
void main() {
  vec4 t = texture(u_tex, v_uv);
  float a = t.a * u_opacity;
  frag = vec4(t.rgb * a, a);   // premultiplied, like everything else here
}`;

/** Where a reference image sits, in the same world units the particles use. */
export interface BackdropImage {
  image: TexImageSource;
  /** centre of the image, in world units */
  center: [number, number];
  /** drawn size in world units */
  size: [number, number];
  opacity: number;
}

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
  /**
   * Draw a reference image over the backdrop, under the particles.
   *
   * `view` is the window the renderer is drawing through — the same zoom and
   * offset the handles were given — so the image tracks the effect when the
   * preview is panned or zoomed instead of sliding off it.
   */
  drawImage(img: BackdropImage, view: { zoom: number; offset: [number, number]; wPx: number; hPx: number }): void;
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
  // the image pass is built on first use: most projects have no reference
  let imgProg: WebGLProgram | null = null;
  let tex: WebGLTexture | null = null;
  let uRect: WebGLUniformLocation | null = null;
  let uOpacity: WebGLUniformLocation | null = null;
  let lastImage: TexImageSource | null = null;

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
    drawImage(img, view) {
      if (imgProg === null) {
        imgProg = gl.createProgram()!;
        gl.attachShader(imgProg, compile(gl, gl.VERTEX_SHADER, IMG_VS));
        gl.attachShader(imgProg, compile(gl, gl.FRAGMENT_SHADER, IMG_FS));
        gl.linkProgram(imgProg);
        uRect = gl.getUniformLocation(imgProg, 'u_rect');
        uOpacity = gl.getUniformLocation(imgProg, 'u_opacity');
        tex = gl.createTexture();
      }
      // re-upload only when the source changed: a reference is a still image,
      // and this runs every frame
      if (lastImage !== img.image) {
        lastImage = img.image;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img.image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      // world -> clip, the mapping the render shader uses: subtract the view
      // offset, divide by the world the canvas covers, flip y
      const worldW = view.wPx * view.zoom;
      const worldH = view.hPx * view.zoom;
      const x0 = img.center[0] - img.size[0] / 2 - view.offset[0];
      const y0 = img.center[1] - img.size[1] / 2 - view.offset[1];
      const cx = (x0 / worldW) * 2 - 1;
      const cy = 1 - (y0 / worldH) * 2;
      const cw = (img.size[0] / worldW) * 2;
      const ch = -(img.size[1] / worldH) * 2;

      gl.useProgram(imgProg);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform4f(uRect, cx, cy, cw, ch);
      gl.uniform1f(uOpacity, img.opacity);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied over
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
    },
    destroy() {
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
      if (imgProg !== null) gl.deleteProgram(imgProg);
      if (tex !== null) gl.deleteTexture(tex);
    },
  };
}
