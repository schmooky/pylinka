/**
 * Frame-time policy (REQUIREMENTS.md §7.2, §13.7). Host rAF dt is clamped
 * (default 50 ms) to survive tab-switch spikes; fixed-step mode accumulates real
 * dt and runs whole steps of size `h` for deterministic capture/replay.
 */

export const DEFAULT_MAX_DT = 0.05;

/** Clamp a raw frame dt into [0, maxDt]. */
export function clampDt(dt: number, maxDt: number = DEFAULT_MAX_DT): number {
  if (!(dt > 0)) return 0; // NaN / negative → 0
  return dt < maxDt ? dt : maxDt;
}

/**
 * Fixed-step accumulator. Feed it the real (clamped) dt each frame; it returns
 * how many steps of size `h` to run. No render interpolation in v1.
 */
export class FixedStepDriver {
  private acc = 0;

  constructor(
    private readonly h: number,
    private readonly maxDt: number = DEFAULT_MAX_DT,
  ) {
    if (!(h > 0)) throw new Error('FixedStepDriver step must be > 0');
  }

  /** Number of whole steps to run this frame. */
  steps(realDt: number): number {
    this.acc += clampDt(realDt, this.maxDt);
    let n = 0;
    while (this.acc >= this.h) {
      this.acc -= this.h;
      n += 1;
    }
    return n;
  }

  reset(): void {
    this.acc = 0;
  }
}
