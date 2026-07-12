/**
 * Render program for the compiled WebGL2 backend — the GLSL mirror of the
 * §13.8 WebGPU render pipeline, reading the fused 56-byte interleaved state
 * records the compiler's TF step shader writes (WEBGL2_LAYOUT). u_atlas =
 * (cols, rows, sizeScale, unused), matching the WebGPU R.atlas convention.
 */

export const COMPILED_RENDER_VS = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_pos;    // instance — state offset 0
layout(location = 2) in vec4 a_color;  // instance — state offset 32
layout(location = 3) in float a_size;  // instance — state offset 48
layout(location = 4) in float a_rot;   // instance — state offset 52
layout(location = 5) in uint a_flags;  // instance — state offset 28

uniform vec4 u_scaleOffset; // clip = world.xy * xy + zw (§13.8)
uniform vec4 u_atlas;       // cols, rows, sizeScale, unused

out vec2 v_uv;
out vec4 v_tint;

void main() {
  float s = a_size * float(a_flags & 1u) * u_atlas.z;
  float c = cos(a_rot);
  float sn = sin(a_rot);
  vec2 local = vec2(a_corner.x * c - a_corner.y * sn, a_corner.x * sn + a_corner.y * c) * s;
  vec2 world = a_pos + local;
  uint texIndex = (a_flags >> 8u) & 0xffu;
  uint cols = uint(max(u_atlas.x, 1.0));
  vec2 cell = vec2(float(texIndex % cols), float(texIndex / cols));
  gl_Position = vec4(world * u_scaleOffset.xy + u_scaleOffset.zw, 0.0, 1.0);
  v_uv = (a_corner + 0.5 + cell) / max(u_atlas.xy, vec2(1.0));
  v_tint = a_color;
}`;

export const COMPILED_RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_tint;
out vec4 frag;
uniform sampler2D u_tex;
void main() {
  vec4 t = texture(u_tex, v_uv); // premultiplied (§13.1)
  frag = vec4(t.rgb * v_tint.rgb * v_tint.a, t.a * v_tint.a);
}`;
