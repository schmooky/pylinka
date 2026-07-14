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
layout(location = 6) in float a_age;   // instance — state offset 16
layout(location = 7) in float a_life;  // instance — state offset 20
layout(location = 8) in uint a_seed;   // instance — state offset 24

uniform vec4 u_scaleOffset; // clip = world.xy * xy + zw (§13.8)
uniform vec4 u_grid;        // cols, rows, sizeScale, pad(px)
uniform vec4 u_anim;        // fps, play(0 once / 1 loop), pick(0 per-particle / 1 fixed), fixedRow
uniform vec4 u_frame;       // frameW, frameH, atlasW, atlasH (px)

out vec2 v_uv;
out vec4 v_tint;

void main() {
  float s = a_size * float(a_flags & 1u) * u_grid.z;
  float c = cos(a_rot);
  float sn = sin(a_rot);
  vec2 local = vec2(a_corner.x * c - a_corner.y * sn, a_corner.x * sn + a_corner.y * c) * s;
  vec2 world = a_pos + local;

  // atlas cell: column advances with life, row is per-particle (or fixed).
  float cols = max(u_grid.x, 1.0);
  float rows = max(u_grid.y, 1.0);
  float tN = clamp(a_age / max(a_life, 1e-4), 0.0, 1.0);
  float seedN = float(a_seed & 0xffffu) / 65536.0;
  float row = clamp((u_anim.z > 0.5) ? u_anim.w : floor(seedN * rows), 0.0, rows - 1.0);
  float col = (u_anim.y > 0.5)
    ? mod(floor(a_age * u_anim.x), cols)
    : clamp(floor(tN * cols), 0.0, cols - 1.0);
  vec2 cellPx = vec2(col, row) * (u_frame.xy + u_grid.w);

  gl_Position = vec4(world * u_scaleOffset.xy + u_scaleOffset.zw, 0.0, 1.0);
  v_uv = (cellPx + (a_corner + 0.5) * u_frame.xy) / u_frame.zw;
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
