/**
 * Pins the JS ease sampler (used for editor curve plots) to the WGSL/GLSL the
 * shaders actually run. `sampleEase` is a fourth rendering of the §13.9 catalog;
 * if it drifts from EASE_BODIES the plotted curve lies about the GPU. These
 * lock the endpoints, a mid-point per preset, and the custom cubic-bezier path.
 */
import { describe, expect, it } from 'vitest';
import {
  EASE_KEYS,
  sampleEase,
  parseCubicBezier,
  isCustomEase,
  easeFn,
  easeFnGlsl,
  easeFnName,
} from '../src/ease.js';

const HALF_PI = Math.PI / 2;

describe('sampleEase — presets', () => {
  it('every preset key has a sampler and pins [0,1] endpoints', () => {
    for (const k of EASE_KEYS) {
      expect(sampleEase(k, 0)).toBeCloseTo(0, 6);
      expect(sampleEase(k, 1)).toBeCloseTo(1, 6);
    }
  });

  it('matches the §13.9 formulas at the midpoint', () => {
    expect(sampleEase('linear', 0.5)).toBeCloseTo(0.5, 6);
    expect(sampleEase('power1.in', 0.5)).toBeCloseTo(0.25, 6);
    expect(sampleEase('power1.out', 0.5)).toBeCloseTo(0.75, 6);
    expect(sampleEase('power2.in', 0.5)).toBeCloseTo(0.125, 6);
    expect(sampleEase('power2.out', 0.5)).toBeCloseTo(0.875, 6);
    expect(sampleEase('power3.in', 0.5)).toBeCloseTo(0.0625, 6);
    expect(sampleEase('sine.out', 0.5)).toBeCloseTo(Math.sin(0.5 * HALF_PI), 6);
    expect(sampleEase('sine.in', 0.5)).toBeCloseTo(1 - Math.cos(0.5 * HALF_PI), 6);
    // back.out overshoots above 1 before settling — the signature of a back ease
    expect(sampleEase('back.out', 0.6)).toBeGreaterThan(1);
  });

  it('unknown keys fall back to linear', () => {
    expect(sampleEase('does.not.exist', 0.42)).toBeCloseTo(0.42, 6);
  });
});

describe('custom cubic-bezier', () => {
  it('parses CSS syntax and clamps x to [0,1]', () => {
    expect(parseCubicBezier('cubic-bezier(0.17,0.67,0.83,0.67)')).toEqual({
      x1: 0.17,
      y1: 0.67,
      x2: 0.83,
      y2: 0.67,
    });
    // x's clamp (CSS spec); y's are free (can overshoot for anticipation/back)
    expect(parseCubicBezier('cubic-bezier(-1, -0.5, 2, 1.5)')).toEqual({
      x1: 0,
      y1: -0.5,
      x2: 1,
      y2: 1.5,
    });
    expect(parseCubicBezier('power2.out')).toBeNull();
    expect(parseCubicBezier('cubic-bezier(1,2,3)')).toBeNull();
    expect(isCustomEase('cubic-bezier(.25,.1,.25,1)')).toBe(true);
    expect(isCustomEase('sine.out')).toBe(false);
  });

  it('a linear-equivalent bezier samples like linear', () => {
    // control points on the diagonal → the identity curve
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(sampleEase('cubic-bezier(0.333,0.333,0.667,0.667)', t)).toBeCloseTo(t, 3);
    }
  });

  it('pins [0,1] endpoints and stays monotone for an ease-in-out bezier', () => {
    const key = 'cubic-bezier(0.42,0,0.58,1)';
    expect(sampleEase(key, 0)).toBeCloseTo(0, 4);
    expect(sampleEase(key, 1)).toBeCloseTo(1, 4);
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const y = sampleEase(key, i / 20);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-4);
      prev = y;
    }
  });
});

describe('shader emission for custom bezier', () => {
  const key = 'cubic-bezier(0.17,0.67,0.83,0.67)';

  it('mangles a stable, GLSL/WGSL-safe function name', () => {
    const name = easeFnName(key);
    expect(name).toMatch(/^easeSel_cb_[0-9a-f]{8}$/);
    // identical curves dedupe to the same name
    expect(easeFnName('cubic-bezier(0.17,0.67,0.83,0.67)')).toBe(name);
  });

  it('emits a WGSL fn with the mangled name and a Newton loop', () => {
    const src = easeFn(key);
    expect(src).toContain(`fn ${easeFnName(key)}(t: f32) -> f32`);
    expect(src).toContain('for (var i = 0;');
  });

  it('emits a GLSL fn with the mangled name and a Newton loop', () => {
    const src = easeFnGlsl(key);
    expect(src).toContain(`float ${easeFnName(key)}(float t)`);
    expect(src).toContain('for (int i = 0;');
  });

  it('presets still emit byte-identical WGSL/GLSL (golden discipline)', () => {
    expect(easeFn('power2.out')).toBe(
      'fn easeSel_power2_out(t: f32) -> f32 { let u = 1.0 - t; return 1.0 - u * u * u; }',
    );
    expect(easeFnGlsl('power2.out')).toBe(
      'float easeSel_power2_out(float t) { float u = 1.0 - t; return 1.0 - u * u * u; }',
    );
  });
});
