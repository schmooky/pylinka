import { describe, expect, it } from 'vitest';
import type { Node, ParamDef, System } from '@pylinka/graph';
import { extractParams, parseColor } from '../src/webgl/params.js';

describe('parseColor', () => {
  it('parses #rrggbbaa to 0..1', () => {
    expect(parseColor({ t: 'color', v: '#ff8800ff' }, [0, 0, 0, 0])).toEqual([1, 0x88 / 255, 0, 1]);
    expect(parseColor({ t: 'color', v: '#00000000' }, [1, 1, 1, 1])).toEqual([0, 0, 0, 0]);
  });
  it('falls back on non-color', () => {
    expect(parseColor({ t: 'f32', v: 3 }, [0.5, 0.5, 0.5, 1])).toEqual([0.5, 0.5, 0.5, 1]);
  });
});

describe('extractParams — graph → engine params', () => {
  const params: ParamDef[] = [
    { id: 'p1', name: 'windPower', type: 'f32', min: 0, max: 200, scale: 'linear', default: { t: 'f32', v: 15 } },
    { id: 'p2', name: 'windDir', type: 'f32', scale: 'linear', default: { t: 'f32', v: 0 } },
  ];
  const system: System = {
    id: 's1', name: 'sparks', capacity: 4096, blendMode: 'add', enabled: true, space: 'world',
    emitter: { mode: 'flow', rate: 200, rateOverDistance: 0.8 },
    graph: {
      nodes: [
        { id: 'n1', kind: 'shape.circle', values: { radius: { t: 'f32', v: 25 } } },
        { id: 'n2', kind: 'output.spawnPosition' },
        { id: 'n3', kind: 'gen.randomRange', values: { min: { t: 'f32', v: 0.5 }, max: { t: 'f32', v: 1.2 } } },
        { id: 'n4', kind: 'output.initLife' },
        { id: 'n5', kind: 'gen.randomVec2', values: { min: { t: 'vec2', v: [-30, -80] }, max: { t: 'vec2', v: [30, -160] } } },
        { id: 'n6', kind: 'output.initVelocity' },
        { id: 'n7', kind: 'field.gravity', values: { g: { t: 'vec2', v: [0, 300] } } },
        { id: 'n8', kind: 'output.addForce' },
        { id: 'n9', kind: 'param.ref', structural: { param: 'p1' } },
        { id: 'n10', kind: 'param.ref', structural: { param: 'p2' } },
        { id: 'n11', kind: 'field.directional' },
        { id: 'n12', kind: 'output.addForce' },
        { id: 'n13', kind: 'gen.colorOverLife', structural: { ease: 'power2.out' }, values: { from: { t: 'color', v: '#ffffffff' }, to: { t: 'color', v: '#ff000000' } } },
        { id: 'n14', kind: 'output.writeColor' },
      ],
      edges: [
        { id: 'e1', from: { nodeId: 'n1', portId: 'pos' }, to: { nodeId: 'n2', portId: 'pos' } },
        { id: 'e2', from: { nodeId: 'n3', portId: 'out' }, to: { nodeId: 'n4', portId: 'life' } },
        { id: 'e3', from: { nodeId: 'n5', portId: 'out' }, to: { nodeId: 'n6', portId: 'vel' } },
        { id: 'e4', from: { nodeId: 'n7', portId: 'force' }, to: { nodeId: 'n8', portId: 'force' } },
        { id: 'e5', from: { nodeId: 'n9', portId: 'out' }, to: { nodeId: 'n11', portId: 'strength' } },
        { id: 'e6', from: { nodeId: 'n10', portId: 'out' }, to: { nodeId: 'n11', portId: 'angle' } },
        { id: 'e7', from: { nodeId: 'n11', portId: 'force' }, to: { nodeId: 'n12', portId: 'force' } },
        { id: 'e8', from: { nodeId: 'n13', portId: 'out' }, to: { nodeId: 'n14', portId: 'color' } },
      ],
    },
  };

  it('maps shape, velocity, life, gravity, colour, and the wind knob', () => {
    const p = extractParams(system, params, { windPower: 15, windDir: 0 });
    expect(p.capacity).toBe(4096);
    expect(p.blend).toBe('add');
    expect(p.shape).toBe(1); // circle
    expect(p.shapeRadius).toBe(25);
    expect(p.velMin).toEqual([-30, -80]);
    expect(p.velMax).toEqual([30, -160]);
    expect(p.lifeMin).toBe(0.5);
    expect(p.lifeMax).toBe(1.2);
    expect(p.gravity).toEqual([0, 300]);
    expect(p.colorFrom).toEqual([1, 1, 1, 1]);
    expect(p.colorEase).toBe(4); // power2.out
    // wind driven by knob p1 (windPower), current value 15
    expect(p.windPowerKnob).toBe('windPower');
    expect(p.windPower).toBe(15);
    expect(p.windDirKnob).toBe('windDir');
  });
});

