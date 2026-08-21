/**
 * @pylinka/compiler — multi-keyframe ease curves.
 *
 * `ease.ts` owns the two original ease flavours (named presets and a single
 * `cubic-bezier(...)`). Both are fixed at two endpoints, which is why a VFX
 * artist could not shape "fade in, hold, snap out" without stacking nodes.
 * This module adds a third flavour with an arbitrary number of keyframes:
 *
 *   curve(x,y,ix,iy,ox,oy; x,y,ix,iy,ox,oy; ...)
 *
 * One `;`-separated group per keyframe, ordered by x. Each group is
 * `x,y` (the key, in curve space) followed by the *offsets* of its incoming and
 * outgoing bezier handles. The first key's in-handle and the last key's
 * out-handle are unused; they are still serialized so every group has the same
 * arity and the parser stays trivial. Consecutive keys are joined by a cubic
 * bezier with control points `key + outHandle` and `next + nextInHandle`, so a
 * 2-key curve is exactly a `cubic-bezier(...)` and converting between them is
 * lossless (see `curveFromBezier`).
 *
 * Like `ease.ts`, this file owns parallel renderings that MUST stay in lockstep:
 * a JS sampler (editor plots), WGSL (WebGPU), and GLSL ES 3.00 (WebGL2).
 * `curve.test.ts` pins the JS sampler against the 2-key/cubic-bezier identity
 * and against the emitted shader constants.
 */

/** Newton steps used to invert X(s) — mirrors BEZIER_ITERS in ease.ts so a
 *  2-key curve and the equivalent `cubic-bezier(...)` agree bit-for-bit. */
const CURVE_ITERS = 6;

/** Guard rail on authoring UI and parser alike. Each key costs one branch in
 *  the generated shader, so this is a code-size bound, not a math limit. */
export const CURVE_MIN_KEYS = 2;
export const CURVE_MAX_KEYS = 12;

export interface CurveKey {
  /** Key position in curve space. x is the input (time), y the output value. */
  x: number;
  y: number;
  /** Incoming handle, as an offset from the key. Unused on the first key. */
  ix: number;
  iy: number;
  /** Outgoing handle, as an offset from the key. Unused on the last key. */
  ox: number;
  oy: number;
}

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
const clamp01 = (n: number): number => clamp(n, 0, 1);
/** Collapse -0 to 0. Clamping a negative handle to a zero-width bound yields
 *  -0, which serializes fine but breaks value equality on round-trip. */
const nz = (n: number): number => (n === 0 ? 0 : n);

// ─────────────────────────────── parse / format ────────────────────────────

/**
 * Parse `'curve(...)'` → normalized keys, or `null` when the key is not a
 * curve. Normalization is part of parsing so that every consumer (JS sampler,
 * both shader backends, the editor) sees the identical curve: keys are sorted
 * by x, endpoints are pinned to x=0 and x=1, and handle x-offsets are clamped
 * into their segment to keep X(s) monotone for the Newton solve.
 */
export function parseCurve(key: string): CurveKey[] | null {
  const m = /^curve\(([^)]*)\)$/.exec(key.trim());
  if (!m) return null;
  const groups = m[1]!.split(';');
  if (groups.length < CURVE_MIN_KEYS || groups.length > CURVE_MAX_KEYS) return null;
  const keys: CurveKey[] = [];
  for (const g of groups) {
    const n = g.split(',').map((s) => Number(s.trim()));
    if (n.length !== 6 || n.some((v) => !Number.isFinite(v))) return null;
    keys.push({ x: n[0]!, y: n[1]!, ix: n[2]!, iy: n[3]!, ox: n[4]!, oy: n[5]! });
  }
  return normalizeCurve(keys);
}

/**
 * Put a keyframe list into the canonical shape every backend expects. Exported
 * because the editor normalizes on every drag — what you see while dragging is
 * then exactly what the shader gets on commit.
 */
