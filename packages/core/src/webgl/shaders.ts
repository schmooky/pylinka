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

/**
 * Shared force-field GLSL for both update shaders: up to 4 "point fields"
 * (vortex swirl / radial attract-repel) + curl-of-value-noise turbulence.
 * u_pfA[k] = center.xy, tangential, pull(+ = inward);
 * u_pfB[k] = falloffRadius(0 = global), emitterRelative(0/1).
 */
const FORCE_GLSL = `
uniform float u_pfCount;
uniform vec4  u_pfA[4];
uniform vec2  u_pfB[4];
uniform vec3  u_turb;   // strength, cell px, speed
uniform float u_time;

vec2 pointForces(vec2 pos, vec2 emitter) {
  vec2 f = vec2(0.0);
  for (int k = 0; k < 4; k++) {
    if (float(k) >= u_pfCount) break;
    vec2 c = u_pfA[k].xy + (u_pfB[k].y > 0.5 ? emitter : vec2(0.0));
    vec2 d = pos - c;
    float len = max(length(d), 1e-3);
    vec2 dir = d / len;
    float w = u_pfB[k].x > 0.0 ? clamp(1.0 - len / u_pfB[k].x, 0.0, 1.0) : 1.0;
    f += (vec2(-dir.y, dir.x) * u_pfA[k].z - dir * u_pfA[k].w) * w;
  }
  return f;
}

float vnHash(vec2 i, float t) { return fract(sin(dot(i, vec2(127.1, 311.7)) + t) * 43758.5453); }
float vnoise(vec2 p, float t) {
  vec2 i = floor(p);
  vec2 fr = fract(p);
  vec2 u = fr * fr * (3.0 - 2.0 * fr);
  float a = vnHash(i, t);
  float b = vnHash(i + vec2(1.0, 0.0), t);
  float c = vnHash(i + vec2(0.0, 1.0), t);
  float d = vnHash(i + vec2(1.0, 1.0), t);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec2 turbForce(vec2 pos) {
  if (u_turb.x == 0.0) return vec2(0.0);
  vec2 uv = pos / max(u_turb.y, 1.0);
  float t = u_time * u_turb.z;
  float e = 0.35;
  float nx0 = vnoise(uv - vec2(e, 0.0), t);
  float nx1 = vnoise(uv + vec2(e, 0.0), t);
  float ny0 = vnoise(uv - vec2(0.0, e), t);
  float ny1 = vnoise(uv + vec2(0.0, e), t);
  return vec2(ny1 - ny0, -(nx1 - nx0)) / (2.0 * e) * u_turb.x;
}`;

/**
 * Obstacles — bodies moving THROUGH the field (field.obstacle). Radial push out
 * of a disc with a soft falloff, tangential swirl (the wake), and carry: an
 * acceleration toward the body's own velocity, which is what makes a bow wave.
 *
 * Spliced in ONLY when the effect actually has a field.obstacle node, so an
 * effect without one links the exact shader it linked before this feature
 * existed (see the byte-identity test in core.test.ts).
 */
const OBSTACLE_GLSL = `
uniform float u_obCount;
uniform vec4  u_obA[4];    // center.xy, radius, strength
uniform vec4  u_obB[4];    // velocity.xy, swirl, carry
uniform float u_obSoft[4]; // 0 = tight shell at the surface, 1 = broad cushion
uniform float u_obRel[4];  // 1 = centre is emitter-relative (structural space)

vec2 obstacleForces(vec2 pos, vec2 vel, vec2 emitter) {
  vec2 f = vec2(0.0);
  for (int k = 0; k < 4; k++) {
    if (float(k) >= u_obCount) break;
    vec2 d = pos - (u_obA[k].xy + (u_obRel[k] > 0.5 ? emitter : vec2(0.0)));
    float len = max(length(d), 1e-3);
    vec2 dir = d / len;
    float t = clamp(1.0 - len / max(u_obA[k].z, 1e-3), 0.0, 1.0);
    float w = pow(t, mix(3.0, 0.5, clamp(u_obSoft[k], 0.0, 1.0)));
    f += (dir * u_obA[k].w
        + vec2(-dir.y, dir.x) * u_obB[k].z
        + (u_obB[k].xy - vel) * u_obB[k].w) * w;
  }
  return f;
}`;

