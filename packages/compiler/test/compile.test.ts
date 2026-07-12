import { describe, expect, it } from 'vitest';
import { V1_CATALOG } from '@pylinka/graph';
import { CompileError, compile, WEBGL2_LAYOUT, wgslBodyToGlsl, wgslExprToGlsl } from '../src/index.js';
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

});

describe('compile — webgl2 target (fused TF step shader, §13.12)', () => {
  const compiled = compile(coinTrailBundle, V1_CATALOG, 'webgl2');

  it('step vertex shader matches the golden', async () => {
    await expect(compiled.emitSrc).toMatchFileSnapshot('./golden/coin-spark-trail.step.glsl');
  });

  it('fragment stage matches the golden', async () => {
    await expect(compiled.updateSrc).toMatchFileSnapshot('./golden/coin-spark-trail.step-fs.glsl');
  });

  it('reports its backend and shares the slot layout with webgpu', () => {
    const gpu = compile(coinTrailBundle, V1_CATALOG, 'webgpu');
    expect(compiled.backend).toBe('webgl2');
    expect(compiled.uniforms).toEqual(gpu.uniforms);
    expect(compiled.graphHash).toBe(gpu.graphHash);
  });

  it('translates the generated bodies (typed lets, vecNf, ease)', () => {
    const s = compiled.emitSrc;
    expect(s).toContain('float t_n3 = mix(V[4].x, V[3].x, srand(seed, 0u));');
    expect(s).toContain('vec2 t_n5 = mix(V[6].xy, V[5].xy, vec2(srand(seed, 1u), srand(seed, 2u)));');
    expect(s).toContain('vec2 o_spawnLocal = t_n1;');
    expect(s).toContain('uint o_texIndex = 0u;');
    expect(s).toContain('vec2 t_n11 = vec2(cos(t_n10), sin(t_n10)) * t_n9;');
    expect(s).toContain('float easeSel(float t) { float u = 1.0 - t; return 1.0 - u * u * u; }');
    expect(s).toContain('uniform vec4 V[10];');
    expect(s).not.toMatch(/\blet\b/);
    expect(s).not.toMatch(/\bvec[24]f\(/);
  });

  it('is byte-deterministic across runs', () => {
    const again = compile(coinTrailBundle, V1_CATALOG, 'webgl2');
    expect(again.emitSrc).toBe(compiled.emitSrc);
  });

  it('exports the interleaved TF layout the runtime binds', () => {
    expect(WEBGL2_LAYOUT.strideBytes).toBe(56);
    const total = WEBGL2_LAYOUT.attribs.reduce((n, a) => n + a.size * 4, 0);
    expect(total).toBe(WEBGL2_LAYOUT.strideBytes);
    expect(WEBGL2_LAYOUT.varyings).toEqual([
      'o_pos', 'o_vel', 'o_age', 'o_life', 'o_seed', 'o_flags', 'o_color', 'o_size', 'o_rot',
    ]);
  });
});

describe('wgsl → glsl translation', () => {
  it('rewrites select() into a ternary, innermost-first', () => {
    expect(wgslExprToGlsl('select(1.0, clamp(1.0 - x, 0.0, 1.0), r > 0.0)')).toBe(
      '((r > 0.0) ? (clamp(1.0 - x, 0.0, 1.0)) : (1.0))',
    );
    expect(wgslExprToGlsl('select(a, select(b, c, k), m)')).toBe(
      '((m) ? (((k) ? (c) : (b))) : (a))',
    );
  });

  it('rewrites vector comparisons inside any()', () => {
    expect(wgslExprToGlsl('if (any(p.pos < t_min) || any(p.pos > t_max)) { kill = true; }')).toBe(
      'if (any(lessThan(p.pos, t_min)) || any(greaterThan(p.pos, t_max))) { kill = true; }',
    );
  });

  it('renames constructors and casts', () => {
    expect(wgslExprToGlsl('vec2f(f32(i), f32(U.spawnCount)) * vec4f(1.0).xy')).toBe(
      'vec2(float(i), float(U.spawnCount)) * vec4(1.0).xy',
    );
  });

  it('types untyped lets from the temp map and typed lets from the annotation', () => {
    const types = new Map([['t_n1', 'vec2']]);
    expect(wgslBodyToGlsl('  let t_n1 = a + b;\n  let o_x: f32 = t_n1.x;', types)).toBe(
      '  vec2 t_n1 = a + b;\n  float o_x = t_n1.x;',
    );
    expect(() => wgslBodyToGlsl('  let mystery = 1.0;', new Map())).toThrow(/no recorded type/);
  });
});
