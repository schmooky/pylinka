/**
 * Compiler-context types (REQUIREMENTS.md §11.4). CompiledSystem is what the
 * runtime consumes; UniformLayout/SlotEntry/Backend/Diagnostic come from
 * @pylinka/graph.
 */
import type { Backend, Diagnostic, UniformLayout } from '@pylinka/graph';

/** Fixed v1 compute bind-group layout (§13.2). Do not renumber. */
export interface BindingLayout {
  group: number;
  uniforms: number; // U: SystemUniforms
  valueTable: number; // V: array<vec4f, SLOTS>
  hot: number;
  rnd: number;
  meta: number;
  counters: number;
  freeList: number;
  /** emission-mask point table (emit kernel only, WebGPU) */
  maskTable: number;
}

export const V1_BINDINGS: BindingLayout = {
  group: 0,
  uniforms: 0,
  valueTable: 1,
  hot: 2,
  rnd: 3,
  meta: 4,
  counters: 5,
  freeList: 6,
  maskTable: 7,
};

export interface CompiledSystem {
  graphHash: string;
  backend: Backend;
  /** full kernel source (scaffold + generated body) */
  emitSrc: string;
  updateSrc: string;
  uniforms: UniformLayout;
  bindings: BindingLayout;
  textures: { assetId: string; binding: number }[];
  /** warnings only (errors throw) */
  diagnostics: Diagnostic[];
}

/** Thrown by compile() on invalid input; carries the blocking diagnostics. */
export class CompileError extends Error {
  readonly diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    const errs = diagnostics.filter((d) => d.severity === 'error');
    super(
      `Compilation failed with ${errs.length} error(s): ` +
        errs.map((d) => `${d.code} ${d.message}`).join('; '),
    );
    this.name = 'CompileError';
    this.diagnostics = diagnostics;
  }
}
