/**
 * @pylinka/format — the versionable `pylinka` project format (REQUIREMENTS.md
 * §8, §11.6). Parse, serialize (inline↔blob assets), migrate,
 * and bundle as a zip with external assets.
 */
export { parseProject } from './parse.js';
export { serializeProject, type SerializeOptions } from './serialize.js';
export { migrateDocument, CURRENT_VERSION } from './migrate.js';
export {
  externalizeAssets,
  internalizeAssets,
  bundleProject,
  unbundleProject,
  BUNDLE_FORMAT,
  type ExternalAsset,
  type ExternalizeOptions,
  type BundleMeta,
  type BundleOptions,
} from './bundle.js';
export { writeZip, readZip, type ZipEntry } from './zip.js';
