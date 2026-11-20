/**
 * The WebGL1 backend runs the interpreted step on the CPU. These hold it to the
 * GPU step's rules: cursor-window spawning, the integration order, the
 * sub-emitter edge test and burst layout, and the collider resolve. The
 * render side is checked for GLSL ES 1.00 syntax and the uniform budget a
 * WebGL1 driver is guaranteed to give.
 */
import { describe, expect, it } from 'vitest';
import type { System } from '@pylinka/graph';
import { extractParams, type EngineParams } from '../src/webgl/params.js';
import { EASE_LUT_CHANNELS, EASE_LUT_N } from '../src/webgl/shaders.js';
import { CPU_STATE_FLOATS, CpuSim } from '../src/webgl1/sim.js';
import { compactAlive, packEaseLut } from '../src/webgl1/renderer.js';
import { CPU_RENDER_FS, CPU_RENDER_VS, DRAW_FLOATS } from '../src/webgl1/shaders.js';

const empty: System = {
  id: 's',
  name: 's',
  capacity: 8,
  blendMode: 'normal',
  enabled: true,
  space: 'world',
  emitter: { mode: 'flow', rate: 0 },
  graph: { nodes: [], edges: [] },
};

/** Defaults from an empty graph, then the fields a test cares about. */
function params(over: Partial<EngineParams> = {}): EngineParams {
  return {
    ...extractParams(empty, [], {}),
    shape: 0,
    shapeA: [0, 0],
    velMin: [0, 0],
    velMax: [0, 0],
    lifeMin: 1,
    lifeMax: 1,
    gravity: [0, 0],
    drag: 0,
    pointFields: [],
    turbulence: [0, 1, 0],
    obstacles: [],
    colliders: [],
    ...over,
  };
}

const NO_WIND = [0, 0] as const;
const at = (sim: CpuSim, i: number) => {
  const s = sim.state;
  const o = i * CPU_STATE_FLOATS;
  return {
    x: s[o]!,
    y: s[o + 1]!,
    vx: s[o + 2]!,
    vy: s[o + 3]!,
    age: s[o + 4]!,
    life: s[o + 5]!,
    seed: s[o + 6]!,
  };
};

