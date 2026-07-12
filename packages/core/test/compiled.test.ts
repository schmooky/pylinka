import { describe, expect, it } from 'vitest';
import type { ParamDef, System, UniformLayout } from '@pylinka/graph';
import { KnobStore } from '../src/knobs.js';
import { SystemClock } from '../src/compiled/emitter.js';
import { pcg, ValueTable, writeHexColor, writeLiteral } from '../src/compiled/staging.js';

describe('compiled staging — value table (§12.2, §13.3)', () => {
  const layout: UniformLayout = {
    slotCount: 4,
    systemUniformsSize: 48,
    entries: [
      { slot: 0, type: 'vec2', origin: { kind: 'nodeValue', nodeId: 'n1', portId: 'offset' } },
      { slot: 1, type: 'color', origin: { kind: 'nodeValue', nodeId: 'n13', portId: 'from' } },
      { slot: 2, type: 'f32', origin: { kind: 'knob', paramId: 'p1' } },
      { slot: 3, type: 'f32', origin: { kind: 'nodeValue', nodeId: 'n3', portId: 'min' } },
    ],
  };
  const params: ParamDef[] = [
    { id: 'p1', name: 'windPower', type: 'f32', scale: 'linear', default: { t: 'f32', v: 10 } },
  ];
  const system = {
    graph: {
      nodes: [
        { id: 'n1', kind: 'shape.point', values: { offset: { t: 'vec2', v: [3, 4] } } },
        { id: 'n13', kind: 'gen.colorOverLife', values: { from: { t: 'color', v: '#ff800080' } } },
        { id: 'n3', kind: 'gen.randomRange', values: { min: { t: 'f32', v: 0.5 } } },
      ],
      edges: [],
    },
  } as unknown as System;

  it('fills node-value slots from the graph and knob slots from the store', () => {
    const vt = new ValueTable(layout, params);
    vt.refreshNodeValues(system);
    const knobs = new KnobStore(params);
    vt.refreshKnobs(knobs);
    expect([...vt.data.slice(0, 2)]).toEqual([3, 4]);
    expect(vt.data[4]).toBeCloseTo(1); // #ff
    expect(vt.data[5]).toBeCloseTo(128 / 255);
    expect(vt.data[7]).toBeCloseTo(128 / 255);
    expect(vt.data[8]).toBe(10); // knob default
    expect(vt.data[12]).toBeCloseTo(0.5);

    knobs.set('windPower', 42);
    vt.refreshKnobs(knobs);
    expect(vt.data[8]).toBe(42); // live, no re-read of the graph
  });

  it('writeLiteral covers every Literal type', () => {
    const out = new Float32Array(4);
    writeLiteral({ t: 'bool', v: true }, out, 0);
    expect(out[0]).toBe(1);
    writeLiteral({ t: 'vec4', v: [1, 2, 3, 4] }, out, 0);
    expect([...out]).toEqual([1, 2, 3, 4]);
    writeHexColor('#00000000', out, 0);
    expect([...out]).toEqual([0, 0, 0, 0]);
  });
});

describe('compiled clock (§13.4, §13.7, §13.11)', () => {
  it('advances the seed with pcg and tracks prev emitter position', () => {
    const clock = new SystemClock({ mode: 'flow', rate: 60 }, 100, 10, 20, 1234);
    const s0 = clock.baseSeed;
    clock.tick(1 / 60);
    expect(clock.baseSeed).toBe(pcg(s0));
    expect(clock.spawnCount).toBe(1);
    clock.ex = 40;
    expect(clock.velX(0.5)).toBeCloseTo((40 - 10) / 0.5);
    clock.endFrame(1 / 60);
    expect(clock.px).toBe(40);
    expect(clock.frame).toBe(1);
  });

  it('pcg matches uint32 semantics (deterministic, wraps)', () => {
    expect(pcg(0)).toBe(pcg(0));
    expect(pcg(0)).not.toBe(pcg(1));
    for (const v of [0, 1, 0xffffffff, 0x80000000]) {
      const r = pcg(v);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(r)).toBe(true);
    }
  });
});
