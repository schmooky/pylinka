/**
 * Node catalog assembly (REQUIREMENTS.md §5.2). The catalog is the single source
 * of truth for node schemas, shared by Authoring (editor) and Compilation.
 */
import type { NodeCatalog, NodeSchema } from '../types.js';
import { V1_SCHEMAS } from './schemas.js';

export const CATALOG_VERSION = 1;

/**
 * Kind alias table (old kind → new kind), applied on document load (§8). Empty
 * at v1; entries are added when kinds are renamed so old projects keep loading.
 */
const V1_ALIASES: ReadonlyArray<readonly [string, string]> = [];

function buildCatalog(version: number, schemas: readonly NodeSchema[]): NodeCatalog {
  const map = new Map<string, NodeSchema>();
  for (const s of schemas) {
    if (map.has(s.kind)) {
      throw new Error(`Duplicate node kind in catalog: ${s.kind}`);
    }
    map.set(s.kind, s);
  }
  return {
    version,
    schemas: map,
    aliases: new Map(V1_ALIASES),
  };
}

/** The frozen v1 catalog. */
export const V1_CATALOG: NodeCatalog = buildCatalog(CATALOG_VERSION, V1_SCHEMAS);

/**
 * Resolve a raw node kind through the alias table.
 * Returns the input unchanged when no alias applies.
 */
export function resolveKind(catalog: NodeCatalog, kind: string): string {
  return catalog.aliases.get(kind) ?? kind;
}

/** Look up a schema, resolving aliases first. `undefined` = unknown kind. */
export function getSchema(catalog: NodeCatalog, kind: string): NodeSchema | undefined {
  return catalog.schemas.get(resolveKind(catalog, kind));
}

export { V1_SCHEMAS } from './schemas.js';
