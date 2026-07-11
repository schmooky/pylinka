/**
 * Emitter trajectory splines: drive an emitter along a Catmull-Rom path.
 * CPU-side and renderer-independent — call `driver.at(elapsedSeconds)` each
 * frame and feed the result to `handle.setEmitter(x, y)`.
 *
 * The curve is a centripetal Catmull-Rom through the control points
 * (endpoint-clamped, or wrapped when `closed`), re-parameterized by arc length
 * via a dense LUT so travel speed is uniform regardless of point spacing.
 */

export interface PathDriverOptions {
  /** seconds for one full traversal (default 4) */
  duration?: number;
  /** what happens after a traversal: restart, reverse, or hold the end (default 'loop') */
  mode?: 'loop' | 'pingpong' | 'once';
  /** join the last point back to the first */
  closed?: boolean;
}

export interface PathDriver {
  /** position at `time` seconds since start */
  at(time: number): [number, number];
  /** total arc length of the path (same units as the points) */
  readonly length: number;
}

const SUBDIV = 24;

function catmullRom(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  t: number,
): [number, number] {
  // centripetal parameterization (α = 0.5) — no cusps/self-loops between points
  const alpha = 0.5;
  const d = (a: readonly [number, number], b: readonly [number, number]) =>
    Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha);
  const t0 = 0;
  const t1 = t0 + Math.max(d(p0, p1), 1e-4);
  const t2 = t1 + Math.max(d(p1, p2), 1e-4);
  const t3 = t2 + Math.max(d(p2, p3), 1e-4);
  const u = t1 + (t2 - t1) * t;

  const lerp = (
    a: readonly [number, number],
    b: readonly [number, number],
    ta: number,
    tb: number,
  ): [number, number] => {
    const k = (u - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

export function createPathDriver(
  points: readonly (readonly [number, number])[],
  opts: PathDriverOptions = {},
): PathDriver {
  const duration = Math.max(opts.duration ?? 4, 0.05);
  const mode = opts.mode ?? 'loop';
  const closed = opts.closed ?? false;

  if (points.length === 0) return { at: () => [0, 0], length: 0 };
  if (points.length === 1) {
    const p = points[0]!;
    return { at: () => [p[0], p[1]], length: 0 };
  }

  // dense sample LUT (positions + cumulative arc length)
  const pts = points.map((p) => [p[0], p[1]] as [number, number]);
  const n = pts.length;
  const seg = closed ? n : n - 1;
  const ctrl = (i: number): [number, number] =>
    closed ? pts[((i % n) + n) % n]! : pts[Math.min(Math.max(i, 0), n - 1)]!;

  const xs: number[] = [];
  const ys: number[] = [];
  const cum: number[] = [0];
  let total = 0;
  let prev: [number, number] | null = null;
  for (let s = 0; s < seg; s++) {
    const p0 = ctrl(s - 1);
    const p1 = ctrl(s);
    const p2 = ctrl(s + 1);
    const p3 = ctrl(s + 2);
    const last = s === seg - 1;
    const steps = last ? SUBDIV + 1 : SUBDIV; // include the final point once
    for (let k = 0; k < steps; k++) {
      const pt = catmullRom(p0, p1, p2, p3, k / SUBDIV);
      if (prev) {
        total += Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
        cum.push(total);
      }
      xs.push(pt[0]);
      ys.push(pt[1]);
      prev = pt;
    }
  }

  const at = (time: number): [number, number] => {
    if (total <= 0) return [xs[0]!, ys[0]!];
    let u = time / duration;
    if (mode === 'loop') u = u - Math.floor(u);
    else if (mode === 'pingpong') {
      const c = u - Math.floor(u / 2) * 2; // 0..2
      u = c <= 1 ? c : 2 - c;
    } else u = Math.min(Math.max(u, 0), 1);

    const target = u * total;
    // binary search the cumulative-length LUT
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(lo, 1);
    const l0 = cum[i - 1]!;
    const l1 = cum[i]!;
    const k = l1 > l0 ? (target - l0) / (l1 - l0) : 0;
    return [xs[i - 1]! + (xs[i]! - xs[i - 1]!) * k, ys[i - 1]! + (ys[i]! - ys[i - 1]!) * k];
  };

  return { at, length: total };
}
