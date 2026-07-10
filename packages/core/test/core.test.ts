import { describe, expect, it } from 'vitest';
import type { EmitterSettings, ParamDef } from '@pylinka/graph';
import { FixedStepDriver, KnobStore, SpawnScheduler, clampDt } from '../src/index.js';

describe('SpawnScheduler — §13.7', () => {
  it('flow mode accumulates rate × dt and yields whole particles', () => {
    const s = new SpawnScheduler({ mode: 'flow', rate: 100 }, 10000);
    expect(s.tick(1 / 60, 0)).toBe(1); // 1.667 → 1
    // over one second the fractional remainder is conserved: ~100 total
    let total = 1;
    for (let i = 0; i < 59; i++) total += s.tick(1 / 60, 0);
    expect(total).toBe(100);
  });

  it('flow adds rate-over-distance from emitter travel', () => {
    const s = new SpawnScheduler({ mode: 'flow', rate: 0, rateOverDistance: 0.5 }, 10000);
    expect(s.tick(1 / 60, 10)).toBe(5); // 0.5 × 10 px
  });

  it('clamps spawn count to capacity', () => {
    const s = new SpawnScheduler({ mode: 'flow', rate: 1_000_000 }, 50);
    expect(s.tick(1, 0)).toBe(50);
  });

  it('burst mode emits count every interval', () => {
    const e: EmitterSettings = { mode: 'burst', rate: 0, burst: { count: 20, interval: 0.5 } };
    const s = new SpawnScheduler(e, 10000);
    expect(s.tick(0.25, 0)).toBe(0);
    expect(s.tick(0.25, 0)).toBe(20); // hits 0.5
    expect(s.tick(1.0, 0)).toBe(40); // two intervals
  });

  it('once mode emits a single burst then nothing', () => {
    const e: EmitterSettings = { mode: 'once', rate: 0, burst: { count: 200, interval: 0 } };
    const s = new SpawnScheduler(e, 10000);
    expect(s.tick(0.016, 0)).toBe(200);
    expect(s.tick(0.016, 0)).toBe(0);
  });

  it('spawnBurst adds to the next frame; reset clears state', () => {
    const s = new SpawnScheduler({ mode: 'flow', rate: 0 }, 10000);
    s.spawnBurst(7);
    expect(s.tick(0.016, 0)).toBe(7);
    s.spawnBurst(5);
    s.reset();
    expect(s.tick(0.016, 0)).toBe(0);
  });
});

describe('KnobStore — §11.5', () => {
  const params: ParamDef[] = [
    { id: 'p1', name: 'windPower', type: 'f32', scale: 'linear', default: { t: 'f32', v: 10 } },
    { id: 'p2', name: 'origin', type: 'vec2', scale: 'linear', default: { t: 'vec2', v: [3, 4] } },
  ];

  it('registers defaults from ParamDefs', () => {
    const k = new KnobStore(params);
    expect(k.get('windPower')).toBe(10);
    const out = new Float32Array(4);
    k.vec4('origin', out, 0);
    expect([out[0], out[1]]).toEqual([3, 4]);
  });

  it('set overwrites in place and get returns the x component', () => {
    const k = new KnobStore(params);
    k.set('windPower', 42);
    expect(k.get('windPower')).toBe(42);
    k.set('origin', 1, 2, 3, 4);
    const out = new Float32Array(4);
    k.vec4('origin', out, 0);
    expect([...out]).toEqual([1, 2, 3, 4]);
  });

  it('unknown knob reads as 0', () => {
    const k = new KnobStore(params);
    expect(k.get('nope')).toBe(0);
  });
});

describe('frame time — §7.2', () => {
  it('clampDt caps and floors', () => {
    expect(clampDt(0.2, 0.05)).toBe(0.05);
    expect(clampDt(0.01, 0.05)).toBe(0.01);
    expect(clampDt(-1, 0.05)).toBe(0);
    expect(clampDt(Number.NaN)).toBe(0);
  });

  it('FixedStepDriver runs whole steps and carries the remainder', () => {
    const d = new FixedStepDriver(1 / 60);
    expect(d.steps(1 / 60)).toBe(1);
    expect(d.steps(1 / 120)).toBe(0); // not enough yet
    expect(d.steps(1 / 120)).toBe(1); // now crosses
    expect(d.steps(0.2)).toBe(3); // clamped to 0.05 → 3 steps of 1/60
  });

  it('rejects a non-positive step', () => {
    expect(() => new FixedStepDriver(0)).toThrow();
  });
});
