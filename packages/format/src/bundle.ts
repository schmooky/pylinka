/**
 * Asset externalization and `.pylinka.zip` bundles.
 *
 * An editor project carries its images as base64 data URIs — texture atlases,
 * sequence frames, emission masks, reference art, inline `assets[]`. That makes
 * one portable file, but the JSON is mostly image bytes (a third bigger than
 * the images themselves), it diffs terribly, and a game that already ships its
 * textures through its own pipeline pays for them twice.
 *
 * `externalizeAssets` lifts every data URI out of the document and leaves a
 * relative path (`assets/flame.png`) in its place. The walk is generic — any
 * string field holding a data URI is moved — so fields the format does not
 * know about (editor-only keys, future ones) are handled the same way.
 *
 * On its own that gives a minimal JSON: the structure, no pixels. Written
 * together with the files and a `meta.json` it is a bundle, which
 * `unbundleProject` turns back into a self-contained document.
 */
import type { PylinkaProject } from '@pylinka/graph';
import { readZip, writeZip, type ZipEntry } from './zip.js';

export const BUNDLE_FORMAT = 'pylinka-bundle/v1';

export interface ExternalAsset {
  /** path inside the bundle, also the value left in the document */
  path: string;
  mime: string;
  data: Uint8Array;
  sha256: string;
  /** JSON pointers of every field that referenced these bytes */
  usedBy: string[];
}

export interface ExternalizeOptions {
  /** folder the files are placed under, default `assets` */
  dir?: string;
  /**
   * Loads blob-referenced `assets[]` entries so they are exported too. Without
   * it those entries keep their blob refs, which only mean something to the
   * storage that wrote them.
   */
  assetLoader?: (blobId: string) => Promise<Blob>;
}

export interface BundleMeta {
  format: typeof BUNDLE_FORMAT;
  /** ISO-8601 */
  exportedAt: string;
  /** what wrote the bundle, e.g. `pylinka-editor` */
  generator?: string;
  project: {
    file: string;
    id: string;
    name: string;
    format: string;
    version: number;
    catalogVersion: number;
    createdAt: string;
    updatedAt: string;
    systems: { id: string; name: string }[];
  };
  assets: { path: string; mime: string; bytes: number; sha256: string; usedBy: string[] }[];
  /** sum of asset bytes — what the minimal JSON leaves out */
  assetBytes: number;
}

export interface BundleOptions extends ExternalizeOptions {
  generator?: string;
  /** timestamp for `meta.exportedAt` and the zip entries, default now */
  date?: Date;
  /** JSON indentation of project.json, default 2 */
  space?: number;
}

const PROJECT_FILE = 'project.json';
const META_FILE = 'meta.json';

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/ktx2': 'ktx2',
};
const MIME: Record<string, string> = Object.fromEntries(
  Object.entries(EXT).map(([m, e]) => [e, m]),
);
MIME.jpeg = 'image/jpeg';

export async function externalizeAssets<T extends PylinkaProject>(
  project: T,
  opts: ExternalizeOptions = {},
): Promise<{ project: T; assets: ExternalAsset[] }> {
  const dir = (opts.dir ?? 'assets').replace(/\/+$/, '');
  const doc = JSON.parse(JSON.stringify(project)) as T;
  const bySha = new Map<string, ExternalAsset>();
  const taken = new Set<string>();

  const place = async (
    bytes: Uint8Array,
    mime: string,
    hint: string,
    pointer: string,
  ): Promise<string> => {
    const sha = await sha256(bytes);
    const existing = bySha.get(sha);
    if (existing) {
      existing.usedBy.push(pointer);
      return existing.path;
    }
    const base = slug(hint) || 'asset';
    const ext = EXT[mime] ?? 'bin';
    let path = `${dir}/${base}.${ext}`;
    for (let i = 2; taken.has(path); i++) path = `${dir}/${base}-${i}.${ext}`;
    taken.add(path);
    bySha.set(sha, { path, mime, data: bytes, sha256: sha, usedBy: [pointer] });
    return path;
  };

  // blob-backed format assets first, so they get their own names
  if (opts.assetLoader) {
    for (let i = 0; i < doc.assets.length; i++) {
      const a = doc.assets[i]!;
      if (a.source.kind !== 'blob') continue;
      const blob = await opts.assetLoader(a.source.blobId);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const mime = blob.type !== '' ? blob.type : 'application/octet-stream';
      a.source = {
        kind: 'inline',
        src: await place(bytes, mime, a.name || a.id, `/assets/${i}/source/src`),
      };
    }
  }

  const walk = async (node: unknown, pointer: string, hint: string): Promise<unknown> => {
    if (typeof node === 'string') {
      const parsed = parseDataUri(node);
      return parsed ? place(parsed.bytes, parsed.mime, hint, pointer) : node;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        node[i] = await walk(node[i], `${pointer}/${i}`, `${hint}-${i + 1}`);
      }
      return node;
    }
    if (node !== null && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      // an object's own name (or id) names its files; the document root's name
      // is the project's, which would prefix every file, so it is skipped
      const own = pointer === '' ? undefined : ownName(o);
      for (const k of Object.keys(o)) {
        const h = own ?? (k === 'src' ? hint : hint ? `${hint}-${k}` : k);
        o[k] = await walk(o[k], `${pointer}/${escapePointer(k)}`, h);
      }
      return o;
    }
    return node;
  };

  await walk(doc, '', '');
  return { project: doc, assets: [...bySha.values()] };
}

