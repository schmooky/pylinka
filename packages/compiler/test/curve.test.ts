/**
 * Pins the multi-keyframe curve flavour (curve.ts). The load-bearing claim is
 * that the plotted curve, the WGSL body and the GLSL body are the same
 * function — the artist drags a point and the GPU runs exactly that.
 */
import { describe, expect, it } from 'vitest';
import {
  CURVE_MAX_KEYS,
  curveFromBezier,
  easeFnName,
  formatCurve,
  isCurveEase,
  isCustomEase,
  normalizeCurve,
  parseCurve,
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
