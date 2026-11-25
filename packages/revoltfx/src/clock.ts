/**
 * RevoltFX's emitter spawn clock, as `ParticleEmitter.update` / `spawn` run it.
 *
 * Pylinka's own scheduler has a fixed burst count and interval and fires its
 * first burst one interval late. RevoltFX fires on its first frame, then
 * waits `Rnd.float(fMin, fMax)` seconds, spawns `Rnd.integer(cMin, cMax)`
 * particles (max exclusive), and stops after `duration`. The player runs this
 * clock and hands each count to `ParticleSystemView.spawnBurst`, so spawn
 * timing is RevoltFX's, not an approximation.
 */
import type { SpawnClock } from './convert.js';

export class SpawnClockRunner {
  /** seconds since the last spawn (`_time`); starts huge so frame 1 fires */
  private time = Number.MAX_VALUE;
  private next = 0;
  private elapsed = 0;
  private done = false;

  constructor(
    private readonly clock: SpawnClock,
    private readonly random: () => number = Math.random,
  ) {}

  /** True once the emitter has stopped spawning (`exhausted`). */
  get exhausted(): boolean {
    return this.done;
  }

  /** `stop(true)`: stop spawning, let live particles finish. */
  stop(): void {
    this.done = true;
  }

  /** Back to the state right after `start()`. */
  reset(): void {
    this.time = Number.MAX_VALUE;
    this.next = 0;
    this.elapsed = 0;
    this.done = false;
  }

  /** Advance one frame; returns how many particles RevoltFX spawns on it. */
  step(dt: number): number {
    if (this.done) return 0;
    const c = this.clock;
    this.elapsed += dt;
    if (c.duration <= 0 && !c.infinite) {
      this.done = true;
      return this.count();
    }
    if (c.infinite || this.elapsed < c.duration) {
      this.time += dt;
      if (this.time >= this.next) {
        this.time = 0;
        this.next = c.frequencyMin + this.random() * (c.frequencyMax - c.frequencyMin);
        return this.count();
      }
      return 0;
    }
    this.done = true;
    return 0;
  }

  /** `Rnd.integer(cMin, cMax) * particleFac`, then `while (--n > -1)` → ceil. */
  private count(): number {
    const c = this.clock;
    const n = Math.floor(this.random() * (c.countMax - c.countMin) + c.countMin) * c.particleFac;
    return n > 0 ? Math.ceil(n) : 0;
  }
}
