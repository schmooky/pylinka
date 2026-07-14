/**
 * Shared-kernel types for Pylinka. Verbatim from REQUIREMENTS.md §11.1–§11.2.
 *
 * These are the ONLY authoritative type definitions for the graph model, the
 * project format, and the node-catalog schema. No package may fork or "improve"
 * these signatures (§0 rule 2).
 */

// ---------------------------------------------------------------------------
// §11.1 — Core model
// ---------------------------------------------------------------------------

export type PortType = 'f32' | 'vec2' | 'vec4' | 'color' | 'bool';
export type EvalTime = 'init' | 'update' | 'both';
export type Impact = 'low' | 'medium' | 'high';
export type Backend = 'webgpu' | 'webgl2';

export type Literal =
  | { t: 'f32'; v: number }
  | { t: 'vec2'; v: [number, number] }
  | { t: 'vec4'; v: [number, number, number, number] }
  | { t: 'color'; v: string } // '#rrggbbaa' lowercase, always 8 digits
  | { t: 'bool'; v: boolean };

export interface Node {
  /** unique within graph, /^n[0-9]+$/ when editor-created */
  id: string;
  /** must exist in NodeCatalog (after alias resolution) */
  kind: string;
  /** Structural params: change generated-code SHAPE. Hashed. Recompile on change. */
  structural?: Record<string, string>;
  /**
   * Value defaults for UNCONNECTED input ports, keyed by portId. Live-tweakable
   * (uniform slots). A connected port ignores its entry (kept for
   * reconnect-friendliness).
   */
  values?: Record<string, Literal>;
  /** portId → ParamDef.id (promotion). */
  knobBindings?: Record<string, string>;
}

export interface Edge {
  id: string;
  from: { nodeId: string; portId: string };
  to: { nodeId: string; portId: string };
}

export interface Graph {
  nodes: Node[];
  edges: Edge[];
}

export interface ParamDef {
  /** 'p1' */
  id: string;
  /** /^[a-zA-Z_][a-zA-Z0-9_]*$/ */
  name: string;
  type: 'f32' | 'vec2' | 'color';
  /** f32 only */
  min?: number;
  max?: number;
  /** 'log' requires min !== undefined && min > 0 */
  scale: 'linear' | 'log';
  default: Literal;
  unit?: string;
  group?: string;
}

export interface Asset {
  id: string;
  name: string;
  width: number;
  height: number;
  pixiAssetKey?: string;
  source: { kind: 'blob'; blobId: string } | { kind: 'inline'; src: string };
}

export interface EmitterSettings {
  mode: 'flow' | 'burst' | 'once';
  /** particles/second (flow) */
  rate: number;
  /** particles per px of emitter travel (flow) */
  rateOverDistance?: number;
  /** burst mode: count every interval seconds */
  burst?: { count: number; interval: number };
  /** clamped to 10s, substepped at 1/30 */
  prewarm?: { seconds: number };
}

export interface System {
  id: string;
  name: string;
  /** pool size; draw cost scales with this (§13.8); warn > 262144 */
  capacity: number;
  blendMode: 'normal' | 'add' | 'screen';
  enabled: boolean;
  /** 'local' arrives M2; v1 parser rejects other values */
  space: 'world';
  emitter: EmitterSettings;
  graph: Graph;
}

export interface PylinkaProject {
  format: 'pylinka/v1';
  /** integer, starts at 1 */
  version: number;
  catalogVersion: number;
  id: string;
  name: string;
  /** ISO-8601 */
  createdAt: string;
  updatedAt: string;
  params: ParamDef[];
  assets: Asset[];
  systems: System[];
  /** presentation-only: never hashed, never read by runtime */
  editor?: EditorViewState;
}

export interface EditorViewState {
  viewport: { x: number; y: number; zoom: number };
  nodePositions: Record<string, { x: number; y: number }>;
  activeSystemId?: string;
}

export interface SystemBundle {
  system: System;
  params: ParamDef[];
  assets: Asset[];
}

// ---------------------------------------------------------------------------
// §11.2 — NodeSchema & catalog
// ---------------------------------------------------------------------------

export interface PortSpec {
  id: string;
  type: PortType;
  /**
   * Inputs only: default literal when unconnected → materializes a value slot.
   * Required on every input port (no "must-connect" inputs in v1).
   */
  defaultValue?: Literal;
}

