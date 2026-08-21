/**
 * Pins the multi-keyframe curve flavour (curve.ts). The load-bearing claim is
 * that the plotted curve, the WGSL body and the GLSL body are the same
 * function — the artist drags a point and the GPU runs exactly that.
 */
import { describe, expect, it } from 'vitest';
import {
  CURVE_MAX_KEYS,
  curveFromBezier,
  curveFromEase,
  EASE_KEYS,
  easeFnName,
  formatCurve,
  isCurveEase,
  isCustomEase,
  normalizeCurve,
  parseCurve,
  moveCurveHandle,
  moveCurveKey,
  removeCurveKey,
  splitCurveAt,
  sampleCurve,
  sampleEase,
  type CurveKey,
} from '../src/index.js';
import { easeFn, easeFnGlsl } from '../src/ease.js';

const SAMPLES = [0, 0.05, 0.17, 0.25, 0.4, 0.5, 0.63, 0.75, 0.9, 0.99, 1];

describe('curve parsing', () => {
  it('round-trips through format/parse', () => {
    const key = 'curve(0,0,0,0,0.2,0.4;0.5,0.8,-0.1,0.1,0.1,-0.1;1,0,-0.3,0,0,0)';
    const keys = parseCurve(key)!;
    expect(keys).toHaveLength(3);
    expect(parseCurve(formatCurve(keys))).toEqual(keys);
  });

  it('rejects non-curves and malformed bodies', () => {
    expect(parseCurve('power2.out')).toBeNull();
    expect(parseCurve('cubic-bezier(0.1,0.2,0.3,0.4)')).toBeNull();
    expect(parseCurve('curve(0,0,0,0,0,0)')).toBeNull(); // one key
    expect(parseCurve('curve(0,0,0,0,0;1,1,0,0,0,0)')).toBeNull(); // 5 fields
    expect(parseCurve('curve(0,0,0,0,0,x;1,1,0,0,0,0)')).toBeNull(); // NaN
  });

  it('caps the key count so the emitted branch chain stays bounded', () => {
    const many = (n: number) =>
      `curve(${Array.from({ length: n }, (_, i) => `${i / (n - 1)},0,0,0,0,0`).join(';')})`;
    expect(parseCurve(many(CURVE_MAX_KEYS))).not.toBeNull();
    expect(parseCurve(many(CURVE_MAX_KEYS + 1))).toBeNull();
  });

  it('normalizes: sorts by x, pins endpoints, clamps handles into their segment', () => {
    const k = normalizeCurve([
      { x: 0.9, y: 1, ix: -5, iy: 0, ox: 5, oy: 0 },
      { x: 0.2, y: 0.5, ix: -5, iy: 0, ox: 5, oy: 0 },
    ]);
    expect(k[0]!.x).toBe(0); // first pinned to 0
    expect(k[1]!.x).toBe(1); // last pinned to 1
    expect(k[0]!.y).toBe(0.5); // and it really was sorted, not just relabelled
    expect(k[0]!.ox).toBe(1); // out-handle clamped to the segment span
    expect(k[0]!.ix).toBe(0); // first key has no room behind it
    expect(k[1]!.ix).toBe(-1);
    expect(k[1]!.ox).toBe(0);
  });

  it('is reported as custom, so the picker shows the editor rather than a preset', () => {
    const key = formatCurve(curveFromBezier({ x1: 0.4, y1: 0, x2: 0.6, y2: 1 }));
    expect(isCurveEase(key)).toBe(true);
    expect(isCustomEase(key)).toBe(true);
    expect(isCustomEase('power2.out')).toBe(false);
  });
});