describe('extractParams — interaction nodes', () => {
  /** A cursor knob drives the obstacle centre; the disc collider tracks it too. */
  const cursorParams: ParamDef[] = [
    { id: 'p1', name: 'cursor', type: 'vec2', scale: 'linear', default: { t: 'vec2', v: [0, 0] } },
  ];
  const system: System = {
    id: 's1', name: 'field', capacity: 4096, blendMode: 'add', enabled: true, space: 'world',
    emitter: { mode: 'flow', rate: 200 },
    graph: {
      nodes: [
        { id: 'n1', kind: 'shape.rectangle', values: { size: { t: 'vec2', v: [800, 600] } } },
        { id: 'n2', kind: 'output.spawnPosition' },
        { id: 'n3', kind: 'output.initLife', values: { life: { t: 'f32', v: 6 } } },
        {
          id: 'n4',
          kind: 'field.obstacle',
          knobBindings: { center: 'p1' },
          values: {
            center: { t: 'vec2', v: [0, 0] },
            velocity: { t: 'vec2', v: [300, -50] },
            radius: { t: 'f32', v: 160 },
            strength: { t: 'f32', v: 1800 },
            softness: { t: 'f32', v: 0.7 },
            swirl: { t: 'f32', v: 500 },
            carry: { t: 'f32', v: 2 },
          },
        },
        { id: 'n5', kind: 'output.addForce' },
        {
          id: 'n6',
          kind: 'output.collidePlane',
          values: {
            point: { t: 'vec2', v: [0, 520] },
            normal: { t: 'vec2', v: [0, -1] },
            restitution: { t: 'f32', v: 0.35 },
            friction: { t: 'f32', v: 0.2 },
          },
        },
        {
          id: 'n7',
          kind: 'output.collideRect',
          structural: { mode: 'outside' },
          values: { min: { t: 'vec2', v: [100, 100] }, max: { t: 'vec2', v: [260, 300] } },
        },
        {
          id: 'n8',
          kind: 'output.collideCircle',
          knobBindings: { center: 'p1' },
          values: { center: { t: 'vec2', v: [0, 0] }, radius: { t: 'f32', v: 90 } },
        },
      ],
      edges: [
        { id: 'e1', from: { nodeId: 'n1', portId: 'pos' }, to: { nodeId: 'n2', portId: 'pos' } },
        { id: 'e2', from: { nodeId: 'n4', portId: 'force' }, to: { nodeId: 'n5', portId: 'force' } },
      ],
    },
  };

  it('extracts an obstacle with its wake terms', () => {
    const p = extractParams(system, cursorParams, {});
    expect(p.obstacles).toHaveLength(1);
    expect(p.obstacles[0]).toMatchObject({
      velocity: [300, -50],
      radius: 160,
      strength: 1800,
      softness: 0.7,
      swirl: 500,
      carry: 2,
    });
  });

  it('a live vec2 knob moves the obstacle and the disc collider', () => {
    const p = extractParams(system, cursorParams, { cursor: [640, 210] });
    expect(p.obstacles[0]!.center).toEqual([640, 210]);
    expect(p.colliders.find((c) => c.kind === 4)!.a).toEqual([640, 210]);
  });

  it('maps each collider kind, defaulting rect mode from the structural param', () => {
    const p = extractParams(system, cursorParams, {});
    expect(p.colliders.map((c) => c.kind)).toEqual([1, 3, 4]);
    const plane = p.colliders[0]!;
    expect(plane.a).toEqual([0, 520]);
    expect(plane.b).toEqual([0, -1]);
    expect(plane.restitution).toBe(0.35);
    expect(plane.friction).toBe(0.2);
    // unset ports fall back to the schema defaults
    expect(p.colliders[1]!.restitution).toBe(0.45);
    expect(p.colliders[2]!.radius).toBe(90);
  });
});

