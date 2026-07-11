import { describe, expect, it } from 'vitest';
import { V1_CATALOG } from '@pylinka/graph';
import type { SystemBundle, System, Graph } from '@pylinka/graph';
import { compile } from '../src/index.js';

function bundle(graph: Graph, over: Partial<System> = {}): SystemBundle {
  return {
    params: [],
    assets: [],
    system: {
      id: 's', name: 'cover', capacity: 1024, blendMode: 'add', enabled: true, space: 'world',
      emitter: { mode: 'flow', rate: 10 },
      graph,
      ...over,
    },
  };
}

describe('compile — node coverage', () => {
  it('circle spawn + scaleOverLife + drag + killIf compile to valid WGSL', () => {
    const c = compile(
      bundle({
        nodes: [
          { id: 'n1', kind: 'shape.circle', values: { radius: { t: 'f32', v: 40 } } },
          { id: 'n2', kind: 'output.spawnPosition' },
          { id: 'n3', kind: 'output.initLife', values: { life: { t: 'f32', v: 2 } } },
          { id: 'n4', kind: 'field.drag', values: { coefficient: { t: 'f32', v: 1.5 } } },
          { id: 'n5', kind: 'output.drag' },
          { id: 'n6', kind: 'gen.scaleOverLife', structural: { ease: 'sine.in' }, values: { from: { t: 'f32', v: 1 }, to: { t: 'f32', v: 0 } } },
          { id: 'n7', kind: 'output.writeScale' },
          { id: 'n8', kind: 'output.killIf', values: { cond: { t: 'bool', v: false } } },
        ],
        edges: [
          { id: 'e1', from: { nodeId: 'n1', portId: 'pos' }, to: { nodeId: 'n2', portId: 'pos' } },
          { id: 'e2', from: { nodeId: 'n4', portId: 'drag' }, to: { nodeId: 'n5', portId: 'drag' } },
          { id: 'e3', from: { nodeId: 'n6', portId: 'out' }, to: { nodeId: 'n7', portId: 'scale' } },
        ],
      }),
      V1_CATALOG,
      'webgpu',
    );
    // circle uses a stable random angle temp
    expect(c.emitSrc).toContain('= 6.283185307179586 * srand(seed, 0u);');
    expect(c.updateSrc).toContain('dragK +=');
    expect(c.updateSrc).toContain('outSize =');
    expect(c.updateSrc).toContain('kill = kill ||');
    expect(c.updateSrc).toContain('fn easeSel(t: f32) -> f32 { return 1.0 - cos(t * 1.5707963267948966); }');
  });

  it('setVelocity omits the force/drag integration lines', () => {
    const c = compile(
      bundle({
        nodes: [
          { id: 'n1', kind: 'shape.point', values: { offset: { t: 'vec2', v: [0, 0] } } },
          { id: 'n2', kind: 'output.spawnPosition' },
          { id: 'n3', kind: 'output.initLife', values: { life: { t: 'f32', v: 1 } } },
          { id: 'n4', kind: 'input.emitterVelocity' },
          { id: 'n5', kind: 'output.setVelocity' },
        ],
        edges: [
          { id: 'e1', from: { nodeId: 'n1', portId: 'pos' }, to: { nodeId: 'n2', portId: 'pos' } },
          { id: 'e2', from: { nodeId: 'n4', portId: 'out' }, to: { nodeId: 'n5', portId: 'vel' } },
        ],
      }),
      V1_CATALOG,
      'webgpu',
    );
    // emitterVelocity is wired, so setVelocity reads the producer temp
    expect(c.updateSrc).toContain('let t_n4 = U.emitterVel;');
    expect(c.updateSrc).toContain('p.vel = t_n4;');
    expect(c.updateSrc).not.toContain('p.vel += force * U.dt;');
  });

  it('vortex + turbulence forces compile to update-pass WGSL', () => {
    const c = compile(
      bundle({
        nodes: [
          { id: 'n1', kind: 'shape.point', values: { offset: { t: 'vec2', v: [0, 0] } } },
          { id: 'n2', kind: 'output.spawnPosition' },
          { id: 'n3', kind: 'output.initLife', values: { life: { t: 'f32', v: 2 } } },
          { id: 'n4', kind: 'field.vortex', values: { center: { t: 'vec2', v: [0, 0] }, strength: { t: 'f32', v: 300 }, pull: { t: 'f32', v: 40 }, radius: { t: 'f32', v: 240 } } },
          { id: 'n5', kind: 'output.addForce' },
          { id: 'n6', kind: 'field.turbulence', values: { strength: { t: 'f32', v: 200 }, scale: { t: 'f32', v: 120 }, speed: { t: 'f32', v: 1 } } },
          { id: 'n7', kind: 'output.addForce' },
        ],
        edges: [
          { id: 'e1', from: { nodeId: 'n1', portId: 'pos' }, to: { nodeId: 'n2', portId: 'pos' } },
          { id: 'e2', from: { nodeId: 'n4', portId: 'force' }, to: { nodeId: 'n5', portId: 'force' } },
          { id: 'e3', from: { nodeId: 'n6', portId: 'force' }, to: { nodeId: 'n7', portId: 'force' } },
        ],
      }),
      V1_CATALOG,
      'webgpu',
    );
    // vortex: emitter-relative center, tangential swirl + pull, linear falloff
    expect(c.updateSrc).toContain('p.pos - (U.emitterPos + ');
    expect(c.updateSrc).toContain('select(1.0, clamp(1.0 - ');
    // turbulence: animated value-noise curl via central differences
    expect(c.updateSrc).toContain('* 43758.5453');
    expect(c.updateSrc).toContain('U.time *');
    expect(c.updateSrc).toContain('/ (2.0 * 0.35) *');
    // both accumulate into the shared force register
    expect(c.updateSrc).toContain('force +=');
  });

  it('multiple distinct eases are rejected in v1', () => {
    expect(() =>
      compile(
        bundle({
          nodes: [
            { id: 'n1', kind: 'shape.point', values: { offset: { t: 'vec2', v: [0, 0] } } },
            { id: 'n2', kind: 'output.spawnPosition' },
            { id: 'n3', kind: 'output.initLife', values: { life: { t: 'f32', v: 1 } } },
            { id: 'n4', kind: 'gen.colorOverLife', structural: { ease: 'power2.out' }, values: { from: { t: 'color', v: '#ffffffff' }, to: { t: 'color', v: '#00000000' } } },
            { id: 'n5', kind: 'output.writeColor' },
            { id: 'n6', kind: 'gen.scaleOverLife', structural: { ease: 'sine.in' }, values: { from: { t: 'f32', v: 1 }, to: { t: 'f32', v: 0 } } },
            { id: 'n7', kind: 'output.writeScale' },
          ],
          edges: [
            { id: 'e1', from: { nodeId: 'n1', portId: 'pos' }, to: { nodeId: 'n2', portId: 'pos' } },
            { id: 'e2', from: { nodeId: 'n4', portId: 'out' }, to: { nodeId: 'n5', portId: 'color' } },
            { id: 'e3', from: { nodeId: 'n6', portId: 'out' }, to: { nodeId: 'n7', portId: 'scale' } },
          ],
        }),
        V1_CATALOG,
        'webgpu',
      ),
    ).toThrow(/one ease per system/);
  });
});