describe('curve evaluation', () => {
  it('a 2-key curve equals the cubic-bezier it came from', () => {
    const c = { x1: 0.17, y1: 0.67, x2: 0.83, y2: 0.67 };
    const key = formatCurve(curveFromBezier(c));
    for (const t of SAMPLES) {
      expect(sampleEase(key, t)).toBeCloseTo(
        sampleEase(`cubic-bezier(${c.x1},${c.y1},${c.x2},${c.y2})`, t),
        6,
      );
    }
  });

  it('passes exactly through every keyframe', () => {
    const keys: CurveKey[] = [
      { x: 0, y: 0.2, ix: 0, iy: 0, ox: 0.1, oy: 0.3 },
      { x: 0.35, y: 0.9, ix: -0.1, iy: 0, ox: 0.2, oy: 0 },
      { x: 0.7, y: 0.15, ix: -0.2, iy: 0.2, ox: 0.1, oy: -0.05 },
      { x: 1, y: 1, ix: -0.15, iy: 0, ox: 0, oy: 0 },
    ];
    for (const k of keys) expect(sampleCurve(keys, k.x)).toBeCloseTo(k.y, 4);
  });

  it('holds the endpoint values outside t∈[0,1]', () => {
    const keys = normalizeCurve([
      { x: 0, y: 0.25, ix: 0, iy: 0, ox: 0, oy: 0 },
      { x: 1, y: 0.75, ix: 0, iy: 0, ox: 0, oy: 0 },
    ]);
    expect(sampleCurve(keys, -1)).toBe(0.25);
    expect(sampleCurve(keys, 2)).toBe(0.75);
  });

  it('a linear multi-key curve is the identity ramp', () => {
    const keys = normalizeCurve([
      { x: 0, y: 0, ix: 0, iy: 0, ox: 1 / 6, oy: 1 / 6 },
      { x: 0.5, y: 0.5, ix: -1 / 6, iy: -1 / 6, ox: 1 / 6, oy: 1 / 6 },
      { x: 1, y: 1, ix: -1 / 6, iy: -1 / 6, ox: 0, oy: 0 },
    ]);
    for (const t of SAMPLES) expect(sampleCurve(keys, t)).toBeCloseTo(t, 5);
  });
});

