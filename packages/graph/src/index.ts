/**
 * @pylinka/graph — the shared kernel (REQUIREMENTS.md §4.2).
 *
 * Pure TypeScript, zero runtime dependencies. Graph model types, the node
 * catalog, validation, structural hashing, and value-slot assignment. Depended
 * on by the editor (Authoring) and the compiler (Compilation).
 */

export * from './types.js';
export {
  CATALOG_VERSION,
  V1_CATALOG,
  V1_SCHEMAS,
  getSchema,
  resolveKind,
} from './catalog/index.js';
export {
  ACCUMULATING_OUTPUTS,
  ADD_FORCE,
  ALL_OUTPUT_KINDS,
  FORCE_LIKE_OUTPUTS,
  REQUIRED_OUTPUTS,
  SET_VELOCITY,
  SINGLE_WRITER_OUTPUTS,
} from './catalog/output-classes.js';
export { isOutputKind, liveNodeIds } from './live.js';
export { canonicalGraphString, hashGraph } from './hash.js';
export { assignSlots } from './slots.js';
export { coerces, validateGraph } from './validate.js';
