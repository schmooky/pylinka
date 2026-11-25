import { describe, expect, it } from 'vitest';
import { parseCurve, sampleEase } from '@pylinka/compiler';
import { PENNER, PRESET_EQUIVALENT, fitDrag, mapEase } from '../src/index.js';
import { fadeWindow, heldRamp } from '../src/ease.js';

const ts = Array.from({ length: 101 }, (_, i) => i / 100);

describe('Penner eases', () => {
  it('are normalised to 0 → 1', () => {
    for (const [name, f] of Object.entries(PENNER)) {
      expect(f(0), name).toBeCloseTo(0, 2);
      expect(f(1), name).toBeCloseTo(1, 2);
    }
  });

  it('every claimed preset equivalent is the same function', () => {
    for (const [rfx, preset] of Object.entries(PRESET_EQUIVALENT)) {
      for (const t of ts) expect(sampleEase(preset, t), `${rfx} vs ${preset} at ${t}`).toBeCloseTo(PENNER[rfx]!(t), 9);
    }
  });

  it('every other ease fits as a valid curve within a small error', () => {
    for (const name of Object.keys(PENNER)) {
      const fit = mapEase(name);
      if (PRESET_EQUIVALENT[name]) {
        expect(fit).toEqual({ key: PRESET_EQUIVALENT[name], error: 0 });
        continue;
      }
      expect(parseCurve(fit.key), name).not.toBeNull();
      // re-measure through the compiler's own sampler
      const err = Math.max(...ts.map((t) => Math.abs(sampleEase(fit.key, t) - PENNER[name]!(t))));
      expect(err, name).toBeCloseTo(fit.error, 2);
      const bound = /Elastic|Bounce/.test(name) ? 0.06 : 0.006;
      expect(fit.error, name).toBeLessThan(bound);
    }
  });

  it('unknown ease names fall back to linear, as `Easing[x] || linear` does', () => {
    expect(mapEase('noSuchEase')).toEqual({ key: 'linear', error: 0 });
  });
});

describe('fade-in / scale-in windows', () => {
  it('linear windows are exact', () => {
    const ramp = heldRamp('linear', 0.25);
    const win = fadeWindow('linear', 0.25);
    expect(ramp.error).toBeLessThan(1e-6);
    expect(win.error).toBeLessThan(1e-6);
    // held at 0 for the first quarter, then linear
    expect(sampleEase(ramp.key, 0.2)).toBeCloseTo(0, 6);
    expect(sampleEase(ramp.key, 0.625)).toBeCloseTo(0.5, 6);
    expect(sampleEase(win.key, 0.125)).toBeCloseTo(0.5, 6);
    expect(sampleEase(win.key, 0.6)).toBeCloseTo(1, 6);
  });

  it('a missing fadeInEase means easeInSine', () => {
    const win = fadeWindow('', 0.5);
    expect(sampleEase(win.key, 0.25)).toBeCloseTo(PENNER.easeInSine!(0.5), 2);
  });
});

describe('distance tween → drag', () => {
  it('linear is exact', () => {
    expect(fitDrag('linear')).toEqual({ c: 0, error: 0 });
  });

  it('ease-out fits a positive drag, ease-in a negative one', () => {
    const out = fitDrag('easeOutQuint');
    const inn = fitDrag('easeInCubic');
    expect(out.c).toBeGreaterThan(0);
    expect(inn.c).toBeLessThan(0);
    expect(out.error).toBeLessThan(0.03);
    expect(inn.error).toBeLessThan(0.04);
  });

  it('the drag model reaches exactly the full distance at death', () => {
    const { c } = fitDrag('easeOutSine');
    const D = 100;
    const life = 1.3;
    const v0 = (D * c) / (life * (1 - Math.exp(-c)));
    const k = c / life;
    // integrate the engine's step: v *= exp(−k·dt); x += v·dt
    let x = 0;
    let v = v0;
    const dt = 1 / 2000;
    for (let t = 0; t < life - 1e-9; t += dt) {
      v *= Math.exp(-k * dt);
      x += v * dt;
    }
    expect(x).toBeCloseTo(D, 0);
  });
});
