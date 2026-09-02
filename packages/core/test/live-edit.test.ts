/**
 * A structural edit starts from now; a value edit does not.
 *
 * Uniforms are read per frame, so a changed VALUE reaches the next spawn
 * immediately. Particles already alive re-read nothing, though — delete the
 * node that shaped the spawn area and everything on screen keeps the old shape
 * until it dies, which with a two-second lifetime is indistinguishable from the
 * deletion not having taken. Reported as exactly that: "I remove the rect and
 * the behaviour doesn't change until I change some other value."
 *
 * Both halves matter. Clearing on every edit would make tuning impossible —
 * you are watching a running effect while you drag a slider.
 */
import { describe, expect, it } from 'vitest';
import { hashGraph } from '@pylinka/graph';
import type { System } from '@pylinka/graph';

const rect = (): System => ({
  id: 's', name: 'x', capacity: 100, blendMode: 'add', enabled: true, space: 'world',
  emitter: { mode: 'flow', rate: 10 },
  graph: {
    nodes: [
      { id: 'r', kind: 'shape.rectangle', values: { size: { t: 'vec2', v: [200, 40] } } },
      { id: 'sp', kind: 'output.spawnPosition' },
      { id: 'li', kind: 'output.initLife', values: { life: { t: 'f32', v: 2 } } },
    ],
    edges: [{ id: 'e', from: { nodeId: 'r', portId: 'pos' }, to: { nodeId: 'sp', portId: 'pos' } }],
  },
});

describe('what counts as a structural edit', () => {
  it('deleting a node changes the graph hash', () => {
    const before = hashGraph(rect().graph);
    const s = rect();
    s.graph.nodes = s.graph.nodes.filter((n) => n.id !== 'r');
    s.graph.edges = [];
    expect(hashGraph(s.graph)).not.toBe(before);
  });

  it('disconnecting a wire changes it too', () => {
    const before = hashGraph(rect().graph);
    const s = rect();
    s.graph.edges = [];
    expect(hashGraph(s.graph)).not.toBe(before);
  });

  it('editing a value does NOT — the pool has to survive a slider drag', () => {
    const before = hashGraph(rect().graph);
    const s = rect();
    s.graph.nodes[0]!.values = { size: { t: 'vec2', v: [400, 40] } };
    expect(hashGraph(s.graph)).toBe(before);
  });
});

describe('the interpreted backend acts on it', () => {
  it('clears the pool when the hash moves, and only then', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('../src/webgl/index.ts', import.meta.url)), 'utf8');
    const apply = src.slice(src.indexOf('apply(next: PylinkaProject)'));
    expect(apply).toContain('const nextHash = hashGraph(sys.graph);');
    expect(apply).toContain('if (nextHash !== graphHash) {');
    expect(apply).toContain('engine.resetPool();');
    // the scheduler carries fractional spawn debt; a reset pool with a stale
    // accumulator spits out a clump on the first frame
    expect(apply).toContain('scheduler.reset();');
  });

  it('has a pool reset to call', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('../src/webgl/engine.ts', import.meta.url)), 'utf8');
    expect(src).toContain('resetPool(): void {');
  });
});
