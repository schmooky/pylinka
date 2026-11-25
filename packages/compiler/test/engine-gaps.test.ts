/**
 * Nodes and sub-emitter events added for RevoltFX parity: atan2 / rotation / dt
 * inputs, separate X/Y scale, and the age / bounce / alive parent events.
 */
import { describe, expect, it } from 'vitest';
import { V1_CATALOG } from '@pylinka/graph';
import type { Graph, SystemBundle } from '@pylinka/graph';
import { compile } from '../src/index.js';

const f = (v: number) => ({ t: 'f32' as const, v });

function bundle(graph: Graph): SystemBundle {
  return {
    params: [],
    assets: [],
    system: { id: 's', name: 'gaps', capacity: 256, blendMode: 'multiply', enabled: true, space: 'world', emitter: { mode: 'flow', rate: 10 }, graph },
  };
}

const base = [
  { id: 'n1', kind: 'output.spawnPosition', values: { pos: { t: 'vec2' as const, v: [0, 0] as [number, number] } } },
  { id: 'n2', kind: 'output.initLife', values: { life: f(1) } },
];

describe('heading, rotation and dt', () => {
  const g: Graph = {
    nodes: [
      ...base,
      { id: 'n3', kind: 'input.velocity' },
      { id: 'n4', kind: 'math.component', structural: { index: 'y' } },
      { id: 'n5', kind: 'math.component', structural: { index: 'x' } },
      { id: 'n6', kind: 'math.atan2' },
      { id: 'n7', kind: 'input.rotation' },
      { id: 'n8', kind: 'input.dt' },
      { id: 'n9', kind: 'math.mad' },
      { id: 'n10', kind: 'output.writeRotation', structural: { unit: 'radians' } },
    ],
    edges: [
      { id: 'e1', from: { nodeId: 'n3', portId: 'out' }, to: { nodeId: 'n4', portId: 'v' } },
      { id: 'e2', from: { nodeId: 'n3', portId: 'out' }, to: { nodeId: 'n5', portId: 'v' } },
      { id: 'e3', from: { nodeId: 'n4', portId: 'out' }, to: { nodeId: 'n6', portId: 'y' } },
      { id: 'e4', from: { nodeId: 'n5', portId: 'out' }, to: { nodeId: 'n6', portId: 'x' } },
      { id: 'e5', from: { nodeId: 'n6', portId: 'out' }, to: { nodeId: 'n9', portId: 'a' } },
      { id: 'e6', from: { nodeId: 'n8', portId: 'out' }, to: { nodeId: 'n9', portId: 'b' } },
      { id: 'e7', from: { nodeId: 'n7', portId: 'out' }, to: { nodeId: 'n9', portId: 'c' } },
      { id: 'e8', from: { nodeId: 'n9', portId: 'out' }, to: { nodeId: 'n10', portId: 'rot' } },
    ],
  };

  it('WGSL uses atan2, the current rotation and U.dt', () => {
    const c = compile(bundle(g), V1_CATALOG, 'webgpu');
    expect(c.updateSrc).toMatch(/atan2\(t_n4, t_n5\)/);
    expect(c.updateSrc).toContain('= outRot;');
    expect(c.updateSrc).toContain('= U.dt;');
  });

  it('GLSL spells atan2 as atan(y, x)', () => {
    const c = compile(bundle(g), V1_CATALOG, 'webgl2');
    expect(c.emitSrc).toMatch(/atan\(t_n4, t_n5\)/);
    expect(c.emitSrc).not.toContain('atan2(');
  });
});

describe('writeScaleXY', () => {
  const g: Graph = {
    nodes: [...base, { id: 'n3', kind: 'output.writeScaleXY', values: { scale: { t: 'vec2', v: [2, 1] } } }],
    edges: [],
  };
  it('stores width in size and height as an aspect, on both targets', () => {
    for (const target of ['webgpu', 'webgl2'] as const) {
      const c = compile(bundle(g), V1_CATALOG, target);
      const src = target === 'webgpu' ? c.updateSrc : c.emitSrc;
      expect(src).toMatch(/outSize = V\[\d+\]\.xy\.x;/);
      expect(src).toMatch(/outAspect = /);
    }
  });
});

describe('sub-emitter parent events', () => {
  const sub = (on: string): Graph => ({
    nodes: [
      ...base,
      { id: 'n3', kind: 'input.spawnIndex' },
      { id: 'n4', kind: 'output.initRotation', structural: { unit: 'radians' } },
      { id: 'n5', kind: 'output.deathBurst', structural: { max: '8', on }, values: { countMin: f(2), countMax: f(2), inheritVelocity: f(0), at: f(0.5), rate: f(30) } },
    ],
    edges: [{ id: 'e1', from: { nodeId: 'n3', portId: 'out' }, to: { nodeId: 'n4', portId: 'rot' } }],
  });

  it('age fires the frame the parent crosses `at`', () => {
    const w = compile(bundle(sub('age')), V1_CATALOG, 'webgpu').subSrc;
    expect(w).toContain('let pAgePrev = select(-1.0, pAge - U.dt, wasAlive == 1u);');
    const g = compile(bundle(sub('age')), V1_CATALOG, 'webgl2').subSrc;
    expect(g).toContain('bool parentFired = ((i_pFlags & 1u) != 0u) && i_pAge >=');
  });

  it('bounce reads bit 1 of the parent flags, which collide outputs set', () => {
    expect(compile(bundle(sub('bounce')), V1_CATALOG, 'webgpu').subSrc).toContain('(pMeta[i].flags & 2u) == 0u');
    expect(compile(bundle(sub('bounce')), V1_CATALOG, 'webgl2').subSrc).toContain('((i_pFlags & 2u) != 0u)');
    const parent: Graph = {
      nodes: [...base, { id: 'n3', kind: 'output.collidePlane', values: { point: { t: 'vec2', v: [0, 400] }, normal: { t: 'vec2', v: [0, -1] }, restitution: f(0.5), friction: f(0) } }],
      edges: [],
    };
    const p = compile(bundle(parent), V1_CATALOG, 'webgpu').updateSrc;
    expect(p).toContain('bounced = true;');
    expect(p).toContain('select(0u, 2u, bounced)');
  });

  it('alive ticks off the parent age; WebGL2 rotates through the pool copies', () => {
    const w = compile(bundle(sub('alive')), V1_CATALOG, 'webgpu').subSrc;
    expect(w).toContain('let nNow = floor(pAge * V[');
    const g = compile(bundle(sub('alive')), V1_CATALOG, 'webgl2').subSrc;
    expect(g).toContain('float pTick = floor(i_pAge * V[');
    expect(g).toContain('% 8u) < burstN');
  });

  it('spawnIndex is the index within the burst', () => {
    expect(compile(bundle(sub('death')), V1_CATALOG, 'webgpu').subSrc).toContain('let i = b;');
    expect(compile(bundle(sub('death')), V1_CATALOG, 'webgl2').subSrc).toContain('uint i = uint(u_burstK);');
  });
});