/**
 * Solid geometry (output.collide*). Runs AFTER integration on the new position:
 * resolve the penetration first, then reflect the normal component of velocity.
 * kind 1 plane (a = point, b = normal) · 2 rect inside · 3 rect outside
 * (a = min, b = max) · 4 circle outside · 5 circle inside (a = centre, r =
 * radius, b = the disc's own velocity so a moving wall kicks what it hits).
 *
 * Also spliced in on demand — see OBSTACLE_GLSL.
 */
const COLLIDER_GLSL = `
uniform float u_colCount;
uniform vec4  u_colA[4];   // kind, a.xy, radius
uniform vec4  u_colB[4];   // b.xy, restitution, friction
uniform float u_colRel[4]; // 1 = geometry is emitter-relative (structural space)

void resolveColliders(inout vec2 pos, inout vec2 vel, vec2 emitter) {
  for (int k = 0; k < 4; k++) {
    if (float(k) >= u_colCount) break;
    float kind = u_colA[k].x;
    vec2 off = u_colRel[k] > 0.5 ? emitter : vec2(0.0);
    vec2 a = u_colA[k].yz + off;
    float r = u_colA[k].w;
    // b is a POSITION for the rect (max corner) but a VELOCITY for the circle
    vec2 b = u_colB[k].xy + (kind > 1.5 && kind < 3.5 ? off : vec2(0.0));
    float rest = u_colB[k].z;
    float fric = u_colB[k].w;

    if (kind < 1.5) {
      vec2 n = b / max(length(b), 1e-6);
      float sd = dot(pos - a, n);
      if (sd < 0.0) {
        pos -= n * sd;
        float vn = dot(vel, n);
        if (vn < 0.0) {
          vec2 vt = vel - n * vn;
          vel = vt * (1.0 - fric) - n * (vn * rest);
        }
      }
    } else if (kind < 2.5) {
      // kept inside the box (no helper fn: a swizzle as an inout arg is the
      // kind of thing ANGLE/Metal has bitten this engine over before)
      if (pos.x < a.x) { pos.x = a.x; if (vel.x < 0.0) { vel.x = -vel.x * rest; vel.y *= 1.0 - fric; } }
      if (pos.x > b.x) { pos.x = b.x; if (vel.x > 0.0) { vel.x = -vel.x * rest; vel.y *= 1.0 - fric; } }
      if (pos.y < a.y) { pos.y = a.y; if (vel.y < 0.0) { vel.y = -vel.y * rest; vel.x *= 1.0 - fric; } }
      if (pos.y > b.y) { pos.y = b.y; if (vel.y > 0.0) { vel.y = -vel.y * rest; vel.x *= 1.0 - fric; } }
    } else if (kind < 3.5) {
      if (pos.x > a.x && pos.x < b.x && pos.y > a.y && pos.y < b.y) {
        float dl = pos.x - a.x, dr = b.x - pos.x;
        float du = pos.y - a.y, dd = b.y - pos.y;
        float m = min(min(dl, dr), min(du, dd));
        if (m == dl)      { pos.x = a.x; vel.x = -abs(vel.x) * rest; vel.y *= 1.0 - fric; }
        else if (m == dr) { pos.x = b.x; vel.x =  abs(vel.x) * rest; vel.y *= 1.0 - fric; }
        else if (m == du) { pos.y = a.y; vel.y = -abs(vel.y) * rest; vel.x *= 1.0 - fric; }
        else              { pos.y = b.y; vel.y =  abs(vel.y) * rest; vel.x *= 1.0 - fric; }
      }
    } else {
      bool inside = kind > 4.5;
      vec2 d = pos - a;
      float len = max(length(d), 1e-4);
      if (inside ? (len > r) : (len < r)) {
        vec2 n = d / len;
        pos = a + n * r;
        vec2 rel = vel - b;
        float vn = dot(rel, n);
        if (inside ? (vn > 0.0) : (vn < 0.0)) {
          vec2 vt = rel - n * vn;
          vel = b + vt * (1.0 - fric) - n * (vn * rest);
        }
      }
    }
  }
}

`;

