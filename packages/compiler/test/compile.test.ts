import { describe, expect, it } from 'vitest';
import { V1_CATALOG } from '@pylinka/graph';
import { CompileError, compile } from '../src/index.js';
import { coinTrailBundle } from './fixtures/coin-spark-trail.js';

describe('compile — coin-spark-trail golden (§14)', () => {
  const compiled = compile(coinTrailBundle, V1_CATALOG, 'webgpu');

  it('emit kernel matches the golden', async () => {
    await expect(compiled.emitSrc).toMatchFileSnapshot('./golden/coin-spark-trail.emit.wgsl');
  });

  it('update kernel matches the golden', async () => {
    await expect(compiled.updateSrc).toMatchFileSnapshot('./golden/coin-spark-trail.update.wgsl');
  });

  it('reproduces the §14.2 uniform layout (10 slots)', () => {
    expect(compiled.uniforms.slotCount).toBe(10);
    expect(compiled.uniforms.systemUniformsSize).toBe(48);
    expect(compiled.uniforms.entries).toEqual([
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
    ]);
  });

  it('carries the fixed v1 binding layout', () => {
    expect(compiled.bindings).toEqual({
      group: 0, uniforms: 0, valueTable: 1, hot: 2, rnd: 3, meta: 4, counters: 5, freeList: 6,
    });
  });

  it('emits the §14.3 init body semantics', () => {
    const s = compiled.emitSrc;
    expect(s).toContain('let t_n3 = mix(V[4].x, V[3].x, srand(seed, 0u));');
    expect(s).toContain('let t_n5 = mix(V[6].xy, V[5].xy, vec2f(srand(seed, 1u), srand(seed, 2u)));');
    expect(s).toContain('let o_spawnLocal: vec2f = t_n1;');
    expect(s).toContain('let o_initLife: f32 = t_n3;');
    expect(s).toContain('let o_initVel: vec2f = t_n5;');
    expect(s).toContain('let o_texIndex: u32 = 0u;');
  });

  it('emits the §14.4 update body semantics', () => {
    const s = compiled.updateSrc;
    expect(s).toContain('let t_n7 = V[7].xy;');
    expect(s).toContain('let t_n9 = V[8].x;');
    expect(s).toContain('let t_n11 = vec2f(cos(t_n10), sin(t_n10)) * t_n9;');
    expect(s).toContain('force += t_n7;');
    expect(s).toContain('force += t_n11;');
    expect(s).toContain('let t_n13 = mix(V[1], V[2], easeSel(ageN));');
    expect(s).toContain('outColor = t_n13;');
    expect(s).toContain('fn easeSel(t: f32) -> f32 { let u = 1.0 - t; return 1.0 - u * u * u; }');
  });

  it('bakes SLOTS as a literal and writes two writeBuffer-friendly uniform blocks', () => {
    expect(compiled.emitSrc).toContain('var<uniform> V: array<vec4f, 10>;');
    expect(compiled.updateSrc).toContain('var<uniform> V: array<vec4f, 10>;');
  });

  it('graphHash is stable 16-char hex', () => {
    expect(compiled.graphHash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('compile — determinism & errors', () => {
  it('is byte-deterministic across runs', () => {
    const a = compile(coinTrailBundle, V1_CATALOG, 'webgpu');
    const b = compile(coinTrailBundle, V1_CATALOG, 'webgpu');
    expect(a.emitSrc).toBe(b.emitSrc);
    expect(a.updateSrc).toBe(b.updateSrc);
  });

  it('throws CompileError on a graph missing a required output', () => {
    const bad = structuredClone(coinTrailBundle);
    bad.system.graph.nodes = bad.system.graph.nodes.filter((n) => n.id !== 'n4');
    bad.system.graph.edges = bad.system.graph.edges.filter((e) => e.to.nodeId !== 'n4');
    expect(() => compile(bad, V1_CATALOG, 'webgpu')).toThrow(CompileError);
    try {
      compile(bad, V1_CATALOG, 'webgpu');
    } catch (e) {
      expect((e as CompileError).diagnostics.some((d) => d.code === 'V004_MISSING_OUTPUT')).toBe(true);
    }
  });

  it('rejects the webgl2 backend in M1', () => {
    expect(() => compile(coinTrailBundle, V1_CATALOG, 'webgl2')).toThrow(/NotImplemented/);
  });
});
