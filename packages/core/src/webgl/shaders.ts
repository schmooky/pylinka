/**
 * GLSL ES 3.00 for the WebGL2 backend (REQUIREMENTS.md §13.12). Simulation runs
 * on the GPU via transform feedback (no CPU per-particle work); rendering is one
 * instanced draw. Spawning uses the cursor-window scheme (no atomics on WebGL2).
 *
 * Particle state layout (7 floats, tightly packed, stride 28 bytes):
 *   pos.xy, vel.xy, age, life, seed
 */

/** Shared ease selector (subset of §13.9), by integer index. */
const EASE_GLSL = `
float easeSel(int e, float t) {
  if (e == 1) return t * t;                              // power1.in
  if (e == 2) { float u = 1.0 - t; return 1.0 - u*u; }   // power1.out
  if (e == 3) return t * t * t;                          // power2.in
  if (e == 4) { float u = 1.0 - t; return 1.0 - u*u*u; } // power2.out
  if (e == 5) return 1.0 - cos(t * 1.5707963);           // sine.in
  if (e == 6) return sin(t * 1.5707963);                 // sine.out
  if (e == 7) return 0.5 - 0.5 * cos(t * 3.1415926);     // sine.inOut
  if (e == 8) { if (t >= 1.0) return 1.0; return 1.0 - exp2(-10.0 * t); } // expo.out
  return t;                                              // linear
}`;

/** Ease name → shader index (mirror of EASE_GLSL). */
export const EASE_INDEX: Record<string, number> = {
  linear: 0,
  'power1.in': 1,
  'power1.out': 2,
  'power2.in': 3,
  'power2.out': 4,
  'sine.in': 5,
  'sine.out': 6,
  'sine.inOut': 7,
  'expo.out': 8,
};

/** Update (simulation) vertex shader — outputs new state via transform feedback. */
export const UPDATE_VS = `#version 300 es
precision highp float;

in vec2 i_pos;
in vec2 i_vel;
in float i_age;
in float i_life;
in float i_seed;

out vec2 o_pos;
out vec2 o_vel;
out float o_age;
out float o_life;
out float o_seed;

uniform float u_dt;
uniform vec2  u_gravity;
uniform vec2  u_wind;        // direction * power, precomputed on the CPU
uniform float u_drag;
uniform vec2  u_emitter;
uniform vec2  u_velMin;
uniform vec2  u_velMax;
uniform float u_lifeMin;
uniform float u_lifeMax;
uniform float u_spawnBase;   // cursor
uniform float u_spawnCount;
uniform float u_capacity;
uniform float u_frame;
uniform int   u_shape;       // 0 point, 1 circle, 2 rect
uniform float u_shapeR;
uniform vec2  u_shapeSize;

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float rnd(float s, float k) { return hash11(s * 57.31 + k * 131.7 + 0.123); }

void main() {
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0); // required by ANGLE/Metal even under rasterizer discard
  float id = float(gl_VertexID);
  bool alive = (i_life > 0.0) && (i_age < i_life);

  float rel = mod(id - u_spawnBase + u_capacity, u_capacity);
  bool inWindow = rel < u_spawnCount;

  if (!alive && inWindow) {
    float s = hash11(id * 7.77 + u_frame * 3.13 + 1.0);
    vec2 off = vec2(0.0);
    if (u_shape == 1) { float a = 6.2831853 * rnd(s, 1.0); off = vec2(cos(a), sin(a)) * u_shapeR * sqrt(rnd(s, 9.0)); }
    else if (u_shape == 2) { off = (vec2(rnd(s, 1.0), rnd(s, 2.0)) - 0.5) * u_shapeSize; }
    o_pos  = u_emitter + off;
    o_vel  = mix(u_velMin, u_velMax, vec2(rnd(s, 3.0), rnd(s, 4.0)));
    o_life = mix(u_lifeMin, u_lifeMax, rnd(s, 5.0));
    o_age  = 0.0;
    o_seed = s;
    return;
  }

  if (!alive) {
    o_pos = i_pos; o_vel = i_vel; o_age = i_age; o_life = 0.0; o_seed = i_seed;
    return;
  }

  vec2 force = u_gravity + u_wind;
  vec2 vel = i_vel + force * u_dt;
  vel *= exp(-u_drag * u_dt);
  o_pos  = i_pos + vel * u_dt;
  o_vel  = vel;
  o_age  = i_age + u_dt;
  o_life = i_life;
  o_seed = i_seed;
}`;

/** Trivial fragment shader for the TF (rasterizer-discard) pass. */
export const UPDATE_FS = `#version 300 es
precision highp float;
out vec4 c;
void main() { c = vec4(0.0); }`;

/** Render vertex shader — instanced quad, size + color over life. */
export const RENDER_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;   // -0.5..0.5
layout(location = 1) in vec2 a_pos;      // instance
layout(location = 2) in float a_age;
layout(location = 3) in float a_life;

uniform vec2  u_resolution;
uniform vec4  u_colorFrom;
uniform vec4  u_colorTo;
uniform float u_sizeFrom;
uniform float u_sizeTo;
uniform int   u_colorEase;
uniform int   u_sizeEase;

out vec2 v_uv;
out vec4 v_color;
${EASE_GLSL}

void main() {
  float alive = step(0.00001, a_life) * step(a_age, a_life);
  float tN = clamp(a_age / max(a_life, 1e-4), 0.0, 1.0);
  float size = mix(u_sizeFrom, u_sizeTo, easeSel(u_sizeEase, tN)) * alive;

  vec2 world = a_pos + a_corner * size;
  vec2 clip = vec2(world.x / u_resolution.x * 2.0 - 1.0, 1.0 - world.y / u_resolution.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);

  v_uv = a_corner + 0.5;
  v_color = mix(u_colorFrom, u_colorTo, easeSel(u_colorEase, tN));
}`;

/** Render fragment shader — soft radial sprite, premultiplied out. */
export const RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
out vec4 frag;
void main() {
  float d = length(v_uv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d) * v_color.a;
  frag = vec4(v_color.rgb * a, a);   // premultiplied
}`;

export const TF_VARYINGS = ['o_pos', 'o_vel', 'o_age', 'o_life', 'o_seed'];
export const STATE_FLOATS = 7; // pos.xy vel.xy age life seed
