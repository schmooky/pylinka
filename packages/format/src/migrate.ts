/**
 * Document migration (REQUIREMENTS.md §8, §11.6). Pure `migrate[n→n+1]` chain.
 * Throws on an unknown format or a version newer than supported; upgrades older
 * versions in place. v1 is current, so the chain is empty today.
 */
import type { PylinkaProject } from '@pylinka/graph';

export const CURRENT_VERSION = 1;

type Doc = Record<string, unknown>;
type Migration = (doc: Doc) => Doc;

/** version n → n+1 upgraders. Add entries as the format evolves. */
const MIGRATIONS: Record<number, Migration> = {};

export function migrateDocument(doc: unknown): PylinkaProject {
  if (typeof doc !== 'object' || doc === null) {
    throw new Error('Not a pylinka document (expected an object).');
  }
  const d = doc as Doc;
  if (d.format !== 'pylinka/v1') {
    throw new Error(`Unknown project format "${String(d.format)}" (expected "pylinka/v1").`);
  }
  let version = typeof d.version === 'number' ? d.version : 1;
  if (version > CURRENT_VERSION) {
    throw new Error(
      `Document version ${version} is newer than this build supports (${CURRENT_VERSION}).`,
    );
  }
  let cur: Doc = d;
  while (version < CURRENT_VERSION) {
    const m = MIGRATIONS[version];
    if (m === undefined) throw new Error(`No migration available from version ${version}.`);
    cur = m(cur);
    version += 1;
    cur.version = version;
  }
  return cur as unknown as PylinkaProject;
}
