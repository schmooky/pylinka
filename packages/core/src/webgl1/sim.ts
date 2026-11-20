/**
 * CPU particle simulation for hosts without transform feedback (WebGL1).
 *
 * This is a line-by-line port of the interpreted WebGL2 step shaders
 * (`updateVs` / `updateVsSub` in webgl/shaders.ts) to TypeScript: the same
 * 7-float state layout, the same cursor-window spawning, the same hashes, the
 * same force model and collider resolve. It reads the same `EngineParams`, so
 * an effect behaves the same way it does on the interpreted WebGL2 engine. It
 * does NOT run the compiled graph: node kinds outside `INTERPRETED_KINDS`
 * contribute nothing here, exactly as on the interpreted engine.
 *
 * State is double-buffered like the GPU version. A sub-emitter reads its
 * parent's current and previous buffers to find the birth/death edge, so the
 * parent must be stepped first in a frame.
 *
 * Steady-state `step()` allocates nothing.
 */
import type { EngineParams } from '../webgl/params.js';

/** Floats per particle: pos.xy, vel.xy, age, life, seed. Same as the GPU layout. */
export const CPU_STATE_FLOATS = 7;

/** Emitter-relative spawn offsets, one xy pair per entry (an emission mask). */
export interface CpuMask {
  points: Float32Array;
  count: number;
}

export interface CpuSimOptions {
  /** Sub-emitter parent: this sim spawns on the parent's particle births or deaths. */
  parent?: CpuSim;
  /** Emission mask point table. Ignored for a sub-emitter. */
  mask?: CpuMask;
}

const TAU = 6.2831853;
const MAX_FIELDS = 4;

/** GLSL `fract`. */
const fract = (x: number): number => x - Math.floor(x);