export function normalizeCurve(input: CurveKey[]): CurveKey[] {
  const keys = input.map((k) => ({ ...k })).sort((a, b) => a.x - b.x);
  // Pin the endpoints: an ease is defined over t∈[0,1], and pinning here means
  // the shader never needs an out-of-range branch.
  keys[0]!.x = 0;
  keys[keys.length - 1]!.x = 1;
  // Interior keys keep their order even if two were dragged onto each other.
  for (let i = 1; i < keys.length - 1; i++) {
    keys[i]!.x = clamp(keys[i]!.x, keys[i - 1]!.x, 1);
  }
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    const prevSpan = i > 0 ? k.x - keys[i - 1]!.x : 0;
    const nextSpan = i < keys.length - 1 ? keys[i + 1]!.x - k.x : 0;
    // Handles may reach across their own segment but never past its far key,
    // and never backwards — that is what keeps X(s) monotone.
    k.ix = nz(clamp(k.ix, -prevSpan, 0));
    k.ox = nz(clamp(k.ox, 0, nextSpan));
  }
  return keys;
}

/** True when the key is a multi-keyframe curve rather than a preset/bezier. */
export function isCurveEase(key: string): boolean {
  return parseCurve(key) !== null;
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** Serialize keys back to a `curve(...)` ease key (normalizing on the way). */
export function formatCurve(keys: CurveKey[]): string {
  const body = normalizeCurve(keys)
    .map((k) => [k.x, k.y, k.ix, k.iy, k.ox, k.oy].map(round4).join(','))
    .join(';');
  return `curve(${body})`;
}

/**
 * The 2-key curve equivalent to `cubic-bezier(x1,y1,x2,y2)`. Used when the
 * editor promotes an existing bezier to the multi-point editor — the two forms
 * evaluate identically, so promoting never changes the look of an effect.
 */
export function curveFromBezier(c: { x1: number; y1: number; x2: number; y2: number }): CurveKey[] {
  return [
    { x: 0, y: 0, ix: 0, iy: 0, ox: c.x1, oy: c.y1 },
    { x: 1, y: 1, ix: c.x2 - 1, iy: c.y2 - 1, ox: 0, oy: 0 },
  ];
}

/** A straight 0→1 ramp — the seed for a fresh multi-point curve. */
export function defaultCurve(): CurveKey[] {
  return curveFromBezier({ x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3 });
}

// ─────────────────────────── segment control points ────────────────────────

/** The four bezier control points of segment `i`, flattened as [ax,ay,bx,by,cx,cy,dx,dy]. */
function segment(keys: CurveKey[], i: number): number[] {
  const a = keys[i]!;
  const b = keys[i + 1]!;
  return [a.x, a.y, a.x + a.ox, a.y + a.oy, b.x + b.ix, b.y + b.iy, b.x, b.y];
}

// ─────────────────────────────── JS sampler ────────────────────────────────

/** Evaluate a parsed curve at `t`. Mirrors the emitted shader bodies exactly. */
export function sampleCurve(keys: CurveKey[], t: number): number {
  const last = keys.length - 1;
  if (t <= 0) return keys[0]!.y;
  if (t >= 1) return keys[last]!.y;
  let i = 0;
  while (i < last - 1 && t >= keys[i + 1]!.x) i++;
  const [ax, ay, bx, by, cx, cy, dx, dy] = segment(keys, i) as [
    number, number, number, number, number, number, number, number,
  ];
  let s = (t - ax) / Math.max(dx - ax, 1e-5);
  for (let k = 0; k < CURVE_ITERS; k++) {
    const s1 = 1 - s;
    const x = s1 * s1 * s1 * ax + 3 * s1 * s1 * s * bx + 3 * s1 * s * s * cx + s * s * s * dx - t;
    const ds = 3 * s1 * s1 * (bx - ax) + 6 * s1 * s * (cx - bx) + 3 * s * s * (dx - cx);
    s = s - x / Math.max(ds, 1e-5);
  }
  s = clamp01(s);
  const s1 = 1 - s;
  return s1 * s1 * s1 * ay + 3 * s1 * s1 * s * by + 3 * s1 * s * s * cy + s * s * s * dy;
}

/** Sample a curve into `n` evenly spaced values over t∈[0,1] (LUT builders). */
export function sampleCurveLut(keys: CurveKey[], n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(sampleCurve(keys, i / (n - 1)));
  return out;
}

// ─────────────────────────── WGSL / GLSL emission ──────────────────────────

/** FNV-1a over the canonical form → identical curves dedupe to one emitted fn. */
export function hashCurve(keys: CurveKey[]): string {
  const s = formatCurve(keys);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Format a JS number as a WGSL/GLSL f32 literal (always has a decimal point). */
function f32lit(n: number): string {
  const v = round4(n);
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/**
 * The per-segment control-point selection, shared by both backends.
 *
 * Segment 0's control points are the initial values; every later segment is a
 * flat `if (t >= x)` that overwrites them, so the last matching branch wins.
 * A chain of assignments rather than one Newton solve per branch keeps the
 * expensive part (the solve) emitted exactly once regardless of key count.
 */
function segmentChain(keys: CurveKey[], decl: string, sep: string): string {
  const names = ['ax', 'ay', 'bx', 'by', 'cx', 'cy', 'dx', 'dy'];
  const seg0 = segment(keys, 0);
  const lines = names.map((n, j) => `  ${decl} ${n}${sep} = ${f32lit(seg0[j]!)};`);
  for (let i = 1; i < keys.length - 1; i++) {
    const s = segment(keys, i);
    const body = names.map((n, j) => `${n} = ${f32lit(s[j]!)};`).join(' ');
    lines.push(`  if (t >= ${f32lit(keys[i]!.x)}) { ${body} }`);
  }
  return lines.join('\n');
}

/** The curve function as WGSL, named per distinct curve. */
export function curveFnWgsl(name: string, keys: CurveKey[]): string {
  return `fn ${name}(t: f32) -> f32 {
${segmentChain(keys, 'var', ': f32')}
  var s = (t - ax) / max(dx - ax, 1e-5);
  for (var i = 0; i < ${CURVE_ITERS}; i = i + 1) {
    let s1 = 1.0 - s;
    let x = s1 * s1 * s1 * ax + 3.0 * s1 * s1 * s * bx + 3.0 * s1 * s * s * cx + s * s * s * dx - t;
    let ds = 3.0 * s1 * s1 * (bx - ax) + 6.0 * s1 * s * (cx - bx) + 3.0 * s * s * (dx - cx);
    s = s - x / max(ds, 1e-5);
  }
  s = clamp(s, 0.0, 1.0);
  let s1 = 1.0 - s;
  return s1 * s1 * s1 * ay + 3.0 * s1 * s1 * s * by + 3.0 * s1 * s * s * cy + s * s * s * dy;
}`;
}

/** The curve function as GLSL ES 3.00, named per distinct curve. */
export function curveFnGlsl(name: string, keys: CurveKey[]): string {
  return `float ${name}(float t) {
${segmentChain(keys, 'float', '')}
  float s = (t - ax) / max(dx - ax, 1e-5);
  for (int i = 0; i < ${CURVE_ITERS}; i++) {
    float s1 = 1.0 - s;
    float x = s1 * s1 * s1 * ax + 3.0 * s1 * s1 * s * bx + 3.0 * s1 * s * s * cx + s * s * s * dx - t;
    float ds = 3.0 * s1 * s1 * (bx - ax) + 6.0 * s1 * s * (cx - bx) + 3.0 * s * s * (dx - cx);
    s = s - x / max(ds, 1e-5);
  }
  s = clamp(s, 0.0, 1.0);
  float s1 = 1.0 - s;
  return s1 * s1 * s1 * ay + 3.0 * s1 * s1 * s * by + 3.0 * s1 * s * s * cy + s * s * s * dy;
}`;
}
