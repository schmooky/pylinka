import { describe, expect, it } from 'vitest';
import { V1_CATALOG, validateGraph } from '../src/index.js';
import type {
  DiagnosticCode,
  NodeCatalog,
  NodeSchema,
  SystemBundle,
  System,
} from '../src/index.js';
import { coinTrailBundle } from './fixtures/coin-spark-trail.js';

const codes = (bundle: SystemBundle, catalog: NodeCatalog = V1_CATALOG): DiagnosticCode[] =>
  validateGraph(bundle, catalog).map((d) => d.code);
const has = (bundle: SystemBundle, code: DiagnosticCode, catalog?: NodeCatalog): boolean =>
  codes(bundle, catalog).includes(code);
const cloneBundle = (): SystemBundle => structuredClone(coinTrailBundle);

/** A minimal well-formed single-system bundle (spawnPosition + initLife). */
function minimalBundle(system: Partial<System> = {}): SystemBundle {
  return {
    params: [],
    assets: [],
    system: {
      id: 's',
      name: 'min',
      capacity: 1024,
      blendMode: 'add',
      enabled: true,
      space: 'world',
      emitter: { mode: 'flow', rate: 10 },
      graph: {
        nodes: [
          { id: 'n1', kind: 'shape.point', values: { offset: { t: 'vec2', v: [0, 0] } } },
          { id: 'n2', kind: 'output.spawnPosition' },
          { id: 'n3', kind: 'output.initLife', values: { life: { t: 'f32', v: 1 } } },
        ],
        edges: [{ id: 'e1', from: { nodeId: 'n1', portId: 'pos' }, to: { nodeId: 'n2', portId: 'pos' } }],
      },
      ...system,
    },
  };
}

