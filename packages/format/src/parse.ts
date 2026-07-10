/**
 * parseProject (REQUIREMENTS.md §11.6, §8). Parses a document, upgrades it via
 * the migration chain, applies catalog kind aliases on load, and wraps unknown
 * kinds in preserved placeholders (E201) — never throws on preservable content.
 */
import type { Diagnostic, NodeCatalog, PylinkaProject } from '@pylinka/graph';
import { getSchema, resolveKind } from '@pylinka/graph';
import { migrateDocument } from './migrate.js';

export function parseProject(
  json: string,
  catalog: NodeCatalog,
): { project: PylinkaProject; diagnostics: Diagnostic[] } {
  const raw: unknown = JSON.parse(json); // malformed JSON is not preservable → throws
  const project = migrateDocument(raw);
  const diagnostics: Diagnostic[] = [];

  for (const system of project.systems) {
    for (const node of system.graph.nodes) {
      // apply alias table on load (§8)
      const resolved = resolveKind(catalog, node.kind);
      if (resolved !== node.kind) node.kind = resolved;

      if (getSchema(catalog, node.kind) === undefined) {
        // unknown kind: preserve the node's raw JSON, badge it, block compile
        diagnostics.push({
          code: 'E201_UNKNOWN_KIND_PRESERVED',
          severity: 'error',
          message: `Unknown node kind "${node.kind}" in system "${system.name}" was preserved as a placeholder; the system will not compile until it is resolved.`,
          nodeId: node.id,
        });
      }
    }
  }

  return { project, diagnostics };
}
