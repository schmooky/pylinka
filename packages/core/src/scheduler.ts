/**
 * SpawnScheduler (REQUIREMENTS.md §13.7). Pure CPU spawn accounting — the only
 * per-frame CPU work besides uniform writes. Allocation-free after construction.
 *
 * Produces the per-frame `spawnCount` for the emit dispatch. `emitterDist` is
 * the distance the emitter travelled this frame (drives rate-over-distance).
 *
 * Timeline: `delay` holds every mode back, `duration` stops flow and burst
 * after that long, and a burst may draw its count and its next interval from
 * a range (`countMax`, `intervalMax`) and fire its first burst at once
 * (`immediate`). An emitter with none of these behaves exactly as before.
 */
import type { EmitterSettings } from '@pylinka/graph';

export class SpawnScheduler {
  private acc = 0;
  private pendingBurst = 0;
  private burstClock = 0;
  private startedOnce = false;
  /** seconds since start (or restart) */
  private elapsed = 0;
  /** seconds until the next burst; drawn per burst when intervalMax is set */
  private nextInterval = -1;
  private firedImmediate = false;

  constructor(
    private emitter: EmitterSettings,
    private readonly capacity: number,
    /** [0, 1) source for count / interval ranges; inject for determinism */
    private readonly random: () => number = Math.random,
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
    if (next.burst?.interval !== this.emitter.burst?.interval || next.burst?.intervalMax !== this.emitter.burst?.intervalMax) {
      this.nextInterval = -1;
    }
    this.emitter = next;
  }

  /** True once a `duration` (or a fired `once`) has run out: nothing more will spawn. */
  get finished(): boolean {
    const e = this.emitter;
    if (e.mode === 'once') return this.startedOnce;
    const d = e.duration ?? 0;
    return d > 0 && this.elapsed >= (e.delay ?? 0) + d;
  }

  /** Advance one frame; returns the spawn count (clamped to capacity). */
  tick(dt: number, emitterDist: number): number {
    const e = this.emitter;
    const before = this.elapsed;
    this.elapsed += dt;
    const delay = e.delay ?? 0;
    const duration = e.duration ?? 0;
    // the slice of this frame the emitter is running for
    const start = Math.max(before, delay);
    const end = duration > 0 ? Math.min(this.elapsed, delay + duration) : this.elapsed;
    // a frame wholly inside the window counts as exactly dt: re-deriving it from
    // the elapsed sum adds float error that floors a 0.5-per-frame flow to zero
    const inside = before >= delay && (duration <= 0 || this.elapsed <= delay + duration);
    const live = inside ? dt : Math.max(0, end - start);
    const running = this.elapsed > delay || (delay === 0 && before === 0);

    switch (e.mode) {
      case 'flow':
        if (live > 0) {
          // distance spawns scale with the share of the frame the emitter ran
          this.acc += e.rate * live + (e.rateOverDistance ?? 0) * emitterDist * (dt > 0 ? live / dt : 1);
        }
        break;
      case 'burst':
        if (e.burst !== undefined && e.burst.interval > 0 && running) {
          if (e.burst.immediate === true && !this.firedImmediate) {
            this.firedImmediate = true;
            this.pendingBurst += this.burstCount();
          }
          if (this.nextInterval < 0) this.nextInterval = this.drawInterval();
          this.burstClock += live;
          while (this.burstClock >= this.nextInterval) {
            this.burstClock -= this.nextInterval;
            this.pendingBurst += this.burstCount();
            this.nextInterval = this.drawInterval();
          }
        }
        break;
      case 'once':
        if (!this.startedOnce && running) {
          this.pendingBurst += e.burst !== undefined ? this.burstCount() : e.rate;
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

  /** A whole count in [count, countMax]; just `count` without a range. */
  private burstCount(): number {
    const b = this.emitter.burst!;
    const hi = b.countMax;
    if (hi === undefined || hi <= b.count) return b.count;
    return b.count + Math.floor(this.random() * (Math.floor(hi) - b.count + 1));
  }

  private drawInterval(): number {
    const b = this.emitter.burst!;
    const hi = b.intervalMax;
    if (hi === undefined || hi <= b.interval) return b.interval;
    return b.interval + this.random() * (hi - b.interval);
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
    this.elapsed = 0;
    this.nextInterval = -1;
    this.firedImmediate = false;
  }
}
