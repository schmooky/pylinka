import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { V1_CATALOG } from '@pylinka/graph';
import type { PylinkaProject } from '@pylinka/graph';
import {
  BUNDLE_FORMAT,
  bundleProject,
  externalizeAssets,
  internalizeAssets,
  parseProject,
  readZip,
  unbundleProject,
  writeZip,
  type BundleMeta,
} from '../src/index.js';

const PNG_A = 'data:image/png;base64,' + Buffer.from('png-bytes-a').toString('base64');
const PNG_B = 'data:image/png;base64,' + Buffer.from('png-bytes-b').toString('base64');
const WEBP = 'data:image/webp;base64,' + Buffer.from('webp-bytes').toString('base64');

type EditorLike = PylinkaProject & Record<string, unknown>;

function project(): EditorLike {
  return {
    format: 'pylinka/v1',
    version: 1,
    catalogVersion: 1,
    id: 'uuid-1',
    name: 'Coin Burst',
    createdAt: '2026-07-10T00:00:00Z',
    updatedAt: '2026-07-10T00:00:00Z',
    params: [],
    assets: [
      { id: 'a1', name: 'Spark', width: 8, height: 8, source: { kind: 'inline', src: PNG_A } },
    ],
    systems: [
      {
        id: 's1',
        name: 'sys',
        capacity: 1024,
        blendMode: 'add',
        enabled: true,
        space: 'world',
        emitter: { mode: 'flow', rate: 10 },
        graph: {
          nodes: [{ id: 'n1', kind: 'output.initLife', values: { life: { t: 'f32', v: 1 } } }],
          edges: [],
        },
      },
    ],
    // editor-only keys the format does not know about
    textures: [{ id: 't1', name: 'Flame', src: PNG_B, frames: [PNG_A, WEBP] }],
    systemMasks: { s1: { src: WEBP, width: 100, offset: [0, 0] } },
    references: [{ id: 'r1', name: 'Background', src: 'https://example.com/bg.png' }],
  };
}

describe('externalizeAssets', () => {
  it('lifts every data URI out and leaves relative paths', async () => {
    const src = project();
    const { project: p, assets } = await externalizeAssets(src);
    const json = JSON.stringify(p);
    expect(json).not.toContain('data:');
    expect(p.assets[0]!.source).toEqual({ kind: 'inline', src: 'assets/spark.png' });
    const tex = (p.textures as { src: string; frames: string[] }[])[0]!;
    expect(tex.src).toBe('assets/flame.png');
    // identical bytes are stored once and shared
    expect(tex.frames[0]).toBe('assets/spark.png');
    expect(tex.frames[1]).toBe('assets/flame-2.webp');
    expect((p.systemMasks as Record<string, { src: string }>).s1!.src).toBe('assets/flame-2.webp');
    // non-data URLs are left alone
    expect((p.references as { src: string }[])[0]!.src).toBe('https://example.com/bg.png');
    expect(assets.map((a) => a.path).sort()).toEqual([
      'assets/flame-2.webp',
      'assets/flame.png',
      'assets/spark.png',
    ]);
    expect(assets.find((a) => a.path === 'assets/spark.png')!.usedBy).toEqual([
      '/assets/0/source/src',
      '/textures/0/frames/0',
    ]);
    // the input is not mutated
    expect(src.assets[0]!.source).toEqual({ kind: 'inline', src: PNG_A });
  });

  it('exports blob assets when given a loader', async () => {
    const p = project();
    p.assets = [
      { id: 'a2', name: 'Glow', width: 4, height: 4, source: { kind: 'blob', blobId: 'b1' } },
    ];
    const { project: out, assets } = await externalizeAssets(p, {
      assetLoader: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    });
    expect(out.assets[0]!.source).toEqual({ kind: 'inline', src: 'assets/glow.png' });
    expect(assets.find((a) => a.path === 'assets/glow.png')!.data).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('round-trips through internalizeAssets', async () => {
    const src = project();
    const { project: p, assets } = await externalizeAssets(src);
    expect(internalizeAssets(p, assets)).toEqual(src);
  });
});

describe('bundleProject', () => {
  it('writes project.json, meta.json and assets/*, and reads back identical', async () => {
    const src = project();
    const date = new Date('2026-09-29T12:00:00Z');
    const zip = await bundleProject(src, { generator: 'test', date });
    const entries = await readZip(zip);
    expect(entries.map((e) => e.path)).toEqual([
      'meta.json',
      'project.json',
      'assets/spark.png',
      'assets/flame.png',
      'assets/flame-2.webp',
    ]);
    const meta = JSON.parse(new TextDecoder().decode(entries[0]!.data)) as BundleMeta;
    expect(meta.format).toBe(BUNDLE_FORMAT);
    expect(meta.exportedAt).toBe('2026-09-29T12:00:00.000Z');
    expect(meta.generator).toBe('test');
    expect(meta.project).toMatchObject({
      file: 'project.json',
      id: 'uuid-1',
      name: 'Coin Burst',
      systems: [{ id: 's1', name: 'sys' }],
    });
    expect(meta.assets).toHaveLength(3);
    expect(meta.assetBytes).toBe(meta.assets.reduce((n, a) => n + a.bytes, 0));
    expect(meta.assets[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);

    const { json, meta: readMeta } = await unbundleProject(zip);
    expect(readMeta).toEqual(meta);
    expect(JSON.parse(json)).toEqual(src);
    expect(parseProject(json, V1_CATALOG).project.name).toBe('Coin Burst');
  });

  it('is a zip the system unzip accepts', async () => {
    let hasUnzip = true;
    try {
      execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    } catch {
      hasUnzip = false;
    }
    if (!hasUnzip) return;
    const dir = mkdtempSync(join(tmpdir(), 'pylinka-bundle-'));
    writeFileSync(join(dir, 'b.zip'), await bundleProject(project()));
    execFileSync('unzip', ['-q', '-t', 'b.zip'], { cwd: dir });
    execFileSync('unzip', ['-q', 'b.zip', '-d', 'out'], { cwd: dir });
    expect(readFileSync(join(dir, 'out/assets/spark.png'), 'utf8')).toBe('png-bytes-a');
  });
});

describe('readZip', () => {
  it('reads deflate entries written by other tools', async () => {
    let hasZip = true;
    try {
      execFileSync('zip', ['-v'], { stdio: 'ignore' });
    } catch {
      hasZip = false;
    }
    if (!hasZip) return;
    const dir = mkdtempSync(join(tmpdir(), 'pylinka-zip-'));
    writeFileSync(join(dir, 'a.txt'), 'hello '.repeat(200));
    execFileSync('zip', ['-q', '-9', 'x.zip', 'a.txt'], { cwd: dir });
    const entries = await readZip(new Uint8Array(readFileSync(join(dir, 'x.zip'))));
    expect(new TextDecoder().decode(entries[0]!.data)).toBe('hello '.repeat(200));
  });

  it('round-trips writeZip', async () => {
    const data = new TextEncoder().encode('ünïcode');
    const [e] = await readZip(writeZip([{ path: 'dir/ф.txt', data }]));
    expect(e).toEqual({ path: 'dir/ф.txt', data });
  });

  it('rejects non-zip input', async () => {
    await expect(readZip(new Uint8Array(40))).rejects.toThrow(/Not a zip/);
  });
});