describe('extractParams — custom ease curves on the interpreted backend', () => {
  const CURVE = 'curve(0,0,0,0,0.2,0.5;0.6,0.9,-0.2,0,0.2,0;1,0.1,-0.3,0.2,0,0)';

  const sys = (nodes: System['graph']['nodes'], edges: System['graph']['edges'] = []): System => ({
    id: 's1', name: 's', capacity: 256, blendMode: 'normal', enabled: true, space: 'world',
    emitter: { mode: 'flow', rate: 10 },
    graph: { nodes, edges },
  });

  it('keeps a preset on the analytic path (no LUT)', () => {
    const p = extractParams(
      sys([{ id: 'a', kind: 'gen.scaleOverLife', structural: { ease: 'sine.out' }, values: {} }]),
      [], {},
    );
    expect(p.sizeEase).toBe(6); // EASE_INDEX['sine.out']
  });

  it('bakes a multi-keyframe curve into the LUT and flags it with -1', () => {
    const p = extractParams(
      sys([{ id: 'a', kind: 'gen.scaleOverLife', structural: { ease: CURVE }, values: {} }]),
      [], {},
    );
    expect(p.sizeEase).toBe(-1);
    const lut = p.easeLut.slice(0, 32); // channel 0 = size
    expect(lut[0]).toBeCloseTo(0, 5);
    expect(lut[31]).toBeCloseTo(0.1, 3); // last keyframe's y
    // the curve peaks in the middle — an identity ramp never would
    expect(Math.max(...lut)).toBeGreaterThan(0.85);
    // untouched channels stay the identity ramp
    expect(p.easeLut.slice(32, 64)[31]).toBeCloseTo(1, 5);
  });

  it('a cubic-bezier also reaches the LUT (it used to render as linear)', () => {
    const p = extractParams(
      sys([{ id: 'a', kind: 'gen.colorOverLife', structural: { ease: 'cubic-bezier(0.9,0,1,0.2)' }, values: {} }]),
      [], {},
    );
    expect(p.colorEase).toBe(-1);
    const lut = p.easeLut.slice(32, 64);
    expect(lut[16]).toBeLessThan(0.25); // heavily eased-in: still low at t=0.5
  });

  it('picks up gen.alphaOverLife', () => {
    const p = extractParams(
      sys([{ id: 'a', kind: 'gen.alphaOverLife', structural: { ease: 'power2.out' }, values: { from: { t: 'f32', v: 0.8 }, to: { t: 'f32', v: 0 } } }]),
      [], {},
    );
    expect(p.alphaFrom).toBe(0.8);
    expect(p.alphaTo).toBe(0);
    expect(p.alphaEase).toBe(4);
  });

  it('defaults the alpha ramp to a no-op when the graph has none', () => {
    const p = extractParams(sys([{ id: 'a', kind: 'output.writeAlpha' }]), [], {});
    expect(p.alphaFrom).toBe(1);
    expect(p.alphaTo).toBe(1);
  });

  it('follows a gen.numberOverLife wired into output.writeAlpha', () => {
    const p = extractParams(
      sys(
        [
          { id: 'g', kind: 'gen.numberOverLife', structural: { ease: 'sine.in' }, values: { from: { t: 'f32', v: 0.25 }, to: { t: 'f32', v: 1 } } },
          { id: 'w', kind: 'output.writeAlpha' },
        ],
        [{ id: 'e1', from: { nodeId: 'g', portId: 'out' }, to: { nodeId: 'w', portId: 'alpha' } }],
      ),
      [], {},
    );
    expect(p.alphaFrom).toBe(0.25);
    expect(p.alphaTo).toBe(1);
    expect(p.alphaEase).toBe(5);
  });
});

