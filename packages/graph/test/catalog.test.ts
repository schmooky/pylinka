import { describe, expect, it } from 'vitest';
import { CATALOG_VERSION, V1_CATALOG, V1_SCHEMAS, getSchema } from '../src/index.js';

describe('node catalog — §16', () => {
  it('has version 1 and no duplicate kinds', () => {
    expect(V1_CATALOG.version).toBe(CATALOG_VERSION);
    const kinds = V1_SCHEMAS.map((s) => s.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('registers every kind referenced by the §14 golden', () => {
    const golden = [
      'shape.point',
      'output.spawnPosition',
      'gen.randomRange',
      'output.initLife',
      'gen.randomVec2',
      'output.initVelocity',
      'field.gravity',
      'output.addForce',
      'param.ref',
      'field.directional',
      'gen.colorOverLife',
      'output.writeColor',
    ];
    for (const kind of golden) {
      expect(getSchema(V1_CATALOG, kind), kind).toBeDefined();
    }
  });

  it('every input port carries a default literal (§11.2 — no must-connect inputs)', () => {
    for (const s of V1_SCHEMAS) {
      for (const p of s.inputs) {
        expect(p.defaultValue, `${s.kind}.${p.id}`).toBeDefined();
      }
    }
  });

  it('every schema kind is "namespace.name" matching its namespace', () => {
    for (const s of V1_SCHEMAS) {
      expect(s.kind.startsWith(s.namespace + '.'), s.kind).toBe(true);
    }
  });

  it('gen.* nodes with an rngClass tag only', () => {
    for (const s of V1_SCHEMAS) {
      if (s.rngClass !== undefined) expect(s.namespace).toBe('gen');
    }
  });

  it('golden port ids match the compiler contract exactly', () => {
    expect(getSchema(V1_CATALOG, 'shape.point')!.inputs.map((p) => p.id)).toEqual(['offset']);
    expect(getSchema(V1_CATALOG, 'shape.point')!.outputs.map((p) => p.id)).toEqual(['pos']);
    expect(getSchema(V1_CATALOG, 'gen.randomRange')!.inputs.map((p) => p.id)).toEqual(['min', 'max']);
    expect(getSchema(V1_CATALOG, 'field.directional')!.inputs.map((p) => p.id)).toEqual([
      'strength',
      'angle',
    ]);
    expect(getSchema(V1_CATALOG, 'gen.colorOverLife')!.inputs.map((p) => p.id)).toEqual([
      'from',
      'to',
    ]);
  });

  it('M2-only nodes are absent from the v1 catalog', () => {
    for (const kind of ['gen.curl', 'field.vortex', 'field.curlField', 'shape.drawnArea', 'math.expression']) {
      expect(getSchema(V1_CATALOG, kind), kind).toBeUndefined();
    }
  });
});
