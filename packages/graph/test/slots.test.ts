import { describe, expect, it } from 'vitest';
import { assignSlots } from '../src/index.js';
import { coinTrailBundle } from './fixtures/coin-spark-trail.js';

describe('assignSlots — §12.2 / golden §14.2', () => {
  it('reproduces the golden slot table exactly', () => {
    const layout = assignSlots(coinTrailBundle.system.graph, coinTrailBundle.params);

    expect(layout.slotCount).toBe(10);
    expect(layout.systemUniformsSize).toBe(48);

    // §14.2 expected table (slot → origin, type)
    const expected = [
      { slot: 0, type: 'vec2', origin: { kind: 'nodeValue', nodeId: 'n1', portId: 'offset' } },
      { slot: 1, type: 'color', origin: { kind: 'nodeValue', nodeId: 'n13', portId: 'from' } },
      { slot: 2, type: 'color', origin: { kind: 'nodeValue', nodeId: 'n13', portId: 'to' } },
      { slot: 3, type: 'f32', origin: { kind: 'nodeValue', nodeId: 'n3', portId: 'max' } },
      { slot: 4, type: 'f32', origin: { kind: 'nodeValue', nodeId: 'n3', portId: 'min' } },
      { slot: 5, type: 'vec2', origin: { kind: 'nodeValue', nodeId: 'n5', portId: 'max' } },
      { slot: 6, type: 'vec2', origin: { kind: 'nodeValue', nodeId: 'n5', portId: 'min' } },
      { slot: 7, type: 'vec2', origin: { kind: 'nodeValue', nodeId: 'n7', portId: 'g' } },
      { slot: 8, type: 'f32', origin: { kind: 'knob', paramId: 'p1' } },
      { slot: 9, type: 'f32', origin: { kind: 'knob', paramId: 'p2' } },
    ];

    expect(layout.entries).toEqual(expected);
  });

  it('emits at least one slot even when the graph has no value slots', () => {
    const layout = assignSlots({ nodes: [], edges: [] }, []);
    expect(layout.slotCount).toBe(1);
    expect(layout.entries).toEqual([]);
  });

  it('a knob-bound port keeps its port slot (origin flips to knob, count unchanged)', () => {
    // promotion-safety: promoting n1.offset to a NEW knob must not add a slot (§17.3)
    const graph = structuredClone(coinTrailBundle.system.graph);
    const n1 = graph.nodes.find((n) => n.id === 'n1');
    if (!n1) throw new Error('fixture drift');
    n1.knobBindings = { offset: 'p3' }; // p3 is fresh (not referenced by any param.ref)

    const layout = assignSlots(graph, coinTrailBundle.params);
    expect(layout.slotCount).toBe(10); // unchanged — p1/p2 still appended after ports
    expect(layout.entries[0]).toEqual({
      slot: 0,
      type: 'vec2',
      origin: { kind: 'knob', paramId: 'p3' },
    });
  });

  it('excludes dead-node value ports from slots', () => {
    const graph = structuredClone(coinTrailBundle.system.graph);
    // a floating node with a value but no path to any output → dead → no slot
    graph.nodes.push({ id: 'z9', kind: 'field.gravity', values: { g: { t: 'vec2', v: [1, 2] } } });
    const layout = assignSlots(graph, coinTrailBundle.params);
    expect(layout.slotCount).toBe(10);
    expect(layout.entries.some((e) => e.origin.kind === 'nodeValue' && e.origin.nodeId === 'z9')).toBe(
      false,
    );
  });
});