describe('extractParams — rotation', () => {
  const sys = (nodes: System['graph']['nodes'], edges: System['graph']['edges'] = []): System => ({
    id: 's1', name: 's', capacity: 256, blendMode: 'normal', enabled: true, space: 'world',
    emitter: { mode: 'flow', rate: 10 },
    graph: { nodes, edges },
  });

  it('defaults to no rotation at all', () => {
    const p = extractParams(sys([{ id: 'a', kind: 'output.writeRotation' }]), [], {});
    expect(p.rotStart).toEqual([0, 0]);
    expect(p.spin).toEqual([0, 0]);
    expect(p.rotFrom).toBe(0);
    expect(p.rotTo).toBe(0);
  });

  it('reads a constant birth angle off output.initRotation', () => {
    const p = extractParams(
      sys([{ id: 'r', kind: 'output.initRotation', values: { rot: { t: 'f32', v: 0.75 } } }]),
      [], {},
    );
    expect(p.rotStart).toEqual([0.75, 0.75]);
  });

  it('reads a random birth angle off the gen.randomRange behind it', () => {
    const p = extractParams(
      sys(
        [
          { id: 'g', kind: 'gen.randomRange', values: { min: { t: 'f32', v: -1 }, max: { t: 'f32', v: 2 } } },
          { id: 'r', kind: 'output.initRotation' },
        ],
        [{ id: 'e1', from: { nodeId: 'g', portId: 'out' }, to: { nodeId: 'r', portId: 'rot' } }],
      ),
      [], {},
    );
    expect(p.rotStart).toEqual([-1, 2]);
  });

  it('converts degrees through a math.radians hop', () => {
    const p = extractParams(
      sys(
        [
          { id: 'g', kind: 'gen.randomRange', values: { min: { t: 'f32', v: 0 }, max: { t: 'f32', v: 360 } } },
          { id: 'd', kind: 'math.radians' },
          { id: 'r', kind: 'output.initRotation' },
        ],
        [
          { id: 'e1', from: { nodeId: 'g', portId: 'out' }, to: { nodeId: 'd', portId: 'degrees' } },
          { id: 'e2', from: { nodeId: 'd', portId: 'out' }, to: { nodeId: 'r', portId: 'rot' } },
        ],
      ),
      [], {},
    );
    expect(p.rotStart[0]).toBe(0);
    expect(p.rotStart[1]).toBeCloseTo(Math.PI * 2, 6);
  });

  it('reads gen.spin as an angular-velocity range', () => {
    const p = extractParams(
      sys(
        [
          { id: 'g', kind: 'gen.randomRange', values: { min: { t: 'f32', v: -6 }, max: { t: 'f32', v: 6 } } },
          { id: 's', kind: 'gen.spin' },
        ],
        [{ id: 'e1', from: { nodeId: 'g', portId: 'out' }, to: { nodeId: 's', portId: 'rate' } }],
      ),
      [], {},
    );
    expect(p.spin).toEqual([-6, 6]);
  });

  it('a bare gen.spin spins at its own literal rate', () => {
    const p = extractParams(
      sys([{ id: 's', kind: 'gen.spin', values: { rate: { t: 'f32', v: 2 } } }]),
      [], {},
    );
    expect(p.spin).toEqual([2, 2]);
  });

  it('reads gen.rotationOverLife as an eased ramp', () => {
    const p = extractParams(
      sys([
        {
          id: 'g',
          kind: 'gen.rotationOverLife',
          structural: { ease: 'power2.out' },
          values: { from: { t: 'f32', v: 0 }, to: { t: 'f32', v: 1.5 } },
        },
      ]),
      [], {},
    );
    expect(p.rotFrom).toBe(0);
    expect(p.rotTo).toBe(1.5);
    expect(p.rotEase).toBe(4); // EASE_INDEX['power2.out']
  });

  it('follows a gen.numberOverLife wired into output.writeRotation', () => {
    const p = extractParams(
      sys(
        [
          { id: 'g', kind: 'gen.numberOverLife', values: { from: { t: 'f32', v: 0 }, to: { t: 'f32', v: 3 } } },
          { id: 'w', kind: 'output.writeRotation' },
        ],
        [{ id: 'e1', from: { nodeId: 'g', portId: 'out' }, to: { nodeId: 'w', portId: 'rot' } }],
      ),
      [], {},
    );
    expect(p.rotTo).toBe(3);
  });

  it('bakes a custom rotation curve into its own LUT channel', () => {
    const p = extractParams(
      sys([
        { id: 'g', kind: 'gen.rotationOverLife', structural: { ease: 'cubic-bezier(0.9,0,1,0.2)' }, values: {} },
      ]),
      [], {},
    );
    expect(p.rotEase).toBe(-1);
    // channel 3 of 4 — the alpha channel above it must stay the identity ramp
    expect(p.easeLut).toHaveLength(32 * 4);
    expect(p.easeLut.slice(96, 128)[16]).toBeLessThan(0.25);
    expect(p.easeLut.slice(64, 96)[16]).toBeCloseTo(16 / 31, 6);
  });
});

