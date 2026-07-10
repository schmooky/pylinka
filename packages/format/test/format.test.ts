import { describe, expect, it } from 'vitest';
import { V1_CATALOG } from '@pylinka/graph';
import type { NodeCatalog, PylinkaProject } from '@pylinka/graph';
import { migrateDocument, parseProject, serializeProject } from '../src/index.js';

function project(over: Partial<PylinkaProject> = {}): PylinkaProject {
  return {
    format: 'pylinka/v1',
    version: 1,
    catalogVersion: 1,
    id: 'uuid-1',
    name: 'Demo',
    createdAt: '2026-07-10T00:00:00Z',
    updatedAt: '2026-07-10T00:00:00Z',
    params: [],
    assets: [],
    systems: [
      {
        id: 's1', name: 'sys', capacity: 1024, blendMode: 'add', enabled: true, space: 'world',
        emitter: { mode: 'flow', rate: 10 },
        graph: {
          nodes: [
            { id: 'n1', kind: 'shape.point', values: { offset: { t: 'vec2', v: [0, 0] } } },
            { id: 'n2', kind: 'output.spawnPosition' },
            { id: 'n3', kind: 'output.initLife', values: { life: { t: 'f32', v: 1 } } },
          ],
          edges: [{ id: 'e1', from: { nodeId: 'n1', portId: 'pos' }, to: { nodeId: 'n2', portId: 'pos' } }],
        },
      },
    ],
    ...over,
  };
}

describe('parseProject', () => {
  it('round-trips a valid project (no diagnostics)', () => {
    const json = JSON.stringify(project());
    const { project: p, diagnostics } = parseProject(json, V1_CATALOG);
    expect(diagnostics).toEqual([]);
    expect(p.name).toBe('Demo');
    expect(p.systems[0]!.graph.nodes).toHaveLength(3);
  });

  it('preserves an unknown kind as a placeholder (E201), never dropping data', () => {
    const p = project();
    p.systems[0]!.graph.nodes.push({ id: 'nX', kind: 'future.node', values: { foo: { t: 'f32', v: 7 } } });
    const { project: parsed, diagnostics } = parseProject(JSON.stringify(p), V1_CATALOG);
    expect(diagnostics.some((d) => d.code === 'E201_UNKNOWN_KIND_PRESERVED' && d.nodeId === 'nX')).toBe(true);
    const kept = parsed.systems[0]!.graph.nodes.find((n) => n.id === 'nX');
    expect(kept?.kind).toBe('future.node');
    expect(kept?.values?.foo).toEqual({ t: 'f32', v: 7 }); // raw data preserved
  });

  it('applies catalog aliases on load', () => {
    const aliased: NodeCatalog = {
      version: 1,
      schemas: V1_CATALOG.schemas,
      aliases: new Map([['legacy.point', 'shape.point']]),
    };
    const p = project();
    p.systems[0]!.graph.nodes[0]!.kind = 'legacy.point';
    const { project: parsed, diagnostics } = parseProject(JSON.stringify(p), aliased);
    expect(parsed.systems[0]!.graph.nodes[0]!.kind).toBe('shape.point');
    expect(diagnostics).toEqual([]);
  });

  it('throws on malformed JSON (not preservable)', () => {
    expect(() => parseProject('{ not json', V1_CATALOG)).toThrow();
  });
});

describe('serializeProject', () => {
  it('emits blob refs unchanged when not inlining', async () => {
    const p = project({
      assets: [{ id: 'a1', name: 'x', width: 8, height: 8, source: { kind: 'blob', blobId: 'b1' } }],
    });
    const out = JSON.parse(await serializeProject(p, { inlineAssets: false }));
    expect(out.assets[0].source).toEqual({ kind: 'blob', blobId: 'b1' });
  });

  it('inlines blob assets as data URIs with a loader', async () => {
    const p = project({
      assets: [{ id: 'a1', name: 'x', width: 8, height: 8, source: { kind: 'blob', blobId: 'b1' } }],
    });
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
    const out = JSON.parse(
      await serializeProject(p, { inlineAssets: true, assetLoader: async () => blob }),
    );
    expect(out.assets[0].source.kind).toBe('inline');
    expect(out.assets[0].source.src).toBe('data:image/png;base64,AQIDBA==');
  });

  it('throws when inlining a blob asset without a loader', async () => {
    const p = project({
      assets: [{ id: 'a1', name: 'x', width: 8, height: 8, source: { kind: 'blob', blobId: 'b1' } }],
    });
    await expect(serializeProject(p, { inlineAssets: true })).rejects.toThrow(/assetLoader/);
  });
});

describe('migrateDocument', () => {
  it('passes a current v1 document through', () => {
    const p = project();
    expect(migrateDocument(JSON.parse(JSON.stringify(p))).version).toBe(1);
  });

  it('throws on an unknown format', () => {
    expect(() => migrateDocument({ format: 'other/v9', version: 1 })).toThrow(/Unknown project format/);
  });

  it('throws on a version newer than supported', () => {
    expect(() => migrateDocument({ format: 'pylinka/v1', version: 99 })).toThrow(/newer than/);
  });

  it('throws on a non-object', () => {
    expect(() => migrateDocument(null)).toThrow();
  });
});