/** Which optional interaction blocks an effect needs (from its graph). */
export interface ForceFeatures {
  obstacles: boolean;
  colliders: boolean;
}

export const NO_FEATURES: ForceFeatures = { obstacles: false, colliders: false };

/** The force preamble for an effect: base fields + only the blocks it uses. */
const forceGlsl = (ft: ForceFeatures): string =>
  FORCE_GLSL + (ft.obstacles ? OBSTACLE_GLSL : '') + (ft.colliders ? COLLIDER_GLSL : '');

/** Update (simulation) vertex shader — outputs new state via transform feedback. */
export const updateVs = (ft: ForceFeatures = NO_FEATURES): string => `#version 300 es
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
// emission mask: a point table of emitter-relative offsets (RG32F, row-major
// 2048-wide). u_maskCount == 0 → no mask, use the analytic shape.
uniform highp sampler2D u_maskTbl;
uniform float u_maskCount;

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float rnd(float s, float k) { return hash11(s * 57.31 + k * 131.7 + 0.123); }
${forceGlsl(ft)}

void main() {
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0); // required by ANGLE/Metal even under rasterizer discard
  float id = float(gl_VertexID);
  bool alive = (i_life > 0.0) && (i_age < i_life);

  float rel = mod(id - u_spawnBase + u_capacity, u_capacity);
  bool inWindow = rel < u_spawnCount;

  if (!alive && inWindow) {
    float s = hash11(id * 7.77 + u_frame * 3.13 + 1.0);
    vec2 off = vec2(0.0);
    if (u_maskCount > 0.5) {
      int idx = int(rnd(s, 11.0) * u_maskCount);
      idx = clamp(idx, 0, int(u_maskCount) - 1);
      off = texelFetch(u_maskTbl, ivec2(idx % 2048, idx / 2048), 0).rg;
    }
    else if (u_shape == 1) { float a = 6.2831853 * rnd(s, 1.0); off = vec2(cos(a), sin(a)) * u_shapeR * sqrt(rnd(s, 9.0)); }
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

  vec2 force = u_gravity + u_wind + pointForces(i_pos, u_emitter) + turbForce(i_pos)${ft.obstacles ? '\n             + obstacleForces(i_pos, i_vel, u_emitter)' : ''};
  vec2 vel = i_vel + force * u_dt;
  vel *= exp(-u_drag * u_dt);
${ft.colliders
  ? `  vec2 pos = i_pos + vel * u_dt;
  resolveColliders(pos, vel, u_emitter);
  o_pos  = pos;`
  : `  o_pos  = i_pos + vel * u_dt;`}
  o_vel  = vel;
  o_age  = i_age + u_dt;
  o_life = i_life;
  o_seed = i_seed;
}`;

/**
 * Sub-emitter simulation VS — a child system that spawns ON THE DEATH of a
 * parent system's particles (1:1 slot mapping, child capacity == parent
 * capacity). It reads the parent's CURRENT and PREVIOUS state buffers; slot i
 * (re)spawns exactly on the frame parent slot i transitions alive→dead, at the
 * parent's death position. There is no cursor-window emitter spawn. All other
 * integration matches UPDATE_VS.
 */
