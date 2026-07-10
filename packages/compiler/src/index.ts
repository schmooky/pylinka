/**
 * @pylinka/compiler — SystemBundle → GPU program codegen (REQUIREMENTS.md §6,
 * §11.4). WGSL (M1); GLSL ES 3.00 transform-feedback arrives in M2. Pure,
 * deterministic, zero external dependencies.
 */
export { compile } from './compile.js';
export { CompileError, V1_BINDINGS } from './types.js';
export type { BindingLayout, CompiledSystem } from './types.js';