describe('validateGraph — §12.3', () => {
  it('the §14 golden validates with no errors and no warnings', () => {
    const diags = validateGraph(coinTrailBundle, V1_CATALOG);
    expect(diags).toEqual([]);
  });

  it('minimal well-formed graph is valid', () => {
    expect(validateGraph(minimalBundle(), V1_CATALOG).filter((d) => d.severity === 'error')).toEqual(
      [],
    );
  });

  it('V001 — unknown kind', () => {
    const b = cloneBundle();
    b.system.graph.nodes[0]!.kind = 'nonsense.node';
    expect(has(b, 'V001_UNKNOWN_KIND')).toBe(true);
  });

  it('V002 — incompatible edge types', () => {
    const b = cloneBundle();
    // retarget initLife's life input to the vec2 output of n5 (vec2 → f32 disallowed)
    const e2 = b.system.graph.edges.find((e) => e.id === 'e2')!;
    e2.from = { nodeId: 'n5', portId: 'out' };
    expect(has(b, 'V002_TYPE_MISMATCH')).toBe(true);
  });

  it('V003 — cycle', () => {
    const b = cloneBundle();
    // n9 → n11 (e5) already exists; add n11 → n9 to close a cycle
    b.system.graph.edges.push({ id: 'ecyc', from: { nodeId: 'n11', portId: 'force' }, to: { nodeId: 'n9', portId: 'in' } });
    expect(has(b, 'V003_CYCLE')).toBe(true);
  });

  it('V004 — missing required output', () => {
    const b = cloneBundle();
    b.system.graph.nodes = b.system.graph.nodes.filter((n) => n.id !== 'n4');
    b.system.graph.edges = b.system.graph.edges.filter((e) => e.to.nodeId !== 'n4');
    expect(has(b, 'V004_MISSING_OUTPUT')).toBe(true);
  });

  it('V005 — duplicate single-writer', () => {
    const b = cloneBundle();
    b.system.graph.nodes.push({ id: 'n15', kind: 'output.writeColor' });
    expect(has(b, 'V005_DUPLICATE_WRITER')).toBe(true);
  });

  it('V006 — setVelocity coexisting with addForce', () => {
    const b = cloneBundle();
    b.system.graph.nodes.push({ id: 'n16', kind: 'output.setVelocity' });
    expect(has(b, 'V006_SETVEL_WITH_ADDFORCE')).toBe(true);
  });

  it('V007 — update value feeding an init-only consumer', () => {
    const b = minimalBundle();
    // input.age (update) → output.spawnPosition.pos (init), f32→vec2 splats so no V002
    b.system.graph.nodes.push({ id: 'nage', kind: 'input.age' });
    b.system.graph.edges.push({ id: 'ea', from: { nodeId: 'nage', portId: 'out' }, to: { nodeId: 'n2', portId: 'pos' } });
    // remove the existing edge into n2.pos to avoid V009 masking the case
    b.system.graph.edges = b.system.graph.edges.filter((e) => e.id !== 'e1');
    expect(has(b, 'V007_EVALTIME')).toBe(true);
  });

  it('V008 — a both-eval node depending on an update value', () => {
    const b = minimalBundle();
    // input.age (update) → gen.noise.scale (both) → output.writeScale
    b.system.graph.nodes.push({ id: 'nage', kind: 'input.age' });
    b.system.graph.nodes.push({ id: 'nn', kind: 'gen.noise' });
    b.system.graph.nodes.push({ id: 'nw', kind: 'output.writeScale' });
    b.system.graph.edges.push({ id: 'ea', from: { nodeId: 'nage', portId: 'out' }, to: { nodeId: 'nn', portId: 'scale' } });
    b.system.graph.edges.push({ id: 'eb', from: { nodeId: 'nn', portId: 'out' }, to: { nodeId: 'nw', portId: 'scale' } });
    expect(has(b, 'V008_IMPURE_BOTH')).toBe(true);
  });

  it('V009 — two edges into one input port', () => {
    const b = cloneBundle();
    b.system.graph.edges.push({ id: 'e2b', from: { nodeId: 'n3', portId: 'out' }, to: { nodeId: 'n4', portId: 'life' } });
    expect(has(b, 'V009_MULTI_EDGE_INTO_PORT')).toBe(true);
  });

  it('V010 — param.ref to a missing param', () => {
    const b = cloneBundle();
    b.system.graph.nodes.find((n) => n.id === 'n9')!.structural = { param: 'pMissing' };
    expect(has(b, 'V010_UNKNOWN_PARAM')).toBe(true);
  });

  it('V011 — tex.* referencing a missing asset', () => {
    const b = cloneBundle();
    b.system.graph.nodes.push({ id: 'nt', kind: 'tex.single', structural: { asset: 'missing' } });
    expect(has(b, 'V011_UNKNOWN_ASSET')).toBe(true);
  });

  it('V012 — log-scale param with non-positive min', () => {
    const b = cloneBundle();
    b.params.find((p) => p.id === 'p1')!.min = -5;
    expect(has(b, 'V012_BAD_LOG_PARAM')).toBe(true);
  });

  it('W101 — capacity overflow (warning)', () => {
    const b = cloneBundle();
    b.system.capacity = 100; // rate 200 × maxLife 1.2 = 240 > 100
    expect(has(b, 'W101_CAPACITY_OVERFLOW')).toBe(true);
  });

  it('W102 — high-impact node (warning)', () => {
    // synthesize a catalog with a live high-impact node
    const bigSchema: NodeSchema = {
      kind: 'field.gravity',
      label: 'Gravity (heavy)',
      namespace: 'field',
      evalTime: 'update',
      impact: 'high',
      impactNote: 'Very expensive on low-tier devices.',
      inputs: [{ id: 'g', type: 'vec2', defaultValue: { t: 'vec2', v: [0, 300] } }],
      outputs: [{ id: 'force', type: 'vec2' }],
      structural: [],
      codegen: () => ({ outputs: {} }),
    };
    const schemas = new Map(V1_CATALOG.schemas);
    schemas.set('field.gravity', bigSchema);
    const cat: NodeCatalog = { version: 1, schemas, aliases: V1_CATALOG.aliases };
    expect(has(coinTrailBundle, 'W102_HIGH_IMPACT', cat)).toBe(true);
  });

  it('W103 — dead node (warning)', () => {
    const b = cloneBundle();
    b.system.graph.nodes.push({ id: 'zdead', kind: 'gen.random' });
    expect(has(b, 'W103_DEAD_NODE')).toBe(true);
  });
});
