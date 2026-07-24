/**
 * @pylinka/compiler — the single source of truth for easing curves (§13.9).
 *
 * An ease is referenced by a string key stored in a node's `structural.ease`.
 * Two flavours:
 *   • a named GSAP preset (`'power2.out'`, `'sine.inOut'`, …) — see EASE_BODIES.
 *   • a custom cubic-bezier: `'cubic-bezier(x1,y1,x2,y2)'` (CSS syntax) — the
 *     control points of a P0=(0,0)…P3=(1,1) Bézier, solved per §cubic below.
 *
 * This module owns THREE parallel renderings of that catalog, kept in lockstep:
 *   1. `EASE_BODIES` / `bezierBodyWgsl` — WGSL function bodies (WebGPU backend).
 *   2. `easeFnGlsl`                     — GLSL ES 3.00 functions (WebGL2 backend).
 *   3. `sampleEase`                     — a JS evaluator (editor curve plots).
 * `ease.sampler.test.ts` pins (1)↔(3) at sample points; (2) is a mechanical
 * translation of (1). Add a curve here and nowhere else.
 */

/** WGSL bodies for the §13.9 preset set. `t ∈ [0,1]`. */
export const EASE_BODIES: Record<string, string> = {
  linear: 'return t;',
  'power1.in': 'return t * t;',
  'power1.out': 'let u = 1.0 - t; return 1.0 - u * u;',
  'power1.inOut': 'if (t < 0.5) { return 2.0 * t * t; } let u = 1.0 - t; return 1.0 - 2.0 * u * u;',
  'power2.in': 'return t * t * t;',
  'power2.out': 'let u = 1.0 - t; return 1.0 - u * u * u;',
  'power2.inOut':
    'if (t < 0.5) { return 4.0 * t * t * t; } let u = 1.0 - t; return 1.0 - 4.0 * u * u * u;',
  'power3.in': 'return t * t * t * t;',
  'power3.out': 'let u = 1.0 - t; return 1.0 - u * u * u * u;',
  'sine.in': 'return 1.0 - cos(t * 1.5707963267948966);',
  'sine.out': 'return sin(t * 1.5707963267948966);',
  'sine.inOut': 'return 0.5 - 0.5 * cos(t * 3.141592653589793);',
  'expo.out': 'if (t >= 1.0) { return 1.0; } return 1.0 - exp2(-10.0 * t);',
  'back.out': 'let u = t - 1.0; return 1.0 + 2.70158 * u * u * u + 1.70158 * u * u;',
};

/** Ordered preset keys (the palette/picker order). */
export const EASE_KEYS = Object.keys(EASE_BODIES);

// ───────────────────────────── custom cubic-bezier ─────────────────────────

const HALF_PI = 1.5707963267948966;
const PI = 3.141592653589793;

