/**
 * @pylinka/format — the versionable `pylinka` project format (REQUIREMENTS.md
 * §8, §11.6). Parse, serialize (inline↔blob assets), and migrate.
 */
export { parseProject } from './parse.js';
export { serializeProject, type SerializeOptions } from './serialize.js';
export { migrateDocument, CURRENT_VERSION } from './migrate.js';
