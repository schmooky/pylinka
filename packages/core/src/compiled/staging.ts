/**
 * Value-table staging for the compiled backends (REQUIREMENTS.md §12.2, §13.3).
 * The compiler's UniformLayout maps every inline literal and knob to a vec4
 * slot; this table is the CPU staging copy flushed to the GPU each frame. Knob
 * slots re-read the KnobStore every frame (alloc-free); node-value slots
 * re-read the graph only on init/apply (a value scrub in the editor swaps the
 * project object, never recompiles).
 */
import type { Literal, ParamDef, System, UniformLayout } from '@pylinka/graph';
import type { KnobStore } from '../knobs.js';

/** Parse '#rrggbbaa' (lowercase, 8 digits — the Literal color format) into out. */
export function writeHexColor(hex: string, out: Float32Array, offset: number): void {
  const n = parseInt(hex.slice(1), 16) >>> 0;
  out[offset] = ((n >>> 24) & 0xff) / 255;
  out[offset + 1] = ((n >>> 16) & 0xff) / 255;
  out[offset + 2] = ((n >>> 8) & 0xff) / 255;
  out[offset + 3] = (n & 0xff) / 255;
}

/** Write one Literal into a vec4 slot (padding with zeroes). */
export function writeLiteral(lit: Literal, out: Float32Array, offset: number): void {
  out[offset] = 0;
  out[offset + 1] = 0;
  out[offset + 2] = 0;
  out[offset + 3] = 0;
  switch (lit.t) {
    case 'f32':
      out[offset] = lit.v;
      break;
    case 'vec2':
      out[offset] = lit.v[0];
      out[offset + 1] = lit.v[1];
      break;
    case 'vec4':
      out[offset] = lit.v[0];
      out[offset + 1] = lit.v[1];
      out[offset + 2] = lit.v[2];
      out[offset + 3] = lit.v[3];
      break;
    case 'color':
      writeHexColor(lit.v, out, offset);
      break;
    case 'bool':
      out[offset] = lit.v ? 1 : 0;
      break;
  }
}

interface NodeSlot {
  slot: number;
  nodeId: string;
  portId: string;
}

interface KnobSlot {
  slot: number;
  name: string;
}

/** CPU staging for the §13.3 value table `V: array<vec4f, SLOTS>`. */
export class ValueTable {
  /** 4 floats per slot — upload this whole array every frame (§13.11 step 4) */
  readonly data: Float32Array<ArrayBuffer>;
  private readonly nodeSlots: NodeSlot[] = [];
  private readonly knobSlots: KnobSlot[] = [];

  constructor(layout: UniformLayout, params: ParamDef[]) {
    this.data = new Float32Array(4 * layout.slotCount);
    const nameOf = new Map<string, string>();
    for (const p of params) nameOf.set(p.id, p.name);
    for (const e of layout.entries) {
      if (e.origin.kind === 'knob') {
        this.knobSlots.push({ slot: e.slot, name: nameOf.get(e.origin.paramId) ?? e.origin.paramId });
      } else {
        this.nodeSlots.push({ slot: e.slot, nodeId: e.origin.nodeId, portId: e.origin.portId });
      }
    }
  }

  /** Re-read inline node values from the graph (init / apply — may allocate). */
  refreshNodeValues(system: System): void {
    const byId = new Map(system.graph.nodes.map((n) => [n.id, n]));
    for (const s of this.nodeSlots) {
      const lit = byId.get(s.nodeId)?.values?.[s.portId];
      if (lit !== undefined) writeLiteral(lit, this.data, s.slot * 4);
    }
  }

  /** Pull current knob values into their slots (every frame — alloc-free). */
  refreshKnobs(knobs: KnobStore): void {
    for (const s of this.knobSlots) knobs.vec4(s.name, this.data, s.slot * 4);
  }
}

/** TS mirror of the §13.4 pcg for advancing baseSeed on the CPU. */
export function pcg(v: number): number {
  const s = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> (((s >>> 28) + 4) & 31)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