export interface StructuralSpec {
  key: string;
  options: string[];
  default: string;
}

export type NodeNamespace =
  | 'input'
  | 'param'
  | 'gen'
  | 'math'
  | 'field'
  | 'shape'
  | 'output'
  | 'tex';

export interface NodeSchema {
  /** 'namespace.name' */
  kind: string;
  label: string;
  namespace: NodeNamespace;
  evalTime: EvalTime | 'inferred';
  impact: Impact;
  impactNote?: string;
  /** gen.* only */
  rngClass?: 'stable' | 'frame';
  inputs: PortSpec[];
  outputs: PortSpec[];
  structural: StructuralSpec[];
  codegen: NodeCodegen;
}

export interface NodeCatalog {
  version: number;
  schemas: ReadonlyMap<string, NodeSchema>;
  /** old kind → new kind, applied on document load */
  aliases: ReadonlyMap<string, string>;
}

/** A WGSL/GLSL expression string, e.g. 'V[3].xy' or 't_n11'. */
export type Expr = string;

export interface CodegenCtx {
  /** reads the slot bound to (nodeId, portId), type-correct swizzle */
  valueSlot(portId: string): Expr;
  knobSlot(paramId: string): Expr;
  /** [0,1), constant per particle life; static index auto-assigned */
  stableRandom(): Expr;
  /** [0,1), per frame; update-eval only (enforced) */
  frameRandom(): Expr;
  /** register an ease (default 'linear') and return its function name (§13.9) */
  ease(key: string | undefined): Expr;
  /** emit a statement (multi-line nodes) */
  line(stmt: string): void;
  /** fresh declared temp name */
  temp(type: PortType): string;
  /** ALWAYS use instead of raw '/' (§13.10) */
  safeDiv(a: Expr, b: Expr): Expr;
  safeNormalize(v: Expr): Expr;
  readonly consts: { PI: Expr; DT: Expr; TIME: Expr; AGE_N: Expr };
}

export interface NodeEmit {
  outputs: Record<string, Expr>;
}

export type NodeCodegen = (
  ctx: CodegenCtx,
  /** connected → upstream temp; unconnected → valueSlot() */
  inputs: Record<string, Expr>,
  structural: Record<string, string>,
) => NodeEmit;

// ---------------------------------------------------------------------------
// §12.2 / §11.4 — Uniform layout (produced by assignSlots, consumed by compiler)
// ---------------------------------------------------------------------------

export interface SlotEntry {
  /** index into the vec4 value array */
  slot: number;
  type: PortType | ParamDef['type'];
  origin:
    | { kind: 'nodeValue'; nodeId: string; portId: string }
    | { kind: 'knob'; paramId: string };
}

export interface UniformLayout {
  /** ≥ 1 (emit a 1-length array even if unused) */
  slotCount: number;
  entries: SlotEntry[];
  /** 48 — §13.3 */
  systemUniformsSize: number;
}

// ---------------------------------------------------------------------------
// §12.3 — Diagnostics
// ---------------------------------------------------------------------------

export type DiagnosticCode =
  | 'V001_UNKNOWN_KIND'
  | 'V002_TYPE_MISMATCH'
  | 'V003_CYCLE'
  | 'V004_MISSING_OUTPUT'
  | 'V005_DUPLICATE_WRITER'
  | 'V006_SETVEL_WITH_ADDFORCE'
  | 'V007_EVALTIME'
  | 'V008_IMPURE_BOTH'
  | 'V009_MULTI_EDGE_INTO_PORT'
  | 'V010_UNKNOWN_PARAM'
  | 'V011_UNKNOWN_ASSET'
  | 'V012_BAD_LOG_PARAM'
  | 'W101_CAPACITY_OVERFLOW'
  | 'W102_HIGH_IMPACT'
  | 'W103_DEAD_NODE'
  | 'E201_UNKNOWN_KIND_PRESERVED';

export interface Diagnostic {
  code: DiagnosticCode;
  severity: 'error' | 'warning';
  /** human sentence, includes names not just ids */
  message: string;
  nodeId?: string;
  portId?: string;
  edgeId?: string;
  paramId?: string;
  assetId?: string;
}
