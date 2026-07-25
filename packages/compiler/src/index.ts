/**
 * @pylinka/compiler — SystemBundle → GPU program codegen (REQUIREMENTS.md §6,
 * §11.4). Two targets: 'webgpu' emits WGSL compute kernels (§13.5–§13.6);
 * 'webgl2' emits a fused GLSL ES 3.00 transform-feedback step shader
 * (§13.12 — emitSrc is the step vertex shader, updateSrc the discard fragment
 * stage). Pure, deterministic, zero external dependencies.
 */
export { compile } from './compile.js';
export { CompileError, V1_BINDINGS } from './types.js';
export type { BindingLayout, CompiledSystem } from './types.js';
export { WEBGL2_LAYOUT } from './glsl.js';
export type { Webgl2Attrib, Webgl2Layout } from './glsl.js';
export { wgslBodyToGlsl, wgslExprToGlsl } from './translate.js';
// Easing catalog — the single source of truth (§13.9). `sampleEase` lets the
// editor plot the exact curve the shaders run; presets + custom cubic-bezier.
export {
  EASE_BODIES,
  EASE_KEYS,
  sampleEase,
  parseCubicBezier,
  isCustomEase,
  easeFnName,
  type CubicBezier,
} from './ease.js';
