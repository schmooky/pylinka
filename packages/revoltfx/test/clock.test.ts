import { describe, expect, it } from 'vitest';
import { SpawnClockRunner, type SpawnClock } from '../src/index.js';

const clock = (c: Partial<SpawnClock>): SpawnClock => ({
  frequencyMin: 0.1,
  frequencyMax: 0.1,
  countMin: 2,
  countMax: 2,
  particleFac: 1,
  duration: 0,
  infinite: true,
  ...c,
});

function run(r: SpawnClockRunner, frames: number, dt = 1 / 60): number[] {
  return Array.from({ length: frames }, () => r.step(dt));
}

describe('SpawnClockRunner (ParticleEmitter.update)', () => {
  it('fires on the first frame, then every frequency', () => {
    const counts = run(new SpawnClockRunner(clock({ frequencyMin: 0.05, frequencyMax: 0.05 })), 12);
    // 0.05 s at 60 fps: the 3rd frame after a spawn crosses it (3/60 = 0.05)
    expect(counts.map((c) => (c > 0 ? 1 : 0))).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
  });

  it('spawns at most once per frame when the frequency is below dt', () => {
    expect(run(new SpawnClockRunner(clock({ frequencyMin: 0.001, frequencyMax: 0.001 })), 5)).toEqual([2, 2, 2, 2, 2]);
  });

  it('a one-shot spawns once', () => {
    const r = new SpawnClockRunner(clock({ infinite: false, duration: 0, countMin: 7, countMax: 7 }));
    expect(run(r, 4)).toEqual([7, 0, 0, 0]);
    expect(r.exhausted).toBe(true);
  });

  it('stops after duration', () => {
    const r = new SpawnClockRunner(clock({ infinite: false, duration: 0.55, frequencyMin: 0.001, frequencyMax: 0.001 }));
    const counts = run(r, 10, 0.1);
    expect(counts.filter((c) => c > 0).length).toBe(5); // frames while elapsed < 0.55 s
    expect(r.exhausted).toBe(true);
  });

  it('Rnd.integer has an exclusive max', () => {
    let i = 0;
    // each spawn draws the next interval, then the count
    const seq = [0.5, 0, 0.5, 0.999999];
    const r = new SpawnClockRunner(clock({ countMin: 3, countMax: 5, frequencyMin: 0, frequencyMax: 0 }), () => seq[i++ % 4]!);
    const seen = new Set(run(r, 20));
    expect([...seen].sort()).toEqual([3, 4]);
  });

  it('particleFac scales the count, rounded up like `while (--n > -1)`', () => {
    const r = new SpawnClockRunner(clock({ countMin: 5, countMax: 5, particleFac: 0.5 }));
    expect(r.step(1 / 60)).toBe(3);
  });

  it('stop() and reset()', () => {
    const r = new SpawnClockRunner(clock({}));
    r.stop();
    expect(r.step(1)).toBe(0);
    r.reset();
    expect(r.step(1 / 60)).toBe(2);
  });
});
