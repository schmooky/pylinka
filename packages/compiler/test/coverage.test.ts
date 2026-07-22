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
    expect(c.updateSrc).toContain('fn easeSel_sine_in(t: f32) -> f32 { return 1.0 - cos(t * 1.5707963267948966); }');
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

  it('mixes distinct eases per node (color sine.out + scale power2.out)', () => {
    const c = compile(
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
    );
    // both ease functions are emitted and each node calls its own
    expect(c.updateSrc).toContain('fn easeSel_power2_out(t: f32) -> f32');
    expect(c.updateSrc).toContain('fn easeSel_sine_in(t: f32) -> f32');
    expect(c.updateSrc).toContain('easeSel_power2_out(ageN)');
    expect(c.updateSrc).toContain('easeSel_sine_in(ageN)');
  });

  /** A body moving through the field + solid geometry it lands on. */
  const interactionGraph = (): Graph => ({
    nodes: [
      { id: 'n1', kind: 'shape.circle', values: { radius: { t: 'f32', v: 200 } } },
      { id: 'n2', kind: 'output.spawnPosition' },
      { id: 'n3', kind: 'output.initLife', values: { life: { t: 'f32', v: 4 } } },
      {
        id: 'n4',
        kind: 'field.obstacle',
        values: {
          center: { t: 'vec2', v: [0, 0] },
          velocity: { t: 'vec2', v: [400, 0] },
          radius: { t: 'f32', v: 150 },
          strength: { t: 'f32', v: 2400 },
          softness: { t: 'f32', v: 0.5 },
          swirl: { t: 'f32', v: 600 },
          carry: { t: 'f32', v: 3 },
        },
      },
      { id: 'n5', kind: 'output.addForce' },
      {
        id: 'n6',
        kind: 'output.collidePlane',
        values: {
          point: { t: 'vec2', v: [0, 400] },
          normal: { t: 'vec2', v: [0, -1] },
          restitution: { t: 'f32', v: 0.5 },
          friction: { t: 'f32', v: 0.2 },
        },
      },
      {
        id: 'n7',
        kind: 'output.collideRect',
        structural: { mode: 'outside' },
        values: {
          min: { t: 'vec2', v: [-100, -100] },
          max: { t: 'vec2', v: [100, 100] },
          restitution: { t: 'f32', v: 0.3 },
          friction: { t: 'f32', v: 0.1 },
        },
      },
      {
        id: 'n8',
        kind: 'output.collideCircle',
        values: {
          center: { t: 'vec2', v: [0, 0] },
          radius: { t: 'f32', v: 120 },
          restitution: { t: 'f32', v: 0.6 },
          friction: { t: 'f32', v: 0.05 },
          velocity: { t: 'vec2', v: [0, 0] },
        },
      },
    ],
    edges: [
      { id: 'e1', from: { nodeId: 'n1', portId: 'pos' }, to: { nodeId: 'n2', portId: 'pos' } },
      { id: 'e2', from: { nodeId: 'n4', portId: 'force' }, to: { nodeId: 'n5', portId: 'force' } },
    ],
  });

  it('field.obstacle pushes, swirls and carries, into the shared force register', () => {
    const c = compile(bundle(interactionGraph()), V1_CATALOG, 'webgpu');
    // soft falloff shell + tangential term + velocity inheritance
    expect(c.updateSrc).toContain('pow(');
    expect(c.updateSrc).toContain('mix(3.0, 0.5, clamp(');
    expect(c.updateSrc).toMatch(/vec2f\(-x_n4_2\.y, x_n4_2\.x\)/);
    expect(c.updateSrc).toContain('- p.vel)');
    expect(c.updateSrc).toContain('force +=');
  });

  it('collide.* resolve penetration AFTER integration, then bounce', () => {
    const c = compile(bundle(interactionGraph()), V1_CATALOG, 'webgpu');
    const src = c.updateSrc;
    const integrate = src.indexOf('p.pos += p.vel * U.dt;');
    expect(integrate).toBeGreaterThan(0);
    // every collider body sits after the integration line
    for (const marker of ['k_n6_sd', 'k_n7_m', 'k_n8_vn']) {
      expect(src.indexOf(marker), marker).toBeGreaterThan(integrate);
    }
    // plane: push back onto the surface, then reflect the normal component
    expect(src).toContain('p.pos = p.pos - k_n6_n * k_n6_sd;');
    // rect 'outside': eject along the axis of least penetration
    expect(src).toContain('min(min(k_n7_dl, k_n7_dr), min(k_n7_du, k_n7_dd))');
    // circle: relative to the disc's own velocity, so a moving wall kicks
    expect(src).toContain('let k_n8_rel: vec2f = p.vel -');
  });

  it('the same interaction graph translates to valid GLSL for webgl2', () => {
    const c = compile(bundle(interactionGraph()), V1_CATALOG, 'webgl2');
    // typed lets became GLSL declarations, vec2f became vec2, no WGSL leftovers
    expect(c.emitSrc).toContain('vec2 k_n6_n = ');
    expect(c.emitSrc).toContain('float k_n6_sd = ');
    expect(c.emitSrc).toContain('vec2 k_n8_vt = ');
    expect(c.emitSrc).not.toMatch(/\bvec2f\(/);
    expect(c.emitSrc).not.toMatch(/\blet\s/);
  });
});
