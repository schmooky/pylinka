/**
 * RevoltFX (Penner) eases → Pylinka ease keys.
 *
 * `PENNER` is a port of `revolt-fx/lib/util/Easing.js`, normalised to
 * f(0)≈0, f(1)≈1 (the original takes t, b, c, d; we always call it with
 * b = 0, c = 1, d = 1). A RevoltFX ease that equals a Pylinka GSAP preset maps
 * to that preset. Any other ease, and the piecewise shapes fadeIn/scaleIn need,
 * becomes a fitted multi-key `curve(...)`, which every Pylinka backend
 * evaluates.
 */
import { formatCurve, sampleCurve, type CurveKey, CURVE_MAX_KEYS } from '@pylinka/compiler';

export type EaseFn = (t: number) => number;

const { PI, sin, cos, sqrt, pow, asin, abs } = Math;

function outBounce(t: number): number {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
  if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
  return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
}

function elasticS(p: number): number {
  return (p / (2 * PI)) * asin(1);
}

/** Penner eases exactly as RevoltFX evaluates them, with b=0, c=1, d=1. */
export const PENNER: Record<string, EaseFn> = {
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => -t * (t - 2),
  easeInOutQuad: (t) => ((t *= 2) < 1 ? 0.5 * t * t : -0.5 * (--t * (t - 2) - 1)),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => (t -= 1) * t * t + 1,
  easeInOutCubic: (t) => ((t *= 2) < 1 ? 0.5 * t * t * t : 0.5 * ((t -= 2) * t * t + 2)),
  easeInQuart: (t) => t * t * t * t,
  easeOutQuart: (t) => -((t -= 1) * t * t * t - 1),
  easeInOutQuart: (t) => ((t *= 2) < 1 ? 0.5 * t * t * t * t : -0.5 * ((t -= 2) * t * t * t - 2)),
  easeInQuint: (t) => t * t * t * t * t,
  easeOutQuint: (t) => (t -= 1) * t * t * t * t + 1,
  easeInOutQuint: (t) => ((t *= 2) < 1 ? 0.5 * t * t * t * t * t : 0.5 * ((t -= 2) * t * t * t * t + 2)),
  easeInSine: (t) => -cos(t * (PI / 2)) + 1,
  easeOutSine: (t) => sin(t * (PI / 2)),
  easeInOutSine: (t) => -0.5 * (cos(PI * t) - 1),
  easeInExpo: (t) => (t === 0 ? 0 : pow(2, 10 * (t - 1))),
  easeOutExpo: (t) => (t === 1 ? 1 : -pow(2, -10 * t) + 1),
  // the original's `t === 0` / `t === d` guards are no-op statements
  easeInOutExpo: (t) => ((t *= 2) < 1 ? 0.5 * pow(2, 10 * (t - 1)) : 0.5 * (-pow(2, -10 * --t) + 2)),
  easeInCirc: (t) => -(sqrt(1 - t * t) - 1),
  easeOutCirc: (t) => sqrt(1 - (t -= 1) * t),
  easeInOutCirc: (t) =>
    (t *= 2) < 1 ? -0.5 * (sqrt(1 - t * t) - 1) : 0.5 * (sqrt(1 - (t -= 2) * t) + 1),
  easeInElastic: (t) => {
    const p = 0.3;
    const s = elasticS(p);
    return -(pow(2, 10 * (t -= 1)) * sin(((t - s) * (2 * PI)) / p));
  },
  easeOutElastic: (t) => {
    const p = 0.3;
    const s = elasticS(p);
    return pow(2, -10 * t) * sin(((t - s) * (2 * PI)) / p) + 1;
  },
  easeInOutElastic: (t) => {
    const p = 0.3 * 1.5;
    const s = elasticS(p);
    t *= 2;
    if (t < 1) return -0.5 * (pow(2, 10 * (t -= 1)) * sin(((t - s) * (2 * PI)) / p));
    return pow(2, -10 * (t -= 1)) * sin(((t - s) * (2 * PI)) / p) * 0.5 + 1;
  },
  easeInBack: (t) => t * t * ((1.70158 + 1) * t - 1.70158),
  easeOutBack: (t) => (t -= 1) * t * ((1.70158 + 1) * t + 1.70158) + 1,
  easeInOutBack: (t) => {
    const s = 1.70158 * 1.525;
    return (t *= 2) < 1 ? 0.5 * (t * t * ((s + 1) * t - s)) : 0.5 * ((t -= 2) * t * ((s + 1) * t + s) + 2);
  },
  easeInBounce: (t) => 1 - outBounce(1 - t),
  easeOutBounce: outBounce,
  easeInOutBounce: (t) => (t < 0.5 ? (1 - outBounce(1 - t * 2)) * 0.5 : outBounce(t * 2 - 1) * 0.5 + 0.5),
};