/**
 * A node that is not there must not do anything.
 *
 * These defaults were a preset, not a neutral state: with no
 * `output.initVelocity` every particle was born moving 60-120 px/s UPWARD, and
 * with no `output.writeScale` it shrank from 8px to nothing over its life. Both
 * showed up as motion with no node in the graph to explain it and no way to
 * switch it off — and the compiled backend disagreed, spawning at rest
 * (`o_initVel = vec2f(0.0)`) and keeping the size it was born with
 * (`var outSize = rnd[slot].size`). Same graph, two answers.
 */
describe('extractParams — an absent output writes nothing', () => {
  const bare: System = {
    id: 's1', name: 'bare', capacity: 100, blendMode: 'add', enabled: true, space: 'world',
    emitter: { mode: 'flow', rate: 10 },
    graph: {
      nodes: [
        { id: 'n1', kind: 'shape.point' },
        { id: 'n2', kind: 'output.spawnPosition' },
        { id: 'n3', kind: 'output.initLife', values: { life: { t: 'f32', v: 1 } } },
      ],
      edges: [{ id: 'e1', from: { nodeId: 'n1', portId: 'pos' }, to: { nodeId: 'n2', portId: 'pos' } }],
    },
  };

  it('spawns at rest with no output.initVelocity', () => {
    const p = extractParams(bare, [], {});
    expect(p.velMin).toEqual([0, 0]);
    expect(p.velMax).toEqual([0, 0]);
  });

  it('holds size and colour with no write node', () => {
    const p = extractParams(bare, [], {});
    expect(p.sizeTo).toBe(p.sizeFrom);
    expect(p.colorTo).toEqual(p.colorFrom);
  });
});

/**
 * The velocity port, when a `gen.randomVec2` is NOT what is behind it. Only
 * that one node kind used to be read, so a velocity typed into the port, or a
 * knob bound to it, was silently ignored and the preset applied instead.
 */
describe('extractParams — velocity that is not a random range', () => {
  const withLiteral: System = {
    id: 's1', name: 'literal', capacity: 100, blendMode: 'add', enabled: true, space: 'world',
    emitter: { mode: 'flow', rate: 10 },
    graph: {
      nodes: [
        { id: 'n1', kind: 'shape.point' },
        { id: 'n2', kind: 'output.spawnPosition' },
        { id: 'n3', kind: 'output.initLife', values: { life: { t: 'f32', v: 1 } } },
        { id: 'n4', kind: 'output.initVelocity', values: { vel: { t: 'vec2', v: [12, 34] } } },
      ],
      edges: [{ id: 'e1', from: { nodeId: 'n1', portId: 'pos' }, to: { nodeId: 'n2', portId: 'pos' } }],
    },
  };

  it('uses the port literal, as one exact velocity', () => {
    const p = extractParams(withLiteral, [], {});
    expect(p.velMin).toEqual([12, 34]);
    expect(p.velMax).toEqual([12, 34]);
  });

  it('follows a knob bound to the port', () => {
    const knobbed = structuredClone(withLiteral);
    // knobBindings hold the knob's ID; its NAME is what the live value map uses
    knobbed.graph.nodes[3]!.knobBindings = { vel: 'p1' };
    const p = extractParams(
      knobbed,
      [{ id: 'p1', name: 'launch', type: 'vec2', scale: 'linear', default: { t: 'vec2', v: [0, 0] } }],
      { launch: [5, -9] },
    );
    expect(p.velMin).toEqual([5, -9]);
    expect(p.velMax).toEqual([5, -9]);
  });
});