describe('shader emission', () => {
  const key = 'curve(0,0,0,0,0.2,0.4;0.5,0.8,-0.1,0.1,0.1,-0.1;1,0,-0.3,0,0,0)';

  it('names identical curves identically and different curves differently', () => {
    expect(easeFnName(key)).toBe(easeFnName(formatCurve(parseCurve(key)!)));
    expect(easeFnName(key)).not.toBe(easeFnName('curve(0,0,0,0,0,0;1,1,0,0,0,0)'));
    expect(easeFnName(key)).toMatch(/^easeSel_cv_[0-9a-f]{8}$/);
  });

  it('emits one branch per interior key in both backends', () => {
    const wgsl = easeFn(key);
    const glsl = easeFnGlsl(key);
    // 3 keys → 2 segments → exactly 1 `if` overwriting segment 0's constants.
    expect(wgsl.match(/if \(t >= /g)).toHaveLength(1);
    expect(glsl.match(/if \(t >= /g)).toHaveLength(1);
    expect(wgsl).toContain(`fn ${easeFnName(key)}(t: f32) -> f32`);
    expect(glsl).toContain(`float ${easeFnName(key)}(float t)`);
    // the Newton solve is emitted once, not once per segment
    expect(wgsl.match(/for \(var i/g)).toHaveLength(1);
    expect(glsl.match(/for \(int i/g)).toHaveLength(1);
  });

  it('WGSL and GLSL carry the same constants in the same order', () => {
    const nums = (src: string) => src.match(/-?\d+\.\d+/g)!.join(',');
    expect(nums(easeFnGlsl(key))).toBe(nums(easeFn(key)));
  });

  it('the emitted constants are the ones the JS sampler used', () => {
    // Segment 0 control points appear verbatim as the initial assignments.
    const k = parseCurve(key)!;
    const wgsl = easeFn(key);
    expect(wgsl).toContain(`ax: f32 = ${k[0]!.x.toFixed(1)}`);
    expect(wgsl).toContain(`dy: f32 = ${k[1]!.y}`);
    expect(wgsl).toContain(`bx: f32 = ${k[0]!.x + k[0]!.ox}`);
  });
});

describe('curveFromEase — taking an existing ease into the point editor', () => {
  it('returns a curve unchanged', () => {
    const key = 'curve(0,0,0,0,0.2,0.4;0.5,0.8,-0.1,0.1,0.1,-0.1;1,0,-0.3,0,0,0)';
    expect(formatCurve(curveFromEase(key))).toBe(formatCurve(parseCurve(key)!));
  });

  it('converts a cubic-bezier exactly, so promoting one never shifts the effect', () => {
    const bez = 'cubic-bezier(0.17,0.67,0.83,0.67)';
    const keys = curveFromEase(bez);
    expect(keys).toHaveLength(2);
    for (const t of SAMPLES) {
      expect(sampleCurve(keys, t)).toBeCloseTo(sampleEase(bez, t), 6);
    }
  });

  it('fits every preset with two points where two points can express it', () => {
    // These are all degree <= 3 in the bezier's own parameter, so a single
    // segment reproduces them outright — an artist opening `power2.out` should
    // see the two points that curve actually has, not a sampled approximation.
    for (const preset of ['linear', 'power1.in', 'power1.out', 'power2.in', 'power2.out', 'back.out']) {
      const keys = curveFromEase(preset);
      expect(keys, preset).toHaveLength(2);
      for (let i = 0; i <= 64; i++) {
        const t = i / 64;
        expect(sampleCurve(keys, t), `${preset} @ ${t}`).toBeCloseTo(sampleEase(preset, t), 9);
      }
    }
  });

  it('spends a third point only on the piecewise eases, and lands them exactly', () => {
    for (const preset of ['power1.inOut', 'power2.inOut']) {
      const keys = curveFromEase(preset);
      expect(keys, preset).toHaveLength(3);
      // the extra key is the seam at the half-way point
      expect(keys[1]!.x).toBeCloseTo(0.5, 2);
      for (let i = 0; i <= 64; i++) {
        const t = i / 64;
        expect(sampleCurve(keys, t), `${preset} @ ${t}`).toBeCloseTo(sampleEase(preset, t), 9);
      }
    }
  });

  it('uses the fewest keys that stay inside the tolerance, never the cap', () => {
    for (const preset of EASE_KEYS) {
      const keys = curveFromEase(preset);
      let worst = 0;
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        worst = Math.max(worst, Math.abs(sampleCurve(keys, t) - sampleEase(preset, t)));
      }
      expect(worst, `${preset} fit error`).toBeLessThan(0.004);
      expect(keys.length, `${preset} key count`).toBeLessThanOrEqual(4);
      // and dropping a key would have missed the bound — the fit is minimal
      if (keys.length > 2) {
        const fewer = curveFromEase(preset, keys.length - 1);
        let w2 = 0;
        for (let i = 0; i <= 200; i++) {
          const t = i / 200;
          w2 = Math.max(w2, Math.abs(sampleCurve(fewer, t) - sampleEase(preset, t)));
        }
        expect(w2, `${preset} with one key fewer`).toBeGreaterThan(0.004);
      }
    }
  });

  it('places fit keys where the curve moves, not evenly in x', () => {
    // expo.out is the hard case: a third of its range lives in the first 5%.
    const keys = curveFromEase('expo.out');
    expect(keys.length).toBeGreaterThan(2);
    expect(keys[1]!.x).toBeLessThan(0.25);
    for (let i = 1; i < keys.length; i++) expect(keys[i]!.x).toBeGreaterThan(keys[i - 1]!.x);
  });

  it('respects the key cap when asked for more', () => {
    expect(curveFromEase('sine.out', 99).length).toBeLessThanOrEqual(CURVE_MAX_KEYS);
  });
});

describe('splitCurveAt — inserting a keyframe by clicking the curve', () => {
  const base = 'curve(0,0,0,0,0.2,0.5;0.55,0.85,-0.2,0,0.2,0;1,0.2,-0.3,0.3,0,0)';

  it('does not change the curve it splits', () => {
    const before = parseCurve(base)!;
    for (const t of [0.12, 0.3, 0.56, 0.7, 0.93]) {
      const after = splitCurveAt(before, t);
      expect(after.length).toBe(before.length + 1);
      for (let i = 0; i <= 200; i++) {
        const u = i / 200;
        expect(sampleCurve(after, u)).toBeCloseTo(sampleCurve(before, u), 6);
      }
    }
  });

  it('puts the new key on the curve, in x order', () => {
    const before = parseCurve(base)!;
    const after = splitCurveAt(before, 0.3);
    const added = after.find((k) => Math.abs(k.x - 0.3) < 0.02)!;
    expect(added).toBeDefined();
    expect(added.y).toBeCloseTo(sampleCurve(before, added.x), 6);
    for (let i = 1; i < after.length; i++) expect(after[i]!.x).toBeGreaterThan(after[i - 1]!.x);
  });

  it('refuses to split at an endpoint, on an existing key, or past the cap', () => {
    const before = parseCurve(base)!;
    expect(splitCurveAt(before, 0)).toBe(before);
    expect(splitCurveAt(before, 1)).toBe(before);
    expect(splitCurveAt(before, 0.55)).toBe(before); // an existing key sits here
    let full = before;
    while (full.length < CURVE_MAX_KEYS) full = splitCurveAt(full, Math.random() * 0.9 + 0.05);
    expect(full).toHaveLength(CURVE_MAX_KEYS);
    expect(splitCurveAt(full, 0.42)).toBe(full);
  });

  it('survives a split-then-split of the same region', () => {
    const before = parseCurve(base)!;
    const twice = splitCurveAt(splitCurveAt(before, 0.3), 0.15);
    expect(twice).toHaveLength(before.length + 2);
    for (let i = 0; i <= 100; i++) {
      const u = i / 100;
      expect(sampleCurve(twice, u)).toBeCloseTo(sampleCurve(before, u), 5);
    }
  });
});

describe('removeCurveKey', () => {
  const base = parseCurve('curve(0,0,0,0,0.2,0.5;0.55,0.85,-0.2,0,0.2,0;1,0.2,-0.3,0.3,0,0)')!;

  it('drops an interior key', () => {
    const out = removeCurveKey(base, 1);
    expect(out).toHaveLength(2);
    expect(out[0]!.x).toBe(0);
    expect(out[1]!.x).toBe(1);
  });

  it('never removes an endpoint or goes below two keys', () => {
    expect(removeCurveKey(base, 0)).toBe(base);
    expect(removeCurveKey(base, 2)).toBe(base);
    expect(removeCurveKey(removeCurveKey(base, 1), 0)).toHaveLength(2);
  });
});

describe('moveCurveKey — dragging a point', () => {
  const base = parseCurve('curve(0,0,0,0,0.2,0.2;0.5,0.5,-0.2,-0.2,0.2,0.2;1,1,-0.2,-0.2,0,0)')!;

  it('lets an interior key move freely between its neighbours', () => {
    const out = moveCurveKey(base, 1, 0.7, 0.25);
    expect(out[1]!.x).toBeCloseTo(0.7, 6);
    expect(out[1]!.y).toBeCloseTo(0.25, 6);
  });

  it('never lets a key cross a neighbour, in either direction', () => {
    const four = splitCurveAt(base, 0.75);
    expect(four).toHaveLength(4);
    const pushedRight = moveCurveKey(four, 1, 5, 0.5);
    expect(pushedRight[1]!.x).toBeLessThan(pushedRight[2]!.x);
    const pushedLeft = moveCurveKey(four, 2, -5, 0.5);
    expect(pushedLeft[2]!.x).toBeGreaterThan(pushedLeft[1]!.x);
    // and the order is still strictly increasing, so no zero-width segment
    for (const keys of [pushedRight, pushedLeft]) {
      for (let i = 1; i < keys.length; i++) expect(keys[i]!.x).toBeGreaterThan(keys[i - 1]!.x);
    }
  });

  it('pins the endpoints in x but lets them move in y', () => {
    const first = moveCurveKey(base, 0, 0.4, 0.6);
    expect(first[0]!.x).toBe(0);
    expect(first[0]!.y).toBeCloseTo(0.6, 6);
    const last = moveCurveKey(base, base.length - 1, 0.4, -0.2);
    expect(last[last.length - 1]!.x).toBe(1);
    expect(last[last.length - 1]!.y).toBeCloseTo(-0.2, 6);
  });

  it('ignores an out-of-range index rather than corrupting the curve', () => {
    expect(moveCurveKey(base, 9, 0.5, 0.5)).toBe(base);
  });
});

describe('moveCurveHandle — shaping a point', () => {
  const base = parseCurve('curve(0,0,0,0,0.2,0.2;0.5,0.5,-0.2,-0.1,0.15,0.3;1,1,-0.2,-0.2,0,0)')!;

  it('mirrors the opposite handle, preserving its own length', () => {
    const before = base[1]!;
    const farLen = Math.hypot(before.ix, before.iy);
    const out = moveCurveHandle(base, 1, 'out', base[1]!.x + 0.3, base[1]!.y + 0.1);
    const k = out[1]!;
    // dragged handle landed where asked
    expect(k.ox).toBeCloseTo(0.3, 6);
    expect(k.oy).toBeCloseTo(0.1, 6);
    // opposite handle kept its length…
    expect(Math.hypot(k.ix, k.iy)).toBeCloseTo(farLen, 6);
    // …and points the opposite way (unit vectors sum to zero)
    const uo = [k.ox / Math.hypot(k.ox, k.oy), k.oy / Math.hypot(k.ox, k.oy)];
    const ui = [k.ix / Math.hypot(k.ix, k.iy), k.iy / Math.hypot(k.ix, k.iy)];
    expect(uo[0]! + ui[0]!).toBeCloseTo(0, 6);
    expect(uo[1]! + ui[1]!).toBeCloseTo(0, 6);
  });

  it('leaves the opposite handle alone when broken', () => {
    const before = base[1]!;
    const out = moveCurveHandle(base, 1, 'out', base[1]!.x + 0.3, base[1]!.y + 0.1, { broken: true });
    expect(out[1]!.ix).toBeCloseTo(before.ix, 6);
    expect(out[1]!.iy).toBeCloseTo(before.iy, 6);
  });

  it('does not mirror on the endpoints — they only have one handle', () => {
    const out = moveCurveHandle(base, 0, 'out', 0.4, 0.5);
    expect(out[0]!.ox).toBeCloseTo(0.4, 6);
    expect(out[0]!.ix).toBe(0);
    const last = base.length - 1;
    const out2 = moveCurveHandle(base, last, 'in', 0.6, 0.5);
    expect(out2[last]!.ox).toBe(0);
  });

  it('clamps a handle into its own segment, keeping X(s) invertible', () => {
    // Reach far past the next key; x must stop at the segment boundary.
    const out = moveCurveHandle(base, 1, 'out', 9, 0.5, { broken: true });
    expect(out[1]!.ox).toBeCloseTo(base[2]!.x - base[1]!.x, 6);
    // Dragging an out-handle backwards is not allowed either.
    const back = moveCurveHandle(base, 1, 'out', base[1]!.x - 1, 0.5, { broken: true });
    expect(back[1]!.ox).toBe(0);
  });

  it('survives a zero-length drag onto the point itself', () => {
    const out = moveCurveHandle(base, 1, 'out', base[1]!.x, base[1]!.y);
    expect(Number.isFinite(out[1]!.ix)).toBe(true);
    expect(Number.isFinite(out[1]!.ox)).toBe(true);
    for (let i = 0; i <= 32; i++) expect(Number.isFinite(sampleCurve(out, i / 32))).toBe(true);
  });
});
