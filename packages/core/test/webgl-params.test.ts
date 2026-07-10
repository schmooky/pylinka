import { describe, expect, it } from 'vitest';
import type { ParamDef, System } from '@pylinka/graph';
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