/** GLSL `hash11` from the step shaders. */
function hash11(p: number): number {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

/** GLSL `rnd`. */
const rnd = (s: number, k: number): number => hash11(s * 57.31 + k * 131.7 + 0.123);

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** GLSL `vnHash`. */
const vnHash = (ix: number, iy: number, t: number): number =>
  fract(Math.sin(ix * 127.1 + iy * 311.7 + t) * 43758.5453);

/** GLSL `vnoise`: value noise with a smoothstep blend. */
function vnoise(px: number, py: number, t: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = vnHash(ix, iy, t);
  const b = vnHash(ix + 1, iy, t);
  const c = vnHash(ix, iy + 1, t);
  const d = vnHash(ix + 1, iy + 1, t);
  return mix(mix(a, b, ux), mix(c, d, ux), uy);
}

/**
 * Per-step uniforms, resolved once per frame so the particle loop reads plain
 * numbers. Mirrors the uniform block the GPU engine uploads.
 */
interface Frame {
  dt: number;
  time: number;
  frame: number;
  ex: number;
  ey: number;
  /** gravity + wind, they always add */
  gx: number;
  gy: number;
  dragK: number;
  p: EngineParams;
}

export class CpuSim {
  /** Pool size. A sub-emitter's pool is parentCapacity × burstMax. */
  readonly capacity: number;
  /** Ping-pong state buffers, CPU_STATE_FLOATS per particle. */
  readonly bufs: [Float32Array, Float32Array];
  /** Index of the buffer that holds this frame's state. */
  cur = 0;

  private readonly parent: CpuSim | undefined;
  private readonly parentCap: number;
  private readonly burstMax: number;
  private readonly hasBurst: boolean;
  private readonly subOn: 'death' | 'birth';
  private readonly mask: CpuMask | undefined;

  private spawnBase = 0;
  private frame = 0;
  private time = 0;
  private readonly fr: Frame;

  constructor(params: EngineParams, opts: CpuSimOptions = {}) {
    this.parent = opts.parent;
    this.hasBurst = opts.parent !== undefined && params.deathBurst !== undefined;
    this.subOn = params.subOn;
    this.burstMax = opts.parent ? (params.deathBurst?.max ?? 1) : 1;
    this.parentCap = opts.parent ? opts.parent.capacity : params.capacity;
    this.capacity = opts.parent ? this.parentCap * this.burstMax : params.capacity;
    this.mask =
      opts.parent === undefined && opts.mask && opts.mask.count > 0 ? opts.mask : undefined;
    const n = this.capacity * CPU_STATE_FLOATS;
    this.bufs = [new Float32Array(n), new Float32Array(n)];
    this.fr = { dt: 0, time: 0, frame: 0, ex: 0, ey: 0, gx: 0, gy: 0, dragK: 1, p: params };
  }

  /** This frame's state. */
  get state(): Float32Array {
    return this.bufs[this.cur]!;
  }

  /** Last frame's state (a sub-emitter child reads it for the edge test). */
  get prevState(): Float32Array {
    return this.bufs[1 - this.cur]!;
  }

  /** Whether a burst count change in `params` would need a new pool. */
  fits(params: EngineParams): boolean {
    if (this.parent)
      return (
        (params.deathBurst?.max ?? 1) === this.burstMax &&
        (params.deathBurst !== undefined) === this.hasBurst
      );
    return params.capacity === this.capacity;
  }

  /** Zero both buffers and rewind the spawn cursor. */
  reset(): void {
    this.bufs[0].fill(0);
    this.bufs[1].fill(0);
    this.cur = 0;
    this.spawnBase = 0;
    this.frame = 0;
    this.time = 0;
  }

  /** Advance by dt, spawning `spawnCount` particles in the cursor window. */
  step(
    dt: number,
    spawnCount: number,
    emitter: readonly [number, number],
    wind: readonly [number, number],
    p: EngineParams,
  ): void {
    const fr = this.fr;
    fr.dt = dt;
    fr.time = this.time;
    fr.frame = this.frame;
    fr.ex = emitter[0];
    fr.ey = emitter[1];
    fr.gx = p.gravity[0] + wind[0];
    fr.gy = p.gravity[1] + wind[1];
    fr.dragK = Math.exp(-p.drag * dt);
    fr.p = p;

    const src = this.bufs[this.cur]!;
    const dst = this.bufs[1 - this.cur]!;
    if (this.parent) this.stepSub(src, dst);
    else this.stepRoot(src, dst, spawnCount);

    this.cur = 1 - this.cur;
    if (!this.parent) this.spawnBase = (this.spawnBase + spawnCount) % this.capacity;
    this.frame += 1;
    this.time += dt;
  }

  /** Alive count of the current state. */
  aliveCount(): number {
    const s = this.state;
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const o = i * CPU_STATE_FLOATS;
      if (s[o + 5]! > 0 && s[o + 4]! < s[o + 5]!) n++;
    }
    return n;
  }

  private stepRoot(src: Float32Array, dst: Float32Array, spawnCount: number): void {
    const { p } = this.fr;
    const cap = this.capacity;
    const mask = this.mask;
    for (let id = 0; id < cap; id++) {
      const o = id * CPU_STATE_FLOATS;
      const life = src[o + 5]!;
      const age = src[o + 4]!;
      const alive = life > 0 && age < life;
      // GLSL mod() on floats: the result is always in [0, cap)
      const rel = (((id - this.spawnBase + cap) % cap) + cap) % cap;
      if (!alive && rel < spawnCount) {
        const s = hash11(id * 7.77 + this.fr.frame * 3.13 + 1.0);
        let offX: number;
        let offY: number;
        if (mask) {
          const idx = clamp(Math.floor(rnd(s, 11.0) * mask.count), 0, mask.count - 1);
          offX = mask.points[idx * 2]!;
          offY = mask.points[idx * 2 + 1]!;
        } else {
          this.shapeOffset(s, rel / Math.max(spawnCount, 1));
          offX = OFF[0]!;
          offY = OFF[1]!;
        }
        dst[o] = this.fr.ex + offX;
        dst[o + 1] = this.fr.ey + offY;
        dst[o + 2] = mix(p.velMin[0], p.velMax[0], rnd(s, 3.0));
        dst[o + 3] = mix(p.velMin[1], p.velMax[1], rnd(s, 4.0));
        dst[o + 4] = 0;
        dst[o + 5] = mix(p.lifeMin, p.lifeMax, rnd(s, 5.0));
        dst[o + 6] = s;
        continue;
      }
      if (!alive) {
        copyDead(src, dst, o);
        continue;
      }
      this.integrate(src, dst, o);
    }
  }

  private stepSub(src: Float32Array, dst: Float32Array): void {
    const parent = this.parent!;
    const pCur = parent.state;
    const pPrev = parent.prevState;
    const { p } = this.fr;
    const db = p.deathBurst;
    const countMin = db?.countMin ?? 1;
    const countMax = db?.countMax ?? 1;
    const inherit = db?.inherit ?? 0;
    const onBirth = this.subOn === 'birth';
    const pc = this.parentCap;

    for (let k = 0; k < this.burstMax; k++) {
      for (let id = 0; id < pc; id++) {
        // child slot: burst region k, parent slot id
        const o = (k * pc + id) * CPU_STATE_FLOATS;
        const po = id * CPU_STATE_FLOATS;
        const life = src[o + 5]!;
        const age = src[o + 4]!;
        const alive = life > 0 && age < life;

        const prevAlive = pPrev[po + 5]! > 0 && pPrev[po + 4]! < pPrev[po + 5]!;
        const currAlive = pCur[po + 5]! > 0 && pCur[po + 4]! < pCur[po + 5]!;
        const fired = onBirth ? !prevAlive && currAlive : prevAlive && !currAlive;

        let doSpawn = fired;
        let burstN = 1;
        if (this.hasBurst) {
          const dseed = hash11(id * 3.19 + this.fr.frame * 7.53 + 5.0);
          burstN = Math.trunc(Math.max(Math.floor(mix(countMin, countMax, dseed) + 0.5), 0));
          doSpawn = fired && k < burstN;
        }

        if (doSpawn) {
          const s = hash11(
            id * 7.77 + this.fr.frame * 3.13 + (this.hasBurst ? k * 2.0 + 1.0 : 1.0),
          );
          this.shapeOffset(s, this.hasBurst ? k / Math.max(burstN, 1) : -1);
          dst[o] = pCur[po]! + OFF[0]!;
          dst[o + 1] = pCur[po + 1]! + OFF[1]!;
          dst[o + 2] =
            mix(p.velMin[0], p.velMax[0], rnd(s, 3.0)) +
            (this.hasBurst ? inherit * pCur[po + 2]! : 0);
          dst[o + 3] =
            mix(p.velMin[1], p.velMax[1], rnd(s, 4.0)) +
            (this.hasBurst ? inherit * pCur[po + 3]! : 0);
          dst[o + 4] = 0;
          dst[o + 5] = mix(p.lifeMin, p.lifeMax, rnd(s, 5.0));
          dst[o + 6] = s;
          continue;
        }
        if (!alive) {
          copyDead(src, dst, o);
          continue;
        }
        this.integrate(src, dst, o);
      }
    }
  }

  /** GLSL `shapeOffset`, written into OFF. */
  private shapeOffset(s: number, t: number): void {
    const p = this.fr.p;
    switch (p.shape) {
      case 1: {
        const a = TAU * rnd(s, 1.0);
        OFF[0] = Math.cos(a) * p.shapeRadius;
        OFF[1] = Math.sin(a) * p.shapeRadius;
        return;
      }
      case 2:
        OFF[0] = (rnd(s, 1.0) - 0.5) * p.shapeSize[0];
        OFF[1] = (rnd(s, 2.0) - 0.5) * p.shapeSize[1];
        return;
      case 3: {
        const a = TAU * rnd(s, 1.0);
        const r = mix(p.shapeA[0], p.shapeA[1], rnd(s, 9.0));
        OFF[0] = Math.cos(a) * r;
        OFF[1] = Math.sin(a) * r;
        return;
      }
      case 4: {
        const a = TAU * (t >= 0 ? t : rnd(s, 1.0));
        OFF[0] = Math.cos(a) * p.shapeRadius;
        OFF[1] = Math.sin(a) * p.shapeRadius;
        return;
      }
      case 5: {
        const u = rnd(s, 1.0);
        OFF[0] = mix(p.shapeA[0], p.shapeB[0], u);
        OFF[1] = mix(p.shapeA[1], p.shapeB[1], u);
        return;
      }
      default:
        OFF[0] = p.shapeA[0];
        OFF[1] = p.shapeA[1];
    }
  }

  /** Forces, drag, integration and colliders for one alive particle. */
  private integrate(src: Float32Array, dst: Float32Array, o: number): void {
    const fr = this.fr;
    const p = fr.p;
    const px = src[o]!;
    const py = src[o + 1]!;
    const vx = src[o + 2]!;
    const vy = src[o + 3]!;

    let fx = fr.gx;
    let fy = fr.gy;

    // pointForces: vortex swirl / radial pull
    const nf = Math.min(p.pointFields.length, MAX_FIELDS);
    for (let k = 0; k < nf; k++) {
      const e = p.pointFields[k]!;
      const cx = e.center[0] + (e.relative > 0.5 ? fr.ex : 0);
      const cy = e.center[1] + (e.relative > 0.5 ? fr.ey : 0);
      const dx = px - cx;
      const dy = py - cy;
      const len = Math.max(Math.hypot(dx, dy), 1e-3);
      const ux = dx / len;
      const uy = dy / len;
      const w = e.radius > 0 ? clamp(1 - len / e.radius, 0, 1) : 1;
      fx += (-uy * e.tangential - ux * e.pull) * w;
      fy += (ux * e.tangential - uy * e.pull) * w;
    }

    // turbForce: curl of value noise
    const tb = p.turbulence;
    if (tb[0] !== 0) {
      const cell = Math.max(tb[1], 1);
      const u = px / cell;
      const v = py / cell;
      const t = fr.time * tb[2];
      const e = 0.35;
      const nx0 = vnoise(u - e, v, t);
      const nx1 = vnoise(u + e, v, t);
      const ny0 = vnoise(u, v - e, t);
      const ny1 = vnoise(u, v + e, t);
      fx += ((ny1 - ny0) / (2 * e)) * tb[0];
      fy += (-(nx1 - nx0) / (2 * e)) * tb[0];
    }

    // obstacleForces
    const no = Math.min(p.obstacles.length, MAX_FIELDS);
    for (let k = 0; k < no; k++) {
      const b = p.obstacles[k]!;
      const dx = px - (b.center[0] + (b.relative > 0.5 ? fr.ex : 0));
      const dy = py - (b.center[1] + (b.relative > 0.5 ? fr.ey : 0));
      const len = Math.max(Math.hypot(dx, dy), 1e-3);
      const ux = dx / len;
      const uy = dy / len;
      const t = clamp(1 - len / Math.max(b.radius, 1e-3), 0, 1);
      const w = Math.pow(t, mix(3.0, 0.5, clamp(b.softness, 0, 1)));
      fx += (ux * b.strength - uy * b.swirl + (b.velocity[0] - vx) * b.carry) * w;
      fy += (uy * b.strength + ux * b.swirl + (b.velocity[1] - vy) * b.carry) * w;
    }

    let nvx = (vx + fx * fr.dt) * fr.dragK;
    let nvy = (vy + fy * fr.dt) * fr.dragK;
    let npx = px + nvx * fr.dt;
    let npy = py + nvy * fr.dt;

    const nc = Math.min(p.colliders.length, MAX_FIELDS);
    if (nc > 0) {
      POS[0] = npx;
      POS[1] = npy;
      VEL[0] = nvx;
      VEL[1] = nvy;
      for (let k = 0; k < nc; k++) resolveCollider(p.colliders[k]!, fr.ex, fr.ey);
      npx = POS[0];
      npy = POS[1];
      nvx = VEL[0];
      nvy = VEL[1];
    }

    dst[o] = npx;
    dst[o + 1] = npy;
    dst[o + 2] = nvx;
    dst[o + 3] = nvy;
    dst[o + 4] = src[o + 4]! + fr.dt;
    dst[o + 5] = src[o + 5]!;
    dst[o + 6] = src[o + 6]!;
  }
}

