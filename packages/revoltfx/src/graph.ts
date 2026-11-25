/**
 * A small builder for Pylinka graphs. Values are either literals (written into
 * an unconnected port's `values`) or references to another node's output
 * (written as an edge). Arithmetic on two literals is folded, so a constant
 * RevoltFX setting never becomes a chain of nodes.
 */
import type { Edge, Graph, Literal, Node } from '@pylinka/graph';

export interface Ref {
  node: string;
  port: string;
}

export type Vec2 = [number, number];
/** An f32 value: a literal or a wire. */
export type F = number | Ref;
/** A vec2 value: a literal or a wire. */
export type V = Vec2 | Ref;
/** A color literal ('#rrggbbaa') or a wire. */
export type C = string | Ref;

export const isRef = (v: unknown): v is Ref => typeof v === 'object' && v !== null && !Array.isArray(v) && 'node' in v;

function literal(v: number | Vec2 | string | boolean): Literal {
  if (typeof v === 'number') return { t: 'f32', v };
  if (typeof v === 'boolean') return { t: 'bool', v };
  if (typeof v === 'string') return { t: 'color', v };
  return { t: 'vec2', v: [v[0], v[1]] };
}

export class GraphBuilder {
  readonly nodes: Node[] = [];
  readonly edges: Edge[] = [];
  private n = 0;
  private e = 0;

  /** Add a node; `inputs` are literals or wires keyed by port id. */
  add(
    kind: string,
    inputs: Record<string, F | V | C | boolean> = {},
    structural?: Record<string, string>,
  ): string {
    const id = `n${++this.n}`;
    const node: Node = { id, kind };
    if (structural !== undefined && Object.keys(structural).length > 0) node.structural = { ...structural };
    for (const [port, v] of Object.entries(inputs)) {
      if (isRef(v)) {
        this.edges.push({ id: `e${++this.e}`, from: { nodeId: v.node, portId: v.port }, to: { nodeId: id, portId: port } });
      } else {
        (node.values ??= {})[port] = literal(v);
      }
    }
    this.nodes.push(node);
    return id;
  }

  /** Add a value node and return its output. */
  op(kind: string, inputs: Record<string, F | V | C> = {}, structural?: Record<string, string>, out = 'out'): Ref {
    return { node: this.add(kind, inputs, structural), port: out };
  }

  /** Read a knob (param id). */
  knob(paramId: string): F {
    return this.op('param.ref', {}, { param: paramId });
  }

  // ---- f32 arithmetic with constant folding --------------------------------

  /** Uniform random in [min, max), fixed per particle. */
  range(min: number, max: number): F {
    if (min === max) return min;
    return this.op('gen.randomRange', { min, max });
  }

  add2(a: F, b: F): F {
    if (typeof a === 'number' && typeof b === 'number') return a + b;
    if (a === 0) return b;
    if (b === 0) return a;
    return this.op('math.add', { a, b });
  }

  mul(a: F, b: F): F {
    if (typeof a === 'number' && typeof b === 'number') return a * b;
    if (a === 1) return b;
    if (b === 1) return a;
    if (a === 0 || b === 0) return 0;
    return this.op('math.mul', { a, b });
  }

  div(a: F, b: F): F {
    if (typeof a === 'number' && typeof b === 'number' && b !== 0) return a / b;
    return this.op('math.div', { a, b });
  }

  /** mix(a, b, t()); `t` is only built when a and b differ. */
  mix(a: F, b: F, t: F | (() => F)): F {
    if (typeof a === 'number' && typeof b === 'number' && a === b) return a;
    if (typeof t === 'function') t = t();
    if (typeof t === 'number') {
      if (t === 0) return a;
      if (t === 1) return b;
      if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
    }
    return this.op('math.mix', { a, b, t });
  }

  cos(x: F): F {
    return typeof x === 'number' ? Math.cos(x) : this.op('math.cos', { x });
  }

  sin(x: F): F {
    return typeof x === 'number' ? Math.sin(x) : this.op('math.sin', { x });
  }

  abs(x: F): F {
    return typeof x === 'number' ? Math.abs(x) : this.op('math.abs', { x });
  }

  vec(x: F, y: F): V {
    if (typeof x === 'number' && typeof y === 'number') return [x, y];
    return this.op('math.makeVec2', { x, y });
  }

  /** v · s for a vec2 and a scalar. */
  scale(v: V, s: F): V {
    if (s === 0) return [0, 0];
    if (!isRef(v) && typeof s === 'number') return [v[0] * s, v[1] * s];
    if (s === 1) return v;
    const x = isRef(v) ? this.op('math.component', { v }, { index: 'x' }) : v[0];
    const y = isRef(v) ? this.op('math.component', { v }, { index: 'y' }) : v[1];
    return this.vec(this.mul(x, s), this.mul(y, s));
  }

  rotate(v: V, angle: F): V {
    if (!isRef(v) && typeof angle === 'number') {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
    }
    if (angle === 0) return v;
    return this.op('math.rotate2d', { v, angle });
  }

  normalize(v: V): V {
    if (!isRef(v)) {
      const l = Math.hypot(v[0], v[1]) || 1;
      return [v[0] / l, v[1] / l];
    }
    return this.op('math.normalize', { v });
  }

  graph(): Graph {
    return { nodes: this.nodes, edges: this.edges };
  }
}
