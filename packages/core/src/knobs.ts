/**
 * Knob store implementing the KnobBus contract (REQUIREMENTS.md §11.5).
 * Holds the current vec4 value per named knob; systems pull these into their
 * value table each frame. `set`/`get` are O(1) and allocation-free once a knob
 * is registered (registration happens at construction from the ParamDefs, or
 * lazily on first set of an unknown name — a create-path allocation).
 */
import type { ParamDef } from '@pylinka/graph';

export interface KnobBus {
  set(name: string, x: number, y?: number, z?: number, w?: number): void;
  get(name: string): number;
}

export class KnobStore implements KnobBus {
  private readonly values = new Map<string, Float32Array>();

  constructor(params: ParamDef[] = []) {
    for (const p of params) {
      const a = new Float32Array(4);
      const d = p.default;
      if (d.t === 'f32') a[0] = d.v;
      else if (d.t === 'vec2') {
        a[0] = d.v[0];
        a[1] = d.v[1];
      } else if (d.t === 'color') {
        // '#rrggbbaa' (always 8 lowercase hex digits — §11.1 Literal)
        const n = parseInt(d.v.slice(1), 16) >>> 0;
        a[0] = ((n >>> 24) & 0xff) / 255;
        a[1] = ((n >>> 16) & 0xff) / 255;
        a[2] = ((n >>> 8) & 0xff) / 255;
        a[3] = (n & 0xff) / 255;
      }
      this.values.set(p.name, a);
    }
  }

  set(name: string, x: number, y = 0, z = 0, w = 0): void {
    let a = this.values.get(name);
    if (a === undefined) {
      a = new Float32Array(4); // create-path allocation for an unregistered knob
      this.values.set(name, a);
    }
    a[0] = x;
    a[1] = y;
    a[2] = z;
    a[3] = w;
  }

  get(name: string): number {
    return this.values.get(name)?.[0] ?? 0;
  }

  /** Read all four components (used by the uniform flush). */
  vec4(name: string, out: Float32Array, offset: number): void {
    const a = this.values.get(name);
    if (a === undefined) {
      out[offset] = 0;
      out[offset + 1] = 0;
      out[offset + 2] = 0;
      out[offset + 3] = 0;
      return;
    }
    out[offset] = a[0]!;
    out[offset + 1] = a[1]!;
    out[offset + 2] = a[2]!;
    out[offset + 3] = a[3]!;
  }

  has(name: string): boolean {
    return this.values.has(name);
  }
}
