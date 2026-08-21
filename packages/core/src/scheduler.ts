/**
 * SpawnScheduler (REQUIREMENTS.md §13.7). Pure CPU spawn accounting — the only
 * per-frame CPU work besides uniform writes. Allocation-free after construction.
 *
 * Produces the per-frame `spawnCount` for the emit dispatch. `emitterDist` is
 * the distance the emitter travelled this frame (drives rate-over-distance).
 */
import type { EmitterSettings } from '@pylinka/graph';

export class SpawnScheduler {
  private acc = 0;
  private pendingBurst = 0;
  private burstClock = 0;
  private startedOnce = false;

  constructor(
    private emitter: EmitterSettings,
    private readonly capacity: number,
  ) {}

  /**
   * Swap the emitter settings while keeping the accumulators.
   *
   * Live editing re-reads the project on every change, and a fresh scheduler
   * would drop the fractional spawn debt each time — a 30/s flow emitter puts
   * 0.5 particles in `acc` per frame, so restarting it every frame floors to
   * zero forever and the effect silently dies while you drag a slider. Burst
   * emitters lose `burstClock` the same way and stop firing. Keeping the
   * accumulators is what makes a live-edit preview behave.
   *
   * Switching *into* `once` mode is the one thing that should re-arm: the user
   * asked for a one-shot they have not seen yet.
   */
  setEmitter(next: EmitterSettings): void {
    if (next.mode === 'once' && this.emitter.mode !== 'once') this.startedOnce = false;
    this.emitter = next;
  }

  /** Advance one frame; returns the spawn count (clamped to capacity). */
  tick(dt: number, emitterDist: number): number {
    const e = this.emitter;
    switch (e.mode) {
      case 'flow':
        this.acc += e.rate * dt + (e.rateOverDistance ?? 0) * emitterDist;
        break;
      case 'burst':
        if (e.burst !== undefined && e.burst.interval > 0) {
          this.burstClock += dt;
          while (this.burstClock >= e.burst.interval) {
            this.burstClock -= e.burst.interval;
            this.pendingBurst += e.burst.count;
          }
        }
        break;
      case 'once':
        if (!this.startedOnce) {
          this.pendingBurst += e.burst?.count ?? e.rate;
          this.startedOnce = true;
        }
        break;
    }

    this.acc += this.pendingBurst;
    this.pendingBurst = 0;

    const count = Math.min(Math.floor(this.acc), this.capacity);
    this.acc -= count;
    return count;
  }

  /** Queue an extra burst for the next frame (§7.4). */
  spawnBurst(n: number): void {
    this.pendingBurst += n;
  }

  /** Reset all accumulators (restart). */
  reset(): void {
    this.acc = 0;
    this.pendingBurst = 0;
    this.burstClock = 0;
    this.startedOnce = false;
  }
}
