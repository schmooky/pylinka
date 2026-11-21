/**
 * GLSL ES 1.00 render program for the CPU backend: a port of the interpreted
 * engine's RENDER_VS / RENDER_FS (webgl/shaders.ts) that compiles on WebGL1.
 *
 * Differences from the WebGL2 program, all forced by GLSL ES 1.00:
 * - `attribute` / `varying` / `gl_FragColor` / `texture2D` instead of
 *   `in` / `out` / `texture`.
 * - The ease LUT is `vec4[32]` (one vec4 per sample, xyzw = size, colour,
 *   alpha, rotation) instead of `float[128]`. Drivers give every array element
 *   a whole vec4 slot, and WebGL1 only promises 128 vertex uniform vectors.
 * - No integer `min`, so LUT indices are clamped as floats.
 * - The clip transform is one `scaleOffset` vec4, so the same program draws a
 *   bare canvas and a pixi render target.
 * - `u_textured` is declared `mediump` in both stages: a uniform shared by the
 *   two stages must have the same precision, and the fragment stage cannot
 *   assume highp.
 */
import { EASE_LUT_N } from '../webgl/shaders.js';

/** Attribute locations, bound before link. */
export const ATTR = { corner: 0, pos: 1, age: 2, life: 3, seed: 4 } as const;

/** Floats per drawn particle: pos.xy, age, life, seed. */
export const DRAW_FLOATS = 5;

const EASE_GLSL = `
float easeSel(int e, float t) {
  if (e == 1) return t * t;
  if (e == 2) { float u = 1.0 - t; return 1.0 - u*u; }
  if (e == 3) return t * t * t;
  if (e == 4) { float u = 1.0 - t; return 1.0 - u*u*u; }
  if (e == 5) return 1.0 - cos(t * 1.5707963);
  if (e == 6) return sin(t * 1.5707963);
  if (e == 7) return 0.5 - 0.5 * cos(t * 3.1415926);
  if (e == 8) { if (t >= 1.0) return 1.0; return 1.0 - exp2(-10.0 * t); }
  return t;
}

uniform vec4 u_easeLut[${EASE_LUT_N}];
float lutAt(int i, vec4 ch) { return dot(u_easeLut[i], ch); }
float easeCh(int e, vec4 ch, float t) {
  if (e >= 0) return easeSel(e, t);
  float f = clamp(t, 0.0, 1.0) * ${(EASE_LUT_N - 1).toFixed(1)};
  float f0 = floor(f);
  float f1 = min(f0 + 1.0, ${(EASE_LUT_N - 1).toFixed(1)});
  return mix(lutAt(int(f0), ch), lutAt(int(f1), ch), f - f0);
}`;

export const CPU_RENDER_VS = `precision highp float;

attribute vec2 a_corner;
attribute vec2 a_pos;
attribute float a_age;
attribute float a_life;
attribute float a_seed;

uniform vec4  u_scaleOffset; // clip = world * xy + zw
uniform vec4  u_colorFrom;
uniform vec4  u_colorTo;
uniform float u_sizeFrom;
uniform float u_sizeTo;
uniform int   u_colorEase;
uniform int   u_sizeEase;
uniform float u_alphaFrom;
uniform float u_alphaTo;
uniform int   u_alphaEase;
uniform vec2  u_rotStart;
uniform vec2  u_spin;
uniform float u_rotFrom;
uniform float u_rotTo;
uniform int   u_rotEase;

uniform mediump float u_textured;
uniform vec2  u_atlasSize;
uniform vec2  u_frameSize;
uniform vec2  u_grid;
uniform float u_pad;
uniform float u_fps;
uniform float u_play;
uniform float u_pick;
uniform float u_seqRow;

varying vec2 v_uv;
varying vec4 v_color;
${EASE_GLSL}

float rHash(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

void main() {
  float alive = step(0.00001, a_life) * step(a_age, a_life);
  float tN = clamp(a_age / max(a_life, 1e-4), 0.0, 1.0);
  float size = mix(u_sizeFrom, u_sizeTo, easeCh(u_sizeEase, vec4(1.0, 0.0, 0.0, 0.0), tN)) * alive;

  float rot = mix(u_rotStart.x, u_rotStart.y, rHash(a_seed * 41.17 + 3.7))
            + mix(u_spin.x, u_spin.y, rHash(a_seed * 91.53 + 7.1)) * a_age
            + mix(u_rotFrom, u_rotTo, easeCh(u_rotEase, vec4(0.0, 0.0, 0.0, 1.0), tN));
  float rc = cos(rot);
  float rs = sin(rot);
  vec2 off = a_corner * size;
  vec2 world = a_pos + vec2(off.x * rc - off.y * rs, off.x * rs + off.y * rc);
  gl_Position = vec4(world * u_scaleOffset.xy + u_scaleOffset.zw, 0.0, 1.0);

  if (u_textured > 0.5) {
    float row = (u_pick > 0.5) ? u_seqRow : floor(a_seed * u_grid.y);
    row = clamp(row, 0.0, u_grid.y - 1.0);
    float col = (u_play > 1.5)
      ? clamp(floor(a_age * u_fps), 0.0, u_grid.x - 1.0)
      : (u_play > 0.5)
        ? mod(floor(a_age * u_fps), u_grid.x)
        : clamp(floor(tN * u_grid.x), 0.0, u_grid.x - 1.0);
    vec2 cellPx = vec2(col, row) * (u_frameSize + u_pad);
    v_uv = (cellPx + (a_corner + 0.5) * u_frameSize) / u_atlasSize;
  } else {
    v_uv = a_corner + 0.5;
  }
  v_color = mix(u_colorFrom, u_colorTo, easeCh(u_colorEase, vec4(0.0, 1.0, 0.0, 0.0), tN));
  v_color.a *= mix(u_alphaFrom, u_alphaTo, easeCh(u_alphaEase, vec4(0.0, 0.0, 1.0, 0.0), tN));
}`;

export const CPU_RENDER_FS = `precision mediump float;
varying vec2 v_uv;
varying vec4 v_color;
uniform mediump float u_textured;
uniform sampler2D u_atlas;
void main() {
  if (u_textured > 0.5) {
    vec4 t = texture2D(u_atlas, v_uv);
    float a = t.a * v_color.a;
    gl_FragColor = vec4(t.rgb * v_color.rgb * a, a);
  } else {
    float d = length(v_uv - 0.5) * 2.0;
    // 1 - smoothstep(0, 1, d) is what smoothstep(1, 0, d) computes on every
    // driver, but GLSL ES leaves edge0 >= edge1 undefined
    float a = (1.0 - smoothstep(0.0, 1.0, d)) * v_color.a;
    gl_FragColor = vec4(v_color.rgb * a, a);
  }
}`;

export const CPU_RENDER_UNIFORMS = [
  'u_scaleOffset',
  'u_colorFrom',
  'u_colorTo',
  'u_sizeFrom',
  'u_sizeTo',
  'u_colorEase',
  'u_sizeEase',
  'u_alphaFrom',
  'u_alphaTo',
  'u_alphaEase',
  'u_rotStart',
  'u_spin',
  'u_rotFrom',
  'u_rotTo',
  'u_rotEase',
  'u_easeLut',
  'u_textured',
  'u_atlas',
  'u_atlasSize',
  'u_frameSize',
  'u_grid',
  'u_pad',
  'u_fps',
  'u_play',
  'u_pick',
  'u_seqRow',
] as const;