export const updateVsSub = (ft: ForceFeatures = NO_FEATURES): string => `#version 300 es
precision highp float;

in vec2 i_pos;
in vec2 i_vel;
in float i_age;
in float i_life;
in float i_seed;

// parent slot i — current frame
in vec2 i_pPos;
in float i_pAge;
in float i_pLife;
// parent slot i — previous frame
in float i_pAgePrev;
in float i_pLifePrev;

out vec2 o_pos;
out vec2 o_vel;
out float o_age;
out float o_life;
out float o_seed;

uniform float u_dt;
uniform vec2  u_gravity;
uniform vec2  u_wind;
uniform float u_drag;
uniform vec2  u_emitter;
uniform vec2  u_velMin;
uniform vec2  u_velMax;
uniform float u_lifeMin;
uniform float u_lifeMax;
uniform float u_frame;
uniform int   u_shape;
uniform float u_shapeR;
uniform vec2  u_shapeSize;

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float rnd(float s, float k) { return hash11(s * 57.31 + k * 131.7 + 0.123); }
${forceGlsl(ft)}

void main() {
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
  float id = float(gl_VertexID);
  bool alive = (i_life > 0.0) && (i_age < i_life);

  bool pPrevAlive = (i_pLifePrev > 0.0) && (i_pAgePrev < i_pLifePrev);
  bool pCurrAlive = (i_pLife > 0.0) && (i_pAge < i_pLife);
  bool justDied = pPrevAlive && !pCurrAlive;

  if (justDied) {
    float s = hash11(id * 7.77 + u_frame * 3.13 + 1.0);
    vec2 off = vec2(0.0);
    if (u_shape == 1) { float a = 6.2831853 * rnd(s, 1.0); off = vec2(cos(a), sin(a)) * u_shapeR * sqrt(rnd(s, 9.0)); }
    else if (u_shape == 2) { off = (vec2(rnd(s, 1.0), rnd(s, 2.0)) - 0.5) * u_shapeSize; }
    o_pos  = i_pPos + off;
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

  vec2 force = u_gravity + u_wind + pointForces(i_pos, u_emitter) + turbForce(i_pos)${ft.obstacles ? '\n             + obstacleForces(i_pos, i_vel, u_emitter)' : ''};
  vec2 vel = i_vel + force * u_dt;
  vel *= exp(-u_drag * u_dt);
${ft.colliders
  ? `  vec2 pos = i_pos + vel * u_dt;
  resolveColliders(pos, vel, u_emitter);
  o_pos  = pos;`
  : `  o_pos  = i_pos + vel * u_dt;`}
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
layout(location = 4) in float a_seed;    // [0,1) per particle

uniform vec2  u_resolution;
uniform vec4  u_colorFrom;
uniform vec4  u_colorTo;
uniform float u_sizeFrom;
uniform float u_sizeTo;
uniform int   u_colorEase;
uniform int   u_sizeEase;

// atlas-sequence uniforms (u_textured == 0 → procedural soft sprite).
// u_textured/u_play/u_pick are floats so they share the explicit highp-float
// precision in both stages (int default precision differs VS↔FS on some drivers).
uniform float u_textured;
uniform vec2  u_atlasSize;   // px
uniform vec2  u_frameSize;   // px
uniform vec2  u_grid;        // cols, rows
uniform float u_pad;         // px between cells
uniform float u_fps;
uniform float u_play;        // 0 once-over-life, 1 loop
uniform float u_pick;        // 0 per-particle random row, 1 fixed row
uniform float u_seqRow;      // fixed row when u_pick == 1

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

  if (u_textured > 0.5) {
    float row = (u_pick > 0.5) ? u_seqRow : floor(a_seed * u_grid.y);
    row = clamp(row, 0.0, u_grid.y - 1.0);
    float col = (u_play > 0.5)
      ? mod(floor(a_age * u_fps), u_grid.x)
      : clamp(floor(tN * u_grid.x), 0.0, u_grid.x - 1.0);
    vec2 cellPx = vec2(col, row) * (u_frameSize + u_pad);
    v_uv = (cellPx + (a_corner + 0.5) * u_frameSize) / u_atlasSize;
  } else {
    v_uv = a_corner + 0.5;
  }
  v_color = mix(u_colorFrom, u_colorTo, easeSel(u_colorEase, tN));
}`;

/** Render fragment shader — soft radial sprite, or textured atlas cell. */
export const RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
out vec4 frag;
uniform float u_textured;
uniform sampler2D u_atlas;
void main() {
  if (u_textured > 0.5) {
    vec4 t = texture(u_atlas, v_uv);
    float a = t.a * v_color.a;
    frag = vec4(t.rgb * v_color.rgb * a, a);   // premultiplied
  } else {
    float d = length(v_uv - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d) * v_color.a;
    frag = vec4(v_color.rgb * a, a);
  }
}`;

export const TF_VARYINGS = ['o_pos', 'o_vel', 'o_age', 'o_life', 'o_seed'];
export const STATE_FLOATS = 7; // pos.xy vel.xy age life seed