// Scratch shared by the hot loop. Single-threaded, so one set is enough.
const OFF = new Float64Array(2);
const POS = new Float64Array(2);
const VEL = new Float64Array(2);

function copyDead(src: Float32Array, dst: Float32Array, o: number): void {
  dst[o] = src[o]!;
  dst[o + 1] = src[o + 1]!;
  dst[o + 2] = src[o + 2]!;
  dst[o + 3] = src[o + 3]!;
  dst[o + 4] = src[o + 4]!;
  dst[o + 5] = 0;
  dst[o + 6] = src[o + 6]!;
}

/** GLSL `resolveColliders` body for one collider, on POS / VEL. */
function resolveCollider(c: EngineParams['colliders'][number], ex: number, ey: number): void {
  const kind = c.kind;
  const offX = c.relative > 0.5 ? ex : 0;
  const offY = c.relative > 0.5 ? ey : 0;
  const ax = c.a[0] + offX;
  const ay = c.a[1] + offY;
  const r = c.radius;
  // b is a POSITION for the rect (max corner) but a VELOCITY for the circle
  const bOff = kind > 1.5 && kind < 3.5;
  const bx = c.b[0] + (bOff ? offX : 0);
  const by = c.b[1] + (bOff ? offY : 0);
  const rest = c.restitution;
  const fric = c.friction;

  if (kind < 1.5) {
    const bl = Math.max(Math.hypot(bx, by), 1e-6);
    const nx = bx / bl;
    const ny = by / bl;
    const sd = (POS[0]! - ax) * nx + (POS[1]! - ay) * ny;
    if (sd < 0) {
      POS[0] = POS[0]! - nx * sd;
      POS[1] = POS[1]! - ny * sd;
      const vn = VEL[0]! * nx + VEL[1]! * ny;
      if (vn < 0) {
        const tx = VEL[0]! - nx * vn;
        const ty = VEL[1]! - ny * vn;
        VEL[0] = tx * (1 - fric) - nx * (vn * rest);
        VEL[1] = ty * (1 - fric) - ny * (vn * rest);
      }
    }
  } else if (kind < 2.5) {
    if (POS[0]! < ax) {
      POS[0] = ax;
      if (VEL[0]! < 0) {
        VEL[0] = -VEL[0]! * rest;
        VEL[1] = VEL[1]! * (1 - fric);
      }
    }
    if (POS[0]! > bx) {
      POS[0] = bx;
      if (VEL[0]! > 0) {
        VEL[0] = -VEL[0]! * rest;
        VEL[1] = VEL[1]! * (1 - fric);
      }
    }
    if (POS[1]! < ay) {
      POS[1] = ay;
      if (VEL[1]! < 0) {
        VEL[1] = -VEL[1]! * rest;
        VEL[0] = VEL[0]! * (1 - fric);
      }
    }
    if (POS[1]! > by) {
      POS[1] = by;
      if (VEL[1]! > 0) {
        VEL[1] = -VEL[1]! * rest;
        VEL[0] = VEL[0]! * (1 - fric);
      }
    }
  } else if (kind < 3.5) {
    const x = POS[0]!;
    const y = POS[1]!;
    if (x > ax && x < bx && y > ay && y < by) {
      const dl = x - ax;
      const dr = bx - x;
      const du = y - ay;
      const dd = by - y;
      const m = Math.min(dl, dr, du, dd);
      if (m === dl) {
        POS[0] = ax;
        VEL[0] = -Math.abs(VEL[0]!) * rest;
        VEL[1] = VEL[1]! * (1 - fric);
      } else if (m === dr) {
        POS[0] = bx;
        VEL[0] = Math.abs(VEL[0]!) * rest;
        VEL[1] = VEL[1]! * (1 - fric);
      } else if (m === du) {
        POS[1] = ay;
        VEL[1] = -Math.abs(VEL[1]!) * rest;
        VEL[0] = VEL[0]! * (1 - fric);
      } else {
        POS[1] = by;
        VEL[1] = Math.abs(VEL[1]!) * rest;
        VEL[0] = VEL[0]! * (1 - fric);
      }
    }
  } else {
    const inside = kind > 4.5;
    const dx = POS[0]! - ax;
    const dy = POS[1]! - ay;
    const len = Math.max(Math.hypot(dx, dy), 1e-4);
    if (inside ? len > r : len < r) {
      const nx = dx / len;
      const ny = dy / len;
      POS[0] = ax + nx * r;
      POS[1] = ay + ny * r;
      const rx = VEL[0]! - bx;
      const ry = VEL[1]! - by;
      const vn = rx * nx + ry * ny;
      if (inside ? vn > 0 : vn < 0) {
        const tx = rx - nx * vn;
        const ty = ry - ny * vn;
        VEL[0] = bx + tx * (1 - fric) - nx * (vn * rest);
        VEL[1] = by + ty * (1 - fric) - ny * (vn * rest);
      }
    }
  }
}
