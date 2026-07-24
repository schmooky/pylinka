/**
 * Death-burst codegen (output.deathBurst): a sub-emitter that spawns a burst of
 * particles at each parent death. Verifies the WGSL free-list loop and the
 * WebGL2 k-region pass both wire up, and that a graph without the node keeps the
 * classic one-spawn-per-death sub-emitter byte-for-byte.
 */
import { describe, expect, it } from 'vitest';
import { V1_CATALOG } from '@pylinka/graph';
import type { SystemBundle, System, Graph } from '@pylinka/graph';
import { compile } from '../src/index.js';

function bundle(graph: Graph, over: Partial<System> = {}): SystemBundle {
  return {
    params: [],
    assets: [],
    system: {
      id: 's', name: 'boom', capacity: 1024, blendMode: 'add', enabled: true, space: 'world',
      emitter: { mode: 'flow', rate: 10 },
      graph,
      ...over,
    },
  };
}

const burstGraph = (): Graph => ({
  nodes: [
    { id: 'n1', kind: 'shape.point', values: { offset: { t: 'vec2', v: [0, 0] } } },
    { id: 'n2', kind: 'output.spawnPosition' },
    { id: 'n3', kind: 'output.initLife', values: { life: { t: 'f32', v: 1 } } },
    { id: 'n4', kind: 'gen.randomVec2', values: { min: { t: 'vec2', v: [-80, -80] }, max: { t: 'vec2', v: [80, 80] } } },
    { id: 'n5', kind: 'output.initVelocity' },
    {
      id: 'n6',
      kind: 'output.deathBurst',
      structural: { max: '16' },
      values: {
        countMin: { t: 'f32', v: 4 },
        countMax: { t: 'f32', v: 12 },
        inheritVelocity: { t: 'f32', v: 0.5 },
      },
    },
  ],
  edges: [
    { id: 'e1', from: { nodeId: 'n1', portId: 'pos' }, to: { nodeId: 'n2', portId: 'pos' } },
    { id: 'e2', from: { nodeId: 'n4', portId: 'out' }, to: { nodeId: 'n5', portId: 'vel' } },
  ],
});

const plainSubGraph = (): Graph => ({
  nodes: [
    { id: 'n1', kind: 'shape.point', values: { offset: { t: 'vec2', v: [0, 0] } } },
    { id: 'n2', kind: 'output.spawnPosition' },
    { id: 'n3', kind: 'output.initLife', values: { life: { t: 'f32', v: 1 } } },
  ],
  edges: [{ id: 'e1', from: { nodeId: 'n1', portId: 'pos' }, to: { nodeId: 'n2', portId: 'pos' } }],
});

describe('death-burst codegen', () => {
  it('WGSL: loops up to max free-list pops with per-death count + inheritance', () => {
    const c = compile(bundle(burstGraph()), V1_CATALOG, 'webgpu');
    expect(c.burst).toEqual({ max: 16 });
    // per-death count from the value slots, capped to max, looped
    expect(c.subSrc).toContain('let burstN = min(u32(max(round(burstF), 0.0)), 16u);');
    expect(c.subSrc).toMatch(/for \(var b: u32 = 0u; b < burstN;/);
    // velocity inheritance from the parent's death velocity
    expect(c.subSrc).toContain('o_initVel + inheritV * parentVel');
    // iterates parent slots, not the (×max) child pool
    expect(c.subSrc).toContain('i >= arrayLength(&prevAlive)');
  });

  it('WebGL2: k-region pass gated by u_burstK, reads parent velocity', () => {
    const c = compile(bundle(burstGraph()), V1_CATALOG, 'webgl2');
    expect(c.burst).toEqual({ max: 16 });
    expect(c.subSrc).toContain('uniform int u_burstK;');
    expect(c.subSrc).toContain('in vec2 i_pVel;');
    expect(c.subSrc).toContain('uint(u_burstK) < burstN');
    expect(c.subSrc).toContain('o_initVel + (');
  });

  it('no deathBurst node → no burst + classic single-spawn sub-emitter', () => {
    const wg = compile(bundle(plainSubGraph()), V1_CATALOG, 'webgpu');
    expect(wg.burst).toBeUndefined();
    expect(wg.subSrc).not.toContain('for (var b: u32');
    expect(wg.subSrc).not.toContain('burstN');
    const gl = compile(bundle(plainSubGraph()), V1_CATALOG, 'webgl2');
    expect(gl.burst).toBeUndefined();
    expect(gl.subSrc).not.toContain('u_burstK');
  });

  it('clamps max to [1,64] and defaults sensibly', () => {
    const g = burstGraph();
    (g.nodes.find((n) => n.id === 'n6') as { structural: { max: string } }).structural.max = '999';
    expect(compile(bundle(g), V1_CATALOG, 'webgpu').burst).toEqual({ max: 64 });
  });
});