/** RevoltFX eases that are the same function as a Pylinka preset. */
export const PRESET_EQUIVALENT: Record<string, string> = {
  linear: 'linear',
  easeInQuad: 'power1.in',
  easeOutQuad: 'power1.out',
  easeInOutQuad: 'power1.inOut',
  easeInCubic: 'power2.in',
  easeOutCubic: 'power2.out',
  easeInOutCubic: 'power2.inOut',
  easeInQuart: 'power3.in',
  easeOutQuart: 'power3.out',
  easeInSine: 'sine.in',
  easeOutSine: 'sine.out',
  easeInOutSine: 'sine.inOut',
  easeOutBack: 'back.out',
};

/** The function RevoltFX runs for an ease name (unknown → linear, like `Easing[x] || linear`). */
export function penner(name: string | undefined): EaseFn {
  return (name !== undefined && PENNER[name]) || PENNER.linear!;
}

export interface FittedEase {
  /** a Pylinka ease key: a preset or `curve(...)` */
  key: string;
  /** largest |pylinka − revoltfx| over [0,1], in output units (0 for a preset) */
  error: number;
}

/** Bounds on a fit. `tolerance` is the max error the fit tries to reach. */
const TOLERANCE = 0.004;
const SAMPLES = 256;

function maxError(keys: CurveKey[], f: EaseFn): { err: number; at: number } {
  let err = 0;
  let at = 0.5;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const e = abs(sampleCurve(keys, t) - f(t));
    if (e > err) {
      err = e;
      at = t;
    }
  }
  return { err, at };
}

/**
 * Hermite keys on `f` at the given x positions. Handles sit a third of the
 * span away in x, which makes X(s) linear in the bezier parameter, so each
 * segment is a plain cubic Hermite in t. Slopes are taken one-sided on each
 * side of a key, so a kink (the edge of a fade window, a bounce) stays sharp.
 */
function hermiteKeys(xs: number[], f: EaseFn): CurveKey[] {
  const h = 1e-4;
  return xs.map((x, i) => {
    const prev = xs[i - 1];
    const next = xs[i + 1];
    const inSlope = x - h >= 0 ? (f(x) - f(x - h)) / h : (f(x + h) - f(x)) / h;
    const outSlope = x + h <= 1 ? (f(x + h) - f(x)) / h : (f(x) - f(x - h)) / h;
    const inSpan = prev !== undefined ? (x - prev) / 3 : 0;
    const outSpan = next !== undefined ? (next - x) / 3 : 0;
    return { x, y: f(x), ix: -inSpan, iy: -inSpan * inSlope, ox: outSpan, oy: outSpan * outSlope };
  });
}

/**
 * Fit a `curve(...)` to any [0,1] function. Starts from the endpoints plus any
 * `breaks` (x positions where `f` has a kink), then inserts a key wherever the
 * error is worst until it is under tolerance or the key budget is spent.
 */