/**
 * Fields are found BY KIND, not by following wires — this backend drives a
 * fixed set of uniforms rather than evaluating the graph. Two things followed
 * from that and both were wrong: a field node sitting unconnected on the canvas
 * still pulled on the whole effect (so deleting the `output.addForce` it fed
 * changed nothing), and a second node of the same kind REPLACED the first
 * instead of adding to it, though `output.addForce` and `output.drag` are
 * accumulating outputs the compiler emits as `force +=` and `dragK +=`.
 */
describe('extractParams — fields, wiring and accumulation', () => {
  const grav = (id: string, y: number): Node => ({ id, kind: 'field.gravity', values: { g: { t: 'vec2', v: [0, y] } } });
  const life: Node = { id: 'life', kind: 'output.initLife', values: { life: { t: 'f32', v: 1 } } };
  const addForce: Node = { id: 'af', kind: 'output.addForce' };
  const wire = (from: string): System['graph']['edges'][number] => ({
    id: `e-${from}`, from: { nodeId: from, portId: 'force' }, to: { nodeId: 'af', portId: 'force' },
  });
  const sys = (nodes: Node[], edges: System['graph']['edges'] = []): System => ({
    id: 's1', name: 'f', capacity: 100, blendMode: 'add', enabled: true, space: 'world',
    emitter: { mode: 'flow', rate: 10 }, graph: { nodes, edges },
  });

  it('ignores a field that is wired to nothing', () => {
    const p = extractParams(sys([life, grav('g1', 999)]), [], {});
    expect(p.gravity).toEqual([0, 0]);
  });

  it('applies one that is wired', () => {
    const p = extractParams(sys([life, addForce, grav('g1', 340)], [wire('g1')]), [], {});
    expect(p.gravity).toEqual([0, 340]);
  });

  it('adds two gravities together rather than keeping the last', () => {
    const p = extractParams(sys([life, addForce, grav('g1', 100), grav('g2', 7)], [wire('g1'), wire('g2')]), [], {});
    expect(p.gravity).toEqual([0, 107]);
  });

  it('adds two drags together', () => {
    const drag = (id: string, c: number): Node => ({ id, kind: 'field.drag', values: { coefficient: { t: 'f32', v: c } } });
    const toDrag = (from: string): System['graph']['edges'][number] => ({
      id: `e-${from}`, from: { nodeId: from, portId: 'drag' }, to: { nodeId: 'od', portId: 'drag' },
    });
    const p = extractParams(
      sys([life, { id: 'od', kind: 'output.drag' }, drag('d1', 2), drag('d2', 3)], [toDrag('d1'), toDrag('d2')]),
      [], {},
    );
    expect(p.drag).toBe(5);
  });

  it('follows a knob bound to gravity', () => {
    const g: Node = { id: 'g1', kind: 'field.gravity', knobBindings: { g: 'p1' } };
    const p = extractParams(
      sys([life, addForce, g], [wire('g1')]),
      [{ id: 'p1', name: 'grav', type: 'vec2', scale: 'linear', default: { t: 'vec2', v: [0, 0] } }],
      { grav: [0, 500] },
    );
    expect(p.gravity).toEqual([0, 500]);
  });
});

/**
 * Lifetime, when a `gen.randomRange` is not what is behind the port. The
 * fallback branch read the port's raw literal and nothing else, so a lifetime
 * driven by a knob landed on the 1-1.5s default with the knob ignored.
 */
describe('extractParams — lifetime from a knob', () => {
  it('reads the knob rather than the default range', () => {
    const s: System = {
      id: 's1', name: 'ttl', capacity: 100, blendMode: 'add', enabled: true, space: 'world',
      emitter: { mode: 'flow', rate: 10 },
      graph: { nodes: [{ id: 'n3', kind: 'output.initLife', knobBindings: { life: 'p1' } }], edges: [] },
    };
    const p = extractParams(
      s,
      [{ id: 'p1', name: 'ttl', type: 'f32', min: 0, max: 10, scale: 'linear', default: { t: 'f32', v: 1 } }],
      { ttl: 4 },
    );
    expect(p.lifeMin).toBe(4);
    expect(p.lifeMax).toBe(4);
  });
});
