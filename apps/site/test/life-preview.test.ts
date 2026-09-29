import { describe, expect, it } from 'vitest';
import type { Node, System } from '@pylinka/graph';
import { lifeSeconds, particleTracks, stateAt, trackFor } from '../src/editor/lifePreview';

const f = (v: number) => ({ t: 'f32' as const, v });

function sys(nodes: Node[], edges: [string, string, string, string][]): System {
  return {
    id: 's1', name: 's', capacity: 10, blendMode: 'add', enabled: true, space: 'world',
    emitter: { mode: 'flow', rate: 1 },
    graph: {
      nodes,
      edges: edges.map(([a, ap, b, bp], i) => ({ id: `e${i}`, from: { nodeId: a, portId: ap }, to: { nodeId: b, portId: bp } })),
    },
  };
}

describe('life preview', () => {
  it('reads scale over life from literals and ease', () => {
    const n: Node = { id: 'a', kind: 'gen.scaleOverLife', values: { from: f(20), to: f(48) }, structural: { ease: 'linear' } };
    const tr = trackFor(sys([n], []), n)!;
    expect(tr.prop).toBe('scale');
    expect(tr.at(0, 1).scale).toBe(20);
    expect(tr.at(0.5, 1).scale).toBe(34);
    expect(tr.at(1, 1).scale).toBe(48);
  });

  it('gives a generic ramp the meaning of the write node it feeds', () => {
    const ramp: Node = { id: 'a', kind: 'gen.numberOverLife', values: { from: f(0), to: f(1) } };
    const w: Node = { id: 'w', kind: 'output.writeRotation', structural: { unit: 'radians' } };
    const s = sys([ramp, w], [['a', 'out', 'w', 'rot']]);
    const tr = trackFor(s, ramp)!;
    expect(tr.prop).toBe('rotation');
    expect(tr.at(1, 1).rotation).toBeCloseTo(180 / Math.PI);
    // unwired, it has no single-particle meaning
    expect(trackFor(sys([ramp], []), ramp)).toBeUndefined();
  });

  it('spins by rate × age in seconds', () => {
    const n: Node = { id: 'a', kind: 'gen.spin', values: { rate: f(90) } };
    expect(trackFor(sys([n], []), n)!.at(0.5, 2).rotation).toBe(90);
  });

  it('takes life from the middle of a random range', () => {
    const r: Node = { id: 'r', kind: 'gen.randomRange', values: { min: f(2.6), max: f(4) } };
    const l: Node = { id: 'l', kind: 'output.initLife' };
    expect(lifeSeconds(sys([r, l], [['r', 'out', 'l', 'life']]))).toBeCloseTo(3.3);
    expect(lifeSeconds(sys([{ id: 'l', kind: 'output.initLife', values: { life: f(0.7) } }], []))).toBe(0.7);
  });

  it('combines every wired track, multiplying color alpha into alpha', () => {
    const c: Node = { id: 'c', kind: 'gen.colorOverLife', values: { from: { t: 'color', v: '#ff000080' }, to: { t: 'color', v: '#ff000080' } } };
    const a: Node = { id: 'a', kind: 'gen.alphaOverLife', values: { from: f(0.5), to: f(0.5) } };
    const wc: Node = { id: 'wc', kind: 'output.writeColor' };
    const wa: Node = { id: 'wa', kind: 'output.writeAlpha' };
    const s = sys([c, a, wc, wa], [['c', 'out', 'wc', 'color'], ['a', 'out', 'wa', 'alpha']]);
    const st = stateAt(particleTracks(s), 0.3, 1);
    expect(st.color).toBe('#ff0000');
    expect(st.alpha).toBeCloseTo(0.5 * (128 / 255));
    // a muted write node drops out
    expect(particleTracks(s, ['wa'])).toHaveLength(1);
  });
});