export function fitCurve(f: EaseFn, breaks: number[] = []): FittedEase {
  const xs = [...new Set([0, 1, ...breaks.filter((b) => b > 0 && b < 1)])].sort((a, b) => a - b);
  let keys = hermiteKeys(xs, f);
  let { err, at } = maxError(keys, f);
  while (err > TOLERANCE && xs.length < CURVE_MAX_KEYS) {
    if (xs.some((x) => abs(x - at) < 1e-3)) break;
    xs.push(at);
    xs.sort((a, b) => a - b);
    const next = hermiteKeys(xs, f);
    const e = maxError(next, f);
    keys = next;
    err = e.err;
    at = e.at;
  }
  return { key: formatCurve(keys), error: err };
}

/** The Pylinka ease key for a plain RevoltFX ease. */
export function mapEase(name: string | undefined): FittedEase {
  const n = name !== undefined && PENNER[name] ? name : 'linear';
  const preset = PRESET_EQUIVALENT[n];
  if (preset !== undefined) return { key: preset, error: 0 };
  return fitCurve(PENNER[n]!);
}

/**
 * The 0→1 ramp of a value that is held at its start for the first `fac` of the
 * lifetime and then eased to its end. This is RevoltFX's alpha/scale after a
 * fadeIn/scaleIn window.
 */
export function heldRamp(name: string | undefined, fac: number): FittedEase {
  const f = penner(name);
  const k = clamp01(fac);
  if (k <= 0) return mapEase(name);
  if (k >= 1) return { key: 'curve(0,0,0,0,0,0;1,0,0,0,0,0)', error: 0 };
  return fitCurve((t) => (t <= k ? 0 : f((t - k) / (1 - k))), [k]);
}

/**
 * The 0→1 multiplier of a fade/scale-in window: eased from 0 to 1 over the
 * first `fac` of the lifetime, then held at 1.
 */
export function fadeWindow(name: string | undefined, fac: number): FittedEase {
  // RevoltFX: `Easing[settings.fadeInEase || 'easeInSine']`
  const f = penner(name || 'easeInSine');
  const k = clamp01(fac);
  if (k >= 1) return name ? mapEase(name) : mapEase('easeInSine');
  if (k <= 0) return { key: 'curve(0,1,0,0,0,0;1,1,0,0,0,0)', error: 0 };
  return fitCurve((t) => (t >= k ? 1 : f(t / k)), [k]);
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Exponential-drag stand-in for an eased distance tween.
 *
 * RevoltFX moves a particle along `start + ease(age/life) · delta`. With a
 * constant drag k = c/life and v0 = D·c / (life·(1 − e^−c)), Pylinka covers
 * exactly D by the time the particle dies, along (1 − e^(−c·t)) / (1 − e^−c).
 * c > 0 reads as an ease-out, c < 0 as an ease-in, and c → 0 is linear. This
 * returns the c that best matches the ease and the max position error left
 * over, as a fraction of the total distance.
 */
export function fitDrag(name: string | undefined): { c: number; error: number } {
  const f = penner(name);
  const shape = (c: number, t: number) => (abs(c) < 1e-6 ? t : (1 - Math.exp(-c * t)) / (1 - Math.exp(-c)));
  const err = (c: number) => {
    let e = 0;
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      e = Math.max(e, abs(shape(c, t) - f(t)));
    }
    return e;
  };
  if (err(0) < 1e-9) return { c: 0, error: 0 };
  let best = 0;
  let bestErr = err(0);
  for (let c = -12; c <= 16; c += 0.05) {
    const e = err(c);
    if (e < bestErr) {
      bestErr = e;
      best = c;
    }
  }
  // refine
  for (let c = best - 0.05; c <= best + 0.05; c += 0.002) {
    const e = err(c);
    if (e < bestErr) {
      bestErr = e;
      best = c;
    }
  }
  return { c: abs(best) < 1e-3 ? 0 : best, error: bestErr };
}
