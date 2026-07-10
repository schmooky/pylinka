import { describe, expect, it } from 'vitest';
import { canonicalGraphString, hashGraph } from '../src/index.js';
import type { Graph } from '../src/index.js';
import { coinTrailSystem } from './fixtures/coin-spark-trail.js';

const clone = (g: Graph): Graph => structuredClone(g);

describe('hashGraph — §12.1', () => {
  const base = coinTrailSystem.graph;

  it('is a stable 16-char lowercase hex string', () => {
    const h = hashGraph(base);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    // deterministic across calls
    expect(hashGraph(base)).toBe(h);
  });

  it('is invariant to value-literal edits (values never recompile)', () => {
    const g = clone(base);
    const n7 = g.nodes.find((n) => n.id === 'n7');
    if (!n7) throw new Error('fixture drift');
    n7.values = { g: { t: 'vec2', v: [999, -999] } };
    expect(hashGraph(g)).toBe(hashGraph(base));
  });

  it('is invariant to knobBindings (promotion never recompiles)', () => {
    const g = clone(base);
    const n1 = g.nodes.find((n) => n.id === 'n1');
    if (!n1) throw new Error('fixture drift');
    n1.knobBindings = { offset: 'p1' };
    expect(hashGraph(g)).toBe(hashGraph(base));
  });

  it('is invariant to node-array order (canonical sorts by id)', () => {
    const g = clone(base);
    g.nodes.reverse();
    g.edges.reverse();
    expect(hashGraph(g)).toBe(hashGraph(base));
  });

  it('is invariant to dead nodes', () => {
    const g = clone(base);
    g.nodes.push({ id: 'zzz', kind: 'gen.random' });
    expect(hashGraph(g)).toBe(hashGraph(base));
  });

  it('changes when a structural param changes (ease)', () => {
    const g = clone(base);
    const n13 = g.nodes.find((n) => n.id === 'n13');
    if (!n13) throw new Error('fixture drift');
    n13.structural = { ease: 'linear' };
    expect(hashGraph(g)).not.toBe(hashGraph(base));
  });

  it('changes when connectivity changes (an edge removed)', () => {
    const g = clone(base);
    g.edges = g.edges.filter((e) => e.id !== 'e8');
    expect(hashGraph(g)).not.toBe(hashGraph(base));
  });

  it('changes when a live node kind changes', () => {
    const g = clone(base);
    const n7 = g.nodes.find((n) => n.id === 'n7');
    if (!n7) throw new Error('fixture drift');
    n7.kind = 'field.radial';
    expect(hashGraph(g)).not.toBe(hashGraph(base));
  });

  it('canonical string starts with the hash-format version tag', () => {
    expect(canonicalGraphString(base).startsWith('H1')).toBe(true);
  });
});
