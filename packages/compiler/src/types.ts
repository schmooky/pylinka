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

/** Sub-emitter death-burst parameters (from an `output.deathBurst` node). */
export interface BurstConfig {
  /** child pool multiplier + hard per-death cap (structural `max`). The child
   *  pool is sized parentCapacity × max; WebGL2/interpreted run `max` sub-step
   *  passes (one per burst copy), WebGPU loops up to `max` free-list pops. */
  max: number;
}

export interface CompiledSystem {
  graphHash: string;
  backend: Backend;
  /** full kernel source (scaffold + generated body) */
  emitSrc: string;
  updateSrc: string;
  /**
   * Sub-emitter source: for a child that spawns on parent deaths. WebGPU: a
   * `subEmit` compute kernel (run instead of the clock emit; reads parent
   * hot/meta at bindings 8/9 + a `prevAlive` shadow at 10). WebGL2: a fused
   * sub-step that replaces the normal step (reads parent cur/prev state).
   */
  subSrc: string;
  uniforms: UniformLayout;
  bindings: BindingLayout;
  textures: { assetId: string; binding: number }[];
  /** present when the graph has an `output.deathBurst` node — the runtime sizes
   *  the child sub-emitter pool and its draw/dispatch loop from this. */
  burst?: BurstConfig;
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