export interface CubicBezier {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Parse `'cubic-bezier(x1,y1,x2,y2)'` → params (x's clamped to [0,1] per CSS),
 *  or `null` if the key is not a custom bezier. Whitespace tolerant. */
export function parseCubicBezier(key: string): CubicBezier | null {
  const m = /^cubic-bezier\(([^)]*)\)$/.exec(key.trim());
  if (!m) return null;
  const parts = m[1]!.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return {
    x1: clamp01(parts[0]!),
    y1: parts[1]!,
    x2: clamp01(parts[2]!),
    y2: parts[3]!,
  };
}

/** True when the key is a custom cubic-bezier rather than a named preset. */
export function isCustomEase(key: string): boolean {
  return parseCubicBezier(key) !== null;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// Newton-Raphson iteration count — shared by JS sampler and both shader bodies
// so the plotted curve matches the GPU exactly. x1/x2∈[0,1] keeps X(s) monotone,
// so a fixed handful of steps converges without a bisection fallback.
const BEZIER_ITERS = 6;

function bezierAt(c: CubicBezier, t: number): number {
  let s = t;
  for (let i = 0; i < BEZIER_ITERS; i++) {
    const s1 = 1 - s;
    const x = 3 * s1 * s1 * s * c.x1 + 3 * s1 * s * s * c.x2 + s * s * s - t;
    const dx = 3 * s1 * s1 * c.x1 + 6 * s1 * s * (c.x2 - c.x1) + 3 * s * s * (1 - c.x2);
    s = s - x / Math.max(dx, 1e-5);
  }
  s = clamp01(s);
  const s1 = 1 - s;
  return 3 * s1 * s1 * s * c.y1 + 3 * s1 * s * s * c.y2 + s * s * s;
}

// ─────────────────────────── shader function names ─────────────────────────

/** WGSL/GLSL-safe function name for an ease key.
 *  `'sine.out'` → `'easeSel_sine_out'`; `'cubic-bezier(.17,.67,.83,.67)'` →
 *  `'easeSel_cb_<hash>'` (identical curves share a name → deduped emission). */
export function easeFnName(key: string): string {
  const c = parseCubicBezier(key);
  if (c) return 'easeSel_cb_' + hashBezier(c);
  return 'easeSel_' + key.replace(/\./g, '_');
}

function hashBezier(c: CubicBezier): string {
  // FNV-1a over the canonical param string → stable 8-hex id.
  const s = `${c.x1},${c.y1},${c.x2},${c.y2}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Format a JS number as a WGSL/GLSL f32 literal (always has a decimal point). */
function f32lit(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

// ─────────────────────────── WGSL / GLSL emission ──────────────────────────

/** The ease function as WGSL, named per distinct ease key. */
export function easeFn(key: string): string {
  const c = parseCubicBezier(key);
  if (c) return bezierBodyWgsl(easeFnName(key), c);
  const body = EASE_BODIES[key];
  if (body === undefined) throw new Error(`Unknown ease "${key}"`);
  return `fn ${easeFnName(key)}(t: f32) -> f32 { ${body} }`;
}

/** The ease function as GLSL ES 3.00, named per distinct ease key. */
export function easeFnGlsl(key: string): string {
  const name = easeFnName(key);
  const c = parseCubicBezier(key);
  if (c) return bezierBodyGlsl(name, c);
  const body = EASE_BODIES[key];
  if (body === undefined) throw new Error(`Unknown ease "${key}"`);
  // preset bodies only ever declare `let u` (an f32) — mechanical WGSL→GLSL.
  return `float ${name}(float t) { ${body.replace(/\blet\s+/g, 'float ')} }`;
}

function bezierBodyWgsl(name: string, c: CubicBezier): string {
  const [x1, y1, x2, y2] = [f32lit(c.x1), f32lit(c.y1), f32lit(c.x2), f32lit(c.y2)];
  return `fn ${name}(t: f32) -> f32 {
  var s = t;
  for (var i = 0; i < ${BEZIER_ITERS}; i = i + 1) {
    let s1 = 1.0 - s;
    let x = 3.0 * s1 * s1 * s * ${x1} + 3.0 * s1 * s * s * ${x2} + s * s * s - t;
    let dx = 3.0 * s1 * s1 * ${x1} + 6.0 * s1 * s * (${x2} - ${x1}) + 3.0 * s * s * (1.0 - ${x2});
    s = s - x / max(dx, 1e-5);
  }
  s = clamp(s, 0.0, 1.0);
  let s1 = 1.0 - s;
  return 3.0 * s1 * s1 * s * ${y1} + 3.0 * s1 * s * s * ${y2} + s * s * s;
}`;
}

function bezierBodyGlsl(name: string, c: CubicBezier): string {
  const [x1, y1, x2, y2] = [f32lit(c.x1), f32lit(c.y1), f32lit(c.x2), f32lit(c.y2)];
  return `float ${name}(float t) {
  float s = t;
  for (int i = 0; i < ${BEZIER_ITERS}; i++) {
    float s1 = 1.0 - s;
    float x = 3.0 * s1 * s1 * s * ${x1} + 3.0 * s1 * s * s * ${x2} + s * s * s - t;
    float dx = 3.0 * s1 * s1 * ${x1} + 6.0 * s1 * s * (${x2} - ${x1}) + 3.0 * s * s * (1.0 - ${x2});
    s = s - x / max(dx, 1e-5);
  }
  s = clamp(s, 0.0, 1.0);
  float s1 = 1.0 - s;
  return 3.0 * s1 * s1 * s * ${y1} + 3.0 * s1 * s * s * ${y2} + s * s * s;
}`;
}

// ─────────────────────────────── JS sampler ────────────────────────────────

/** JS evaluators for the presets — MUST match EASE_BODIES numerically
 *  (pinned by ease.sampler.test.ts). */
const EASE_SAMPLERS: Record<string, (t: number) => number> = {
  linear: (t) => t,
  'power1.in': (t) => t * t,
  'power1.out': (t) => 1 - (1 - t) * (1 - t),
  'power1.inOut': (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
  'power2.in': (t) => t * t * t,
  'power2.out': (t) => 1 - (1 - t) ** 3,
  'power2.inOut': (t) => (t < 0.5 ? 4 * t * t * t : 1 - 4 * (1 - t) ** 3),
  'power3.in': (t) => t * t * t * t,
  'power3.out': (t) => 1 - (1 - t) ** 4,
  'sine.in': (t) => 1 - Math.cos(t * HALF_PI),
  'sine.out': (t) => Math.sin(t * HALF_PI),
  'sine.inOut': (t) => 0.5 - 0.5 * Math.cos(t * PI),
  'expo.out': (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  'back.out': (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
};

/** Evaluate an ease curve at `t ∈ [0,1]` on the CPU (for editor curve plots).
 *  Handles presets and custom cubic-bezier; unknown keys fall back to linear. */
export function sampleEase(key: string, t: number): number {
  const preset = EASE_SAMPLERS[key];
  if (preset) return preset(t);
  const c = parseCubicBezier(key);
  if (c) return bezierAt(c, t);
  return t;
}
