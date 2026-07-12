/**
 * Per-system CPU frame state shared by the compiled backends: emitter position
 * (current/previous), spawn scheduling, sim time, frame counter, and the
 * per-frame baseSeed advance (§13.4, §13.7, §13.11). Alloc-free in tick().
 */
import type { EmitterSettings } from '@pylinka/graph';
import { SpawnScheduler } from '../scheduler.js';
import { pcg } from './staging.js';

export class SystemClock {
  ex: number;
  ey: number;
  px: number;
  py: number;
  time = 0;
  frame = 0;
  baseSeed: number;
  spawnCount = 0;
  private scheduler: SpawnScheduler;

  constructor(emitter: EmitterSettings, capacity: number, startX: number, startY: number, seed?: number) {
    this.scheduler = new SpawnScheduler(emitter, capacity);
    this.ex = startX;
    this.ey = startY;
    this.px = startX;
    this.py = startY;
    this.baseSeed = (seed ?? Date.now()) >>> 0;
  }

  /** §13.11 step 2: schedule spawns and advance the seed for this frame. */
  tick(dt: number): void {
    const dist = Math.hypot(this.ex - this.px, this.ey - this.py);
    this.spawnCount = this.scheduler.tick(dt, dist);
    this.baseSeed = pcg(this.baseSeed);
  }

  /** §13.11 step 6 — after dispatch, current becomes previous. */
  endFrame(dt: number): void {
    this.px = this.ex;
    this.py = this.ey;
    this.time += dt;
    this.frame = (this.frame + 1) >>> 0;
  }

  /** emitterVel uniform: travel this frame over dt (§13.7). */
  velX(dt: number): number {
    return dt > 0 ? (this.ex - this.px) / dt : 0;
  }
  velY(dt: number): number {
    return dt > 0 ? (this.ey - this.py) / dt : 0;
  }

  spawnBurst(n: number): void {
    this.scheduler.spawnBurst(n);
  }

  /** Swap emitter settings without losing position (apply()). */
  setEmitterSettings(emitter: EmitterSettings, capacity: number): void {
    this.scheduler = new SpawnScheduler(emitter, capacity);
  }

  reset(): void {
    this.scheduler.reset();
    this.time = 0;
    this.frame = 0;
  }
}
