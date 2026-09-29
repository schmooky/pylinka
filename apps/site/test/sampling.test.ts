import { describe, expect, it } from 'vitest';
import type { Node, System } from '@pylinka/graph';
import { sampleOutput, simulate, type Vec } from '../src/editor/sampling';
import { autoLayout } from '../src/editor/layout';
import { nodeHeight } from '../src/editor/nodeSize';

const f = (v: number) => ({ t: 'f32' as const, v });
const v2 = (x: number, y: number) => ({ t: 'vec2' as const, v: [x, y] as [number, number] });

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

/** a fountain: spawn at a point, velocity straight up, gravity down, 1s life */
function fountain(extra: Node[] = [], extraEdges: [string, string, string, string][] = []) {
  return sys(
    [
      { id: 'sp', kind: 'output.spawnPosition' },
      { id: 'v', kind: 'output.initVelocity', values: { vel: v2(0, -100) } },
      { id: 'l', kind: 'output.initLife', values: { life: f(1) } },
      { id: 'g', kind: 'field.gravity', values: { g: v2(0, 100) } },
      { id: 'af', kind: 'output.addForce' },
      ...extra,
    ],
    [['g', 'force', 'af', 'force'], ...extraEdges],
  );
}

const end = (pts: Vec[]) => pts[pts.length - 1]!;

describe('node preview sampling', () => {
  it('samples a random range inside its bounds, the same way every time', () => {
    const s = sys([{ id: 'r', kind: 'gen.randomRange', values: { min: f(1.6), max: f(2.6) } }], []);
    const a = sampleOutput(s, [], 'r', 'out', 50) as number[];
    expect(a.every((x) => x >= 1.6 && x <= 2.6)).toBe(true);
    expect(new Set(a.map((x) => x.toFixed(4))).size).toBeGreaterThan(40);
    expect(sampleOutput(s, [], 'r', 'out', 50)).toEqual(a);
  });

  it('spawns ON a circle and inside a rectangle, as the compiler does', () => {
    const c = sys([{ id: 'c', kind: 'shape.circle', values: { radius: f(50) } }], []);
    for (const p of sampleOutput(c, [], 'c', 'pos', 20) as Vec[]) expect(Math.hypot(p[0], p[1])).toBeCloseTo(50, 6);
    const r = sys([{ id: 'r', kind: 'shape.rectangle', values: { size: v2(100, 40) } }], []);
    for (const [x, y] of sampleOutput(r, [], 'r', 'pos', 20) as Vec[]) {
      expect(Math.abs(x)).toBeLessThanOrEqual(50);
      expect(Math.abs(y)).toBeLessThanOrEqual(20);
    }
  });

  it('flies a particle up and back under gravity (vel += g·dt; pos += vel·dt)', () => {
    const { paths } = simulate(fountain(), [], { count: 1 });
    // exact sum of the semi-implicit steps: −100·1 + 100·dt²·N(N+1)/2 with N = 60
    expect(end(paths[0]!.pts)[1]).toBeCloseTo(-100 + (100 / 3600) * (60 * 61) / 2, 3);
  });

  it('draws the same particles without a force, for the dashed comparison', () => {
    const { paths } = simulate(fountain(), [], { count: 1, exclude: new Set(['g']) });
    expect(end(paths[0]!.pts)[1]).toBeCloseTo(-100, 3);
  });

  it('decays velocity by e^(−drag·dt) each step', () => {
    const s = sys(
      [
        { id: 'v', kind: 'output.initVelocity', values: { vel: v2(100, 0) } },
        { id: 'l', kind: 'output.initLife', values: { life: f(1) } },
        { id: 'd', kind: 'output.drag', values: { drag: f(1) } },
      ],
      [],
    );
    const { paths } = simulate(s, [], { count: 1 });
    let x = 0;
    for (let k = 1; k <= 60; k++) x += (100 * Math.exp(-k / 60)) / 60;
    expect(end(paths[0]!.pts)[0]).toBeCloseTo(x, 3);
  });

  it('keeps each particle’s random draws when another node is switched off', () => {
    const rv: Node = { id: 'rv', kind: 'gen.randomVec2', values: { min: v2(-50, -300), max: v2(50, -100) } };
    const s = fountain([rv], [['rv', 'out', 'v', 'vel']]);
    const a = simulate(s, [], { count: 6 }).paths.map((p) => p.pts[1]![0]);
    const b = simulate(s, [], { count: 6, exclude: new Set(['g']) }).paths.map((p) => p.pts[1]![0]);
    expect(b).toEqual(a);
  });

  it('reports what it cannot model instead of pretending', () => {
    const s = fountain([{ id: 't', kind: 'field.turbulence' }], []);
    expect(simulate(s, [], { count: 1 }).approx).toContain('field.turbulence');
  });
});

describe('auto-layout leaves room for node previews', () => {
  it('never lets a node overlap the one below it in its column', () => {
    const s = fountain([
      { id: 'rr', kind: 'gen.randomRange', values: { min: f(1), max: f(2) } },
      { id: 'pt', kind: 'shape.point' },
    ], [['rr', 'out', 'l', 'life'], ['pt', 'pos', 'sp', 'pos']]);
    const pos = autoLayout(s.graph);
    const byX = new Map<number, Node[]>();
    for (const n of s.graph.nodes) byX.set(pos[n.id]!.x, [...(byX.get(pos[n.id]!.x) ?? []), n]);
    for (const col of byX.values()) {
      col.sort((a, b) => pos[a.id]!.y - pos[b.id]!.y);
      for (let i = 0; i + 1 < col.length; i++) {
        expect(pos[col[i + 1]!.id]!.y - pos[col[i]!.id]!.y).toBeGreaterThanOrEqual(nodeHeight(col[i]!, s.graph));
      }
    }
  });
});
