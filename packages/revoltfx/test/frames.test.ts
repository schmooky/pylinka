import { describe, expect, it } from 'vitest';
import { componentSize, movieClipFrames, spriteBox } from '../src/index.js';
import { sheet } from './helpers.js';

describe('spriteBox', () => {
  it('a centred square sprite fills the box', () => {
    expect(spriteBox(64, 64)).toEqual({ side: 64, offsetX: 0, offsetY: 0, width: 64, height: 64 });
  });

  it('a wide sprite is centred in a square of its long edge', () => {
    expect(spriteBox(100, 40)).toMatchObject({ side: 100, offsetX: 0, offsetY: 30 });
  });

  it('moves the anchor to the centre', () => {
    for (const [ax, ay] of [[0.3, 0.5], [0.8, 0.1], [0, 1]] as const) {
      const w = 50;
      const h = 30;
      const b = spriteBox(w, h, ax, ay);
      expect(b.offsetX + ax * w, `x ${ax}`).toBeCloseTo(b.side / 2);
      expect(b.offsetY + ay * h, `y ${ay}`).toBeCloseTo(b.side / 2);
      expect(b.offsetX).toBeGreaterThanOrEqual(0);
      expect(b.offsetX + w).toBeLessThanOrEqual(b.side + 1e-9);
    }
  });
});

describe('sheet lookups', () => {
  it('groups mc_<group>_<frame> frames like FX.parseObject', () => {
    const frames = movieClipFrames(sheet, 'fx-explo');
    expect(frames.length).toBeGreaterThan(10);
    expect(frames.every((f) => f.startsWith('mc_fx-explo_'))).toBe(true);
    // 'fx-explo-sparky' is its own group
    expect(frames.some((f) => f.includes('sparky'))).toBe(false);
  });

  it('uses the untrimmed source size', () => {
    expect(componentSize(sheet, 0, 'fx-blood01')).toEqual({ w: 70, h: 72 });
    expect(componentSize(sheet, 0, 'missing')).toBeUndefined();
  });
});