describe('CpuSim — spawning', () => {
  it('spawns spawnCount particles at the emitter, in the cursor window', () => {
    const p = params({ capacity: 8, shapeA: [5, -5] });
    const sim = new CpuSim(p);
    sim.step(0.016, 3, [100, 50], NO_WIND, p);
    expect(sim.aliveCount()).toBe(3);
    for (let i = 0; i < 3; i++)
      expect(at(sim, i)).toMatchObject({ x: 105, y: 45, age: 0, life: 1 });
    expect(at(sim, 3).life).toBe(0);
  });

  it('advances and wraps the cursor, skipping slots that are still alive', () => {
    const p = params({ capacity: 4 });
    const sim = new CpuSim(p);
    sim.step(0.01, 3, [0, 0], NO_WIND, p); // slots 0..2
    sim.step(0.01, 3, [0, 0], NO_WIND, p); // window 3,0,1 → only 3 is free
    expect(sim.aliveCount()).toBe(4);
    expect(at(sim, 3).age).toBe(0);
    expect(at(sim, 0).age).toBeCloseTo(0.01);
  });

  it('kills a particle when its age reaches its life, and frees the slot', () => {
    const p = params({ capacity: 2, lifeMin: 0.05, lifeMax: 0.05 });
    const sim = new CpuSim(p);
    sim.step(0.03, 1, [0, 0], NO_WIND, p);
    sim.step(0.03, 0, [0, 0], NO_WIND, p);
    expect(sim.aliveCount()).toBe(1);
    sim.step(0.03, 0, [0, 0], NO_WIND, p);
    expect(sim.aliveCount()).toBe(0);
    // like the GPU step: the frame age passes life keeps life, the next one zeroes it
    sim.step(0.03, 0, [0, 0], NO_WIND, p);
    expect(at(sim, 0).life).toBe(0);
  });

  it('draws spawn offsets from the mask table instead of the shape', () => {
    const p = params({ capacity: 4, shape: 1, shapeRadius: 99 });
    const sim = new CpuSim(p, { mask: { points: new Float32Array([7, 8]), count: 1 } });
    sim.step(0.01, 2, [10, 10], NO_WIND, p);
    expect(at(sim, 0)).toMatchObject({ x: 17, y: 18 });
    expect(at(sim, 1)).toMatchObject({ x: 17, y: 18 });
  });

  it('lays a burst ring out evenly by window position', () => {
    const p = params({ capacity: 4, shape: 4, shapeRadius: 10 });
    const sim = new CpuSim(p);
    sim.step(0.01, 4, [0, 0], NO_WIND, p);
    const angles = [0, 1, 2, 3].map((i) => Math.atan2(at(sim, i).y, at(sim, i).x));
    expect(angles[0]).toBeCloseTo(0, 5);
    expect(angles[1]).toBeCloseTo(Math.PI / 2, 5);
    expect(Math.abs(angles[2]!)).toBeCloseTo(Math.PI, 5);
    expect(angles[3]).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('is deterministic: same frames, same state', () => {
    const p = params({
      capacity: 16,
      shape: 1,
      shapeRadius: 20,
      velMin: [-50, -50],
      velMax: [50, 50],
      lifeMin: 0.5,
      lifeMax: 2,
    });
    const a = new CpuSim(p);
    const b = new CpuSim(p);
    for (let f = 0; f < 10; f++) {
      a.step(0.016, 2, [0, 0], NO_WIND, p);
      b.step(0.016, 2, [0, 0], NO_WIND, p);
    }
    expect(Array.from(a.state)).toEqual(Array.from(b.state));
  });
});

describe('CpuSim — integration', () => {
  it('applies force, then drag, then moves by the new velocity (the GPU order)', () => {
    const p = params({ capacity: 1, velMin: [10, 0], velMax: [10, 0], gravity: [0, 100], drag: 2 });
    const sim = new CpuSim(p);
    sim.step(0.1, 1, [0, 0], NO_WIND, p); // spawn
    sim.step(0.1, 0, [0, 0], [5, 0], p);
    const k = Math.exp(-2 * 0.1);
    const vx = (10 + 5 * 0.1) * k;
    const vy = 100 * 0.1 * k;
    const q = at(sim, 0);
    expect(q.vx).toBeCloseTo(vx, 5);
    expect(q.vy).toBeCloseTo(vy, 5);
    expect(q.x).toBeCloseTo(vx * 0.1, 5);
    expect(q.y).toBeCloseTo(vy * 0.1, 5);
    expect(q.age).toBeCloseTo(0.1, 6);
  });

  it('pulls toward a radial field and swirls around a vortex', () => {
    const p = params({
      capacity: 1,
      shapeA: [10, 0],
      pointFields: [{ center: [0, 0], tangential: 50, pull: 100, radius: 0, relative: 1 }],
    });
    const sim = new CpuSim(p);
    sim.step(0.1, 1, [0, 0], NO_WIND, p);
    sim.step(0.1, 0, [0, 0], NO_WIND, p);
    const q = at(sim, 0);
    expect(q.vx).toBeCloseTo(-10, 5); // pull inward along -x
    expect(q.vy).toBeCloseTo(5, 5); // tangential is +90°
  });

  it('pushes a particle back above a floor plane and bounces it', () => {
    const p = params({
      capacity: 1,
      velMin: [0, 100],
      velMax: [0, 100],
      colliders: [
        { kind: 1, a: [0, 5], b: [0, -1], radius: 0, restitution: 0.5, friction: 0, relative: 0 },
      ],
    });
    const sim = new CpuSim(p);
    sim.step(0.1, 1, [0, 0], NO_WIND, p);
    sim.step(0.1, 0, [0, 0], NO_WIND, p); // would reach y = 10, past the floor at y = 5
    const q = at(sim, 0);
    expect(q.y).toBeCloseTo(5, 5);
    expect(q.vy).toBeCloseTo(-50, 5);
  });
});

describe('CpuSim — sub-emitters', () => {
  it('spawns a child in the parent slot on the frame the parent dies, at its position', () => {
    const pp = params({
      capacity: 2,
      velMin: [100, 0],
      velMax: [100, 0],
      lifeMin: 0.15,
      lifeMax: 0.15,
    });
    const cp = params({ capacity: 2, lifeMin: 1, lifeMax: 1 });
    const parent = new CpuSim(pp);
    const child = new CpuSim(cp, { parent });
    expect(child.capacity).toBe(2);
    const frame = (n: number) => {
      parent.step(0.1, n, [0, 0], NO_WIND, pp);
      child.step(0.1, 0, [0, 0], NO_WIND, cp);
    };
    frame(1);
    frame(0);
    expect(child.aliveCount()).toBe(0);
    frame(0); // parent age 0.2 ≥ 0.15: dies this frame
    expect(parent.aliveCount()).toBe(0);
    expect(child.aliveCount()).toBe(1);
    // the parent's last state is where it died; the child starts there
    expect(at(child, 0).x).toBeCloseTo(at(parent, 0).x, 5);
    frame(0);
    expect(child.aliveCount()).toBe(1); // fires once, on the edge only
  });

  it('fires on birth when the params say so', () => {
    const pp = params({ capacity: 2 });
    const cp = params({ capacity: 2, subOn: 'birth' });
    const parent = new CpuSim(pp);
    const child = new CpuSim(cp, { parent });
    parent.step(0.1, 2, [3, 4], NO_WIND, pp);
    child.step(0.1, 0, [0, 0], NO_WIND, cp);
    expect(child.aliveCount()).toBe(2);
    expect(at(child, 1)).toMatchObject({ x: 3, y: 4 });
  });

  it('lays a death burst out in max regions and spawns count copies per event', () => {
    const pp = params({ capacity: 3 });
    const cp = params({
      deathBurst: { max: 4, countMin: 2, countMax: 2, inherit: 0, on: 'birth' },
      subOn: 'birth',
    });
    const parent = new CpuSim(pp);
    const child = new CpuSim(cp, { parent });
    expect(child.capacity).toBe(12);
    parent.step(0.1, 1, [0, 0], NO_WIND, pp);
    child.step(0.1, 0, [0, 0], NO_WIND, cp);
    expect(child.aliveCount()).toBe(2);
    // copy k of parent slot 0 sits at k * parentCap
    expect(at(child, 0).life).toBeGreaterThan(0);
    expect(at(child, 3).life).toBeGreaterThan(0);
    expect(at(child, 6).life).toBe(0);
  });

  it('reports when a params change needs a new pool', () => {
    const p = params({ capacity: 8 });
    const sim = new CpuSim(p);
    expect(sim.fits(p)).toBe(true);
    expect(sim.fits({ ...p, capacity: 16 })).toBe(false);
  });
});

describe('WebGL1 render side', () => {
  it('compacts alive particles into the draw layout', () => {
    const p = params({ capacity: 4, lifeMin: 2, lifeMax: 2 });
    const sim = new CpuSim(p);
    sim.step(0.01, 1, [1, 2], NO_WIND, p);
    sim.step(0.01, 0, [1, 2], NO_WIND, p);
    sim.step(0.01, 1, [1, 2], NO_WIND, p);
    const out = new Float32Array(4 * DRAW_FLOATS);
    expect(compactAlive(sim.state, 4, out)).toBe(2);
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(2);
    expect(out[3]).toBe(2); // life
  });

  it('repacks the channel-major ease LUT into one vec4 per sample', () => {
    const lut = Array.from({ length: EASE_LUT_N * EASE_LUT_CHANNELS }, (_, i) => i);
    const out = new Float32Array(EASE_LUT_N * 4);
    packEaseLut(lut, out);
    expect(Array.from(out.subarray(0, 4))).toEqual([0, EASE_LUT_N, 2 * EASE_LUT_N, 3 * EASE_LUT_N]);
    expect(out[5]).toBe(EASE_LUT_N + 1);
  });

  it('is GLSL ES 1.00 — none of the 3.00 constructs', () => {
    for (const src of [CPU_RENDER_VS, CPU_RENDER_FS]) {
      expect(src).not.toMatch(/#version/);
      expect(src).not.toMatch(
        /\btexelFetch\b|\btexture\(|\blayout\s*\(|\bflat\b|gl_VertexID|gl_InstanceID/,
      );
      expect(src).not.toMatch(/^\s*(in|out)\s/m);
    }
    expect(CPU_RENDER_FS).toContain('gl_FragColor');
  });

  it('fits the 128 vertex uniform vectors WebGL1 guarantees', () => {
    // every declaration costs at least one vec4 slot; arrays cost one per element
    let slots = 0;
    for (const m of CPU_RENDER_VS.matchAll(/^uniform\s+(?:\w+\s+)?(\w+)\s+\w+(?:\[(\d+)\])?;/gm)) {
      slots += m[2] !== undefined ? Number(m[2]) : 1;
    }
    expect(slots).toBeGreaterThan(30);
    expect(slots).toBeLessThanOrEqual(128);
  });
});
