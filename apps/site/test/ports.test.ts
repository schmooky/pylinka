/**
 * A wire is only allowed to land when both ends agree on a type. These pin the
 * lookup the canvas uses while one is being dragged — the check that stops a
 * vec2 reaching an f32 input and turning into a compiler error a moment later.
 */
import { describe, expect, it } from 'vitest';
import type { Graph } from '@pylinka/graph';
import { portType } from '../src/editor/ports';

const graph: Graph = {
  nodes: [
    { id: 'n1', kind: 'gen.randomVec2' },
    { id: 'n2', kind: 'gen.randomRange' },
    { id: 'n3', kind: 'output.initVelocity' },
    { id: 'n4', kind: 'output.initLife' },
    { id: 'n5', kind: 'made.up' },
  ],
  edges: [],
};

describe('portType', () => {
  it('reads an output type', () => {
    expect(portType(graph, 'n1', 'out', 'out')).toBe('vec2');
    expect(portType(graph, 'n2', 'out', 'out')).toBe('f32');
  });

  it('reads an input type', () => {
    expect(portType(graph, 'n3', 'vel', 'in')).toBe('vec2');
    expect(portType(graph, 'n4', 'life', 'in')).toBe('f32');
  });

  it('is undefined for a port that does not exist on that side', () => {
    // `out` is an OUTPUT of randomRange, so asking for it as an input is a miss
    expect(portType(graph, 'n2', 'out', 'in')).toBeUndefined();
    expect(portType(graph, 'n2', 'nope', 'out')).toBeUndefined();
  });

  it('is undefined for an unknown node or kind', () => {
    expect(portType(graph, 'nope', 'out', 'out')).toBeUndefined();
    expect(portType(graph, 'n5', 'out', 'out')).toBeUndefined();
  });

  it('the pairs the canvas allows and refuses', () => {
    const ok = (a: [string, string], b: [string, string]) =>
      portType(graph, a[0], a[1], 'out') === portType(graph, b[0], b[1], 'in');
    expect(ok(['n1', 'out'], ['n3', 'vel'])).toBe(true); // vec2 -> vec2
    expect(ok(['n2', 'out'], ['n4', 'life'])).toBe(true); // f32  -> f32
    expect(ok(['n1', 'out'], ['n4', 'life'])).toBe(false); // vec2 -> f32
    expect(ok(['n2', 'out'], ['n3', 'vel'])).toBe(false); // f32  -> vec2
  });
});