/**
 * Put externalized files back into a document as data URIs. Only strings that
 * exactly equal a file's path are replaced.
 */
export function internalizeAssets<T>(
  project: T,
  files: Iterable<{ path: string; data: Uint8Array; mime?: string }>,
): T {
  const map = new Map<string, string>();
  for (const f of files)
    map.set(f.path, `data:${f.mime ?? mimeForPath(f.path)};base64,${base64(f.data)}`);
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return map.get(node) ?? node;
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) o[k] = walk(v);
      return o;
    }
    return node;
  };
  return walk(project) as T;
}

/** Build a `.pylinka.zip`: `project.json`, `meta.json` and `assets/*`. */
export async function bundleProject(
  project: PylinkaProject,
  opts: BundleOptions = {},
): Promise<Uint8Array> {
  const date = opts.date ?? new Date();
  const { project: doc, assets } = await externalizeAssets(project, opts);
  const meta: BundleMeta = {
    format: BUNDLE_FORMAT,
    exportedAt: date.toISOString(),
    ...(opts.generator !== undefined ? { generator: opts.generator } : {}),
    project: {
      file: PROJECT_FILE,
      id: doc.id,
      name: doc.name,
      format: doc.format,
      version: doc.version,
      catalogVersion: doc.catalogVersion,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      systems: doc.systems.map((s) => ({ id: s.id, name: s.name })),
    },
    assets: assets.map((a) => ({
      path: a.path,
      mime: a.mime,
      bytes: a.data.length,
      sha256: a.sha256,
      usedBy: a.usedBy,
    })),
    assetBytes: assets.reduce((n, a) => n + a.data.length, 0),
  };
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [
    { path: META_FILE, data: enc.encode(JSON.stringify(meta, null, 2)) },
    { path: PROJECT_FILE, data: enc.encode(JSON.stringify(doc, null, opts.space ?? 2)) },
    ...assets.map((a) => ({ path: a.path, data: a.data })),
  ];
  return writeZip(entries, date);
}

/**
 * Open a `.pylinka.zip` and return a self-contained document (assets inlined
 * again) plus its meta. The project text is returned unparsed-by-catalog so the
 * caller runs it through `parseProject` like any other file.
 */
export async function unbundleProject(
  bytes: Uint8Array,
): Promise<{ json: string; meta: BundleMeta | undefined }> {
  const entries = await readZip(bytes);
  const dec = new TextDecoder();
  const metaEntry = entries.find((e) => e.path === META_FILE);
  const meta = metaEntry ? (JSON.parse(dec.decode(metaEntry.data)) as BundleMeta) : undefined;
  const projectPath = meta?.project.file ?? PROJECT_FILE;
  const projectEntry =
    entries.find((e) => e.path === projectPath) ??
    entries.find((e) => e.path !== META_FILE && e.path.endsWith('.json'));
  if (!projectEntry) throw new Error('Bundle has no project JSON.');
  const mimes = new Map(meta?.assets.map((a) => [a.path, a.mime]));
  const files = entries
    .filter((e) => e !== projectEntry && e !== metaEntry)
    .map((e) => ({ path: e.path, data: e.data, mime: mimes.get(e.path) }));
  const doc = internalizeAssets(JSON.parse(dec.decode(projectEntry.data)) as unknown, files);
  return { json: JSON.stringify(doc), meta };
}

// ---------------------------------------------------------------------------

function parseDataUri(s: string): { mime: string; bytes: Uint8Array } | undefined {
  if (!s.startsWith('data:')) return undefined;
  const comma = s.indexOf(',');
  if (comma < 0) return undefined;
  const header = s.slice(5, comma);
  const body = s.slice(comma + 1);
  const parts = header.split(';');
  const mime = parts[0] || 'text/plain';
  if (parts.includes('base64')) return { mime, bytes: unbase64(body) };
  return { mime, bytes: new TextEncoder().encode(decodeURIComponent(body)) };
}

function ownName(o: Record<string, unknown>): string | undefined {
  if (typeof o.name === 'string' && o.name !== '') return o.name;
  if (typeof o.id === 'string' && o.id !== '') return o.id;
  return undefined;
}

function mimeForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function escapePointer(k: string): string {
  return k.replace(/~/g, '~0').replace(/\//g, '~1');
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NodeBuffer = (globalThis as any).Buffer;

function base64(bytes: Uint8Array): string {
  if (NodeBuffer !== undefined) return NodeBuffer.from(bytes).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function unbase64(s: string): Uint8Array {
  if (NodeBuffer !== undefined) return new Uint8Array(NodeBuffer.from(s, 'base64'));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
