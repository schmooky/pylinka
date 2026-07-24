/**
 * WGSL codegen: slot building, the CodegenCtx implementation, and the per-node
 * codegen registry (REQUIREMENTS.md §11.2, §12.2, §13, §16). Node codegen is
 * backend-neutral arithmetic + ctx helpers (§13.12); output.* and tex.* are
 * handled by the orchestrator, not this registry.
 */
import type {
  CodegenCtx,
  Expr,
  Graph,
  NodeCodegen,
  NodeEmit,
  ParamDef,
  PortType,
  SlotEntry,
  UniformLayout,
} from '@pylinka/graph';
import { liveNodeIds } from '@pylinka/graph';
import { easeFnName } from './wgsl.js';

const PI = '3.141592653589793';
const TAU = '6.283185307179586';
const HALF_PI = '1.5707963267948966';

/** Slot maps the compiler needs beyond the public UniformLayout (§12.2). */
export interface SlotResolution {
  layout: UniformLayout;
  /** "nodeId portId" → slot */
  portSlot: Map<string, number>;
  /** paramId → slot */
  knobSlot: Map<string, number>;
}

/** Swizzle for reading a vec4 value slot as the port's type. */
function swizzle(type: SlotEntry['type']): string {
  switch (type) {
    case 'f32':
    case 'bool':
      return '.x';
    case 'vec2':
      return '.xy';
    default:
      return ''; // vec4 / color: whole
  }
}

/**
 * Build the value table and the port/knob slot maps (§12.2). Slots are ordered
 * by PLAIN string compare (nodeId, then portId) — this matches the §14.2 golden
 * table. (Codegen *order* uses natural compare; slot *assignment* uses string.)
 */
export function buildSlots(graph: Graph, params: ParamDef[]): SlotResolution {
  const live = liveNodeIds(graph);
  const connected = new Set<string>();
  for (const e of graph.edges) connected.add(e.to.nodeId + ' ' + e.to.portId);

  const paramById = new Map<string, ParamDef>();
  for (const p of params) paramById.set(p.id, p);

  interface Cand {
    nodeId: string;
    portId: string;
    type: SlotEntry['type'];
    paramId?: string;
  }
  const cands: Cand[] = [];
  const knobbed = new Set<string>();
  for (const n of graph.nodes) {
    if (!live.has(n.id) || n.values === undefined) continue;
    for (const portId of Object.keys(n.values)) {
      if (connected.has(n.id + ' ' + portId)) continue;
      const bound = n.knobBindings?.[portId];
      cands.push({
        nodeId: n.id,
        portId,
        type: (n.values[portId] as { t: SlotEntry['type'] }).t,
        ...(bound !== undefined ? { paramId: bound } : {}),
      });
      if (bound !== undefined) knobbed.add(bound);
    }
  }
  cands.sort((a, b) =>
    a.nodeId !== b.nodeId
      ? a.nodeId < b.nodeId
        ? -1
        : 1
      : a.portId < b.portId
        ? -1
        : a.portId > b.portId
          ? 1
          : 0,
  );

  const entries: SlotEntry[] = [];
  const portSlot = new Map<string, number>();
  const knobSlot = new Map<string, number>();
  for (const c of cands) {
    const slot = entries.length;
    entries.push({
      slot,
      type: c.type,
      origin:
        c.paramId !== undefined
          ? { kind: 'knob', paramId: c.paramId }
          : { kind: 'nodeValue', nodeId: c.nodeId, portId: c.portId },
    });
    portSlot.set(c.nodeId + ' ' + c.portId, slot);
    if (c.paramId !== undefined) knobSlot.set(c.paramId, slot);
  }

  const refParams = new Set<string>();
  for (const n of graph.nodes) {
    if (!live.has(n.id) || n.kind !== 'param.ref') continue;
    const pid = n.structural?.param;
    if (pid !== undefined && pid !== '' && !knobbed.has(pid)) refParams.add(pid);
  }
  for (const pid of [...refParams].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const slot = entries.length;
    entries.push({ slot, type: paramById.get(pid)?.type ?? 'f32', origin: { kind: 'knob', paramId: pid } });
    knobSlot.set(pid, slot);
  }

  return {
    layout: { slotCount: Math.max(1, entries.length), entries, systemUniformsSize: 48 },
    portSlot,
    knobSlot,
  };
}

/** Read an unconnected input port's value slot as a WGSL expression. */
export function valueSlotExpr(slots: SlotResolution, nodeId: string, portId: string): Expr {
  const slot = slots.portSlot.get(nodeId + ' ' + portId);
  if (slot === undefined) throw new Error(`no value slot for ${nodeId}.${portId}`);
  return `V[${slot}]` + swizzle(slots.layout.entries[slot]!.type);
}

/** Per-node codegen context, recording temps, rng indices, and helper usage. */
export class NodeCtx implements CodegenCtx {
  readonly lines: string[] = [];
  readonly stableUsed: number[] = [];
  readonly frameUsed: number[] = [];
  /** distinct ease keys this node references (§13.9) — the orchestrator emits
   * one ease function per distinct key across the kernel. */
  readonly usedEases = new Set<string>();
  /** temp name → port type, so the webgl2 translator can type `let` lines */
  readonly tempTypes = new Map<string, PortType>();
  private tmpN = 0;
  readonly consts = { PI, DT: 'U.dt', TIME: 'U.time', AGE_N: 'ageN' };

  constructor(
    private readonly nodeId: string,
    private readonly slots: SlotResolution,
    private readonly rng: { stable: () => number; frame: () => number },
    private readonly flags: { safeDiv: boolean; safeNormalize: boolean },
  ) {}

  valueSlot(portId: string): Expr {
    const slot = this.slots.portSlot.get(this.nodeId + ' ' + portId);
    if (slot === undefined) throw new Error(`no value slot for ${this.nodeId}.${portId}`);
    return `V[${slot}]` + swizzle(this.slots.layout.entries[slot]!.type);
  }
  knobSlot(paramId: string): Expr {
    const slot = this.slots.knobSlot.get(paramId);
    if (slot === undefined) throw new Error(`no knob slot for ${paramId}`);
    return `V[${slot}]` + swizzle(this.slots.layout.entries[slot]!.type);
  }
  stableRandom(): Expr {
    const k = this.rng.stable();
    this.stableUsed.push(k);
    return `srand(seed, ${k}u)`;
  }
  frameRandom(): Expr {
    const k = this.rng.frame();
    this.frameUsed.push(k);
    return `frand(seed, U.frame, ${k}u)`;
  }
  /** Register an ease (default 'linear') and return its function name. */
  ease(key: string | undefined): Expr {
    const k = key ?? 'linear';
    this.usedEases.add(k);
    return easeFnName(k);
  }
  line(stmt: string): void {
    this.lines.push('  ' + stmt);
  }
  temp(type: PortType): string {
    const name = `x_${this.nodeId}_${this.tmpN++}`;
    this.tempTypes.set(name, type);
    return name;
  }
  safeDiv(a: Expr, b: Expr): Expr {
    this.flags.safeDiv = true;
    return `safeDiv(${a}, ${b})`;
  }
  safeNormalize(v: Expr): Expr {
    this.flags.safeNormalize = true;
    return `safeNormalize(${v})`;
  }
}

// ---------------------------------------------------------------------------
// Node codegen registry (value-producing namespaces only).
// ---------------------------------------------------------------------------
const one = (out: Expr): NodeEmit => ({ outputs: { out } });

export const NODE_CODEGEN: Record<string, NodeCodegen> = {
  // input.*
  'input.position': () => one('p.pos'),
  'input.velocity': () => one('p.vel'),
  'input.age': () => one('p.age'),
  'input.ageNormalized': () => one('ageN'),
  'input.life': () => one('p.life'),
  'input.time': () => one('U.time'),
  'input.frame': () => one('f32(U.frame)'),
  'input.spawnIndex': () => one('f32(i)'),
  'input.emitterPosition': () => one('U.emitterPos'),
  'input.emitterVelocity': () => one('U.emitterVel'),

  // param.*
  'param.ref': (ctx, _in, s) => one(ctx.knobSlot(s.param ?? '')),

  // gen.*
  'gen.random': (ctx) => one(ctx.stableRandom()),
  'gen.randomRange': (ctx, i) => one(`mix(${i.min}, ${i.max}, ${ctx.stableRandom()})`),
  'gen.randomVec2': (ctx, i) =>
    one(`mix(${i.min}, ${i.max}, vec2f(${ctx.stableRandom()}, ${ctx.stableRandom()}))`),
  'gen.frameRandom': (ctx) => one(ctx.frameRandom()),
  'gen.curveOverLife': (ctx, i, s) =>
    one(`mix(${i.from}, ${i.to}, ${ctx.ease(s.ease)}(${ctx.consts.AGE_N}))`),
  'gen.colorOverLife': (ctx, i, s) =>
    one(`mix(${i.from}, ${i.to}, ${ctx.ease(s.ease)}(${ctx.consts.AGE_N}))`),
  'gen.scaleOverLife': (ctx, i, s) =>
    one(`mix(${i.from}, ${i.to}, ${ctx.ease(s.ease)}(${ctx.consts.AGE_N}))`),
  // Standalone reshaper: run any 0..1 value through the chosen ease. Wire e.g.
  // input.ageNormalized (or a knob) into `t`, pick a preset/custom bezier, then
  // wire `out` into anything. The `t` clamp keeps overshoot-free presets sane.
  'gen.ease': (ctx, i, s) => one(`${ctx.ease(s.ease)}(clamp(${i.t}, 0.0, 1.0))`),
  'gen.noise': (ctx, i) =>
    one(
      `(fract(sin(dot(p.pos * ${i.scale}, vec2f(12.9898, 78.233)) + U.time * ${i.speed}) * 43758.5453) * 2.0 - 1.0)`,
    ),

  // math.*
  'math.add': (_c, i) => one(`(${i.a} + ${i.b})`),
  'math.sub': (_c, i) => one(`(${i.a} - ${i.b})`),
  'math.mul': (_c, i) => one(`(${i.a} * ${i.b})`),
  'math.div': (ctx, i) => one(ctx.safeDiv(i.a!, i.b!)),
  'math.mad': (_c, i) => one(`(${i.a} * ${i.b} + ${i.c})`),
  'math.mix': (_c, i) => one(`mix(${i.a}, ${i.b}, ${i.t})`),
  'math.clamp': (_c, i) => one(`clamp(${i.x}, ${i.min}, ${i.max})`),
  'math.min': (_c, i) => one(`min(${i.a}, ${i.b})`),
  'math.max': (_c, i) => one(`max(${i.a}, ${i.b})`),
  'math.sin': (_c, i) => one(`sin(${i.x})`),
  'math.cos': (_c, i) => one(`cos(${i.x})`),
  'math.abs': (_c, i) => one(`abs(${i.x})`),
  'math.length': (_c, i) => one(`length(${i.v})`),
  'math.normalize': (ctx, i) => one(ctx.safeNormalize(i.v!)),
  'math.rotate2d': (ctx, i) => {
    const c = ctx.temp('f32');
    const s = ctx.temp('f32');
    ctx.line(`let ${c} = cos(${i.angle});`);
    ctx.line(`let ${s} = sin(${i.angle});`);
    return one(`vec2f(${i.v}.x * ${c} - ${i.v}.y * ${s}, ${i.v}.x * ${s} + ${i.v}.y * ${c})`);
  },
  'math.splat': (_c, i) => one(`vec2f(${i.x})`),
  'math.makeVec2': (_c, i) => one(`vec2f(${i.x}, ${i.y})`),
  'math.makeVec4': (_c, i) => one(`vec4f(${i.x}, ${i.y}, ${i.z}, ${i.w})`),
  'math.component': (_c, i, s) => one(`${i.v}.${s.index ?? 'x'}`),
  'math.swizzle': (_c, i, s) => one(`${i.v}.${s.pattern ?? 'xy'}`),

  // field.*  (outputs named to match their schema port)
  'field.gravity': (_c, i) => ({ outputs: { force: i.g! } }),
  'field.directional': (_c, i) => ({
    outputs: { force: `vec2f(cos(${i.angle}), sin(${i.angle})) * ${i.strength}` },
  }),
  'field.radial': (ctx, i) => ({
    outputs: { force: `${ctx.safeNormalize(`p.pos - ${i.center}`)} * ${i.strength}` },
  }),
  'field.drag': (_c, i) => ({ outputs: { drag: i.coefficient! } }),
  // vortex: swirl around (emitterPos + center); tangential strength, inward
  // pull, linear falloff over radius (radius <= 0 → global)
  'field.vortex': (ctx, i) => {
    const d = ctx.temp('vec2');
    const len = ctx.temp('f32');
    const dir = ctx.temp('vec2');
    const w = ctx.temp('f32');
    ctx.line(`let ${d} = p.pos - (U.emitterPos + ${i.center});`);
    ctx.line(`let ${len} = max(length(${d}), 1e-3);`);
    ctx.line(`let ${dir} = ${d} / ${len};`);
    ctx.line(`let ${w} = select(1.0, clamp(1.0 - ${len} / max(${i.radius}, 1e-3), 0.0, 1.0), ${i.radius} > 0.0);`);
    return { outputs: { force: `(vec2f(-${dir}.y, ${dir}.x) * ${i.strength} - ${dir} * ${i.pull}) * ${w}` } };
  },
  // turbulence: curl of animated 2D value noise via central differences —
  // divergence-free swirls, backend-neutral arithmetic only (no helper fns)
  'field.turbulence': (ctx, i) => {
    const uv = ctx.temp('vec2');
    const tt = ctx.temp('f32');
    ctx.line(`let ${uv} = p.pos / max(${i.scale}, 1.0);`);
    ctx.line(`let ${tt} = U.time * ${i.speed};`);
    // value noise at uv + off, fully inlined (hash = fract(sin(dot)+t)·K)
    const noiseAt = (dx: string, dy: string): string => {
      const q = ctx.temp('vec2');
      const ip = ctx.temp('vec2');
      const fp = ctx.temp('vec2');
      const uu = ctx.temp('vec2');
      const n = ctx.temp('f32');
      ctx.line(`let ${q} = ${uv} + vec2f(${dx}, ${dy});`);
      ctx.line(`let ${ip} = floor(${q});`);
      ctx.line(`let ${fp} = fract(${q});`);
      ctx.line(`let ${uu} = ${fp} * ${fp} * (3.0 - 2.0 * ${fp});`);
      ctx.line(
        `let ${n} = mix(` +
          `mix(fract(sin(dot(${ip}, vec2f(127.1, 311.7)) + ${tt}) * 43758.5453), ` +
          `fract(sin(dot(${ip} + vec2f(1.0, 0.0), vec2f(127.1, 311.7)) + ${tt}) * 43758.5453), ${uu}.x), ` +
          `mix(fract(sin(dot(${ip} + vec2f(0.0, 1.0), vec2f(127.1, 311.7)) + ${tt}) * 43758.5453), ` +
          `fract(sin(dot(${ip} + vec2f(1.0, 1.0), vec2f(127.1, 311.7)) + ${tt}) * 43758.5453), ${uu}.x), ${uu}.y);`,
      );
      return n;
    };
    const e = '0.35';
    const nx0 = noiseAt(`-${e}`, '0.0');
    const nx1 = noiseAt(e, '0.0');
    const ny0 = noiseAt('0.0', `-${e}`);
    const ny1 = noiseAt('0.0', e);
    return {
      outputs: {
        force: `vec2f(${ny1} - ${ny0}, -(${nx1} - ${nx0})) / (2.0 * ${e}) * ${i.strength}`,
      },
    };
  },

  // obstacle: a body moving through the field. Radial push out of a disc with a
  // soft falloff, an optional tangential swirl (that's what leaves a wake rather
  // than a clean hole), and `carry` — an acceleration toward the body's OWN
  // velocity, so particles get dragged along in front of it and released behind.
  // center/velocity are absolute world (bind them to vec2 knobs for a cursor).
  'field.obstacle': (ctx, i, s) => {
    const d = ctx.temp('vec2');
    const len = ctx.temp('f32');
    const dir = ctx.temp('vec2');
    const t = ctx.temp('f32');
    const w = ctx.temp('f32');
    const centre = s.space === 'emitter' ? `(U.emitterPos + ${i.center})` : i.center;
    ctx.line(`let ${d} = p.pos - ${centre};`);
    ctx.line(`let ${len} = max(length(${d}), 1e-3);`);
    ctx.line(`let ${dir} = ${d} / ${len};`);
    ctx.line(`let ${t} = clamp(1.0 - ${len} / max(${i.radius}, 1e-3), 0.0, 1.0);`);
    // softness 0 → a tight shell right at the surface, 1 → a broad soft cushion
    ctx.line(`let ${w} = pow(${t}, mix(3.0, 0.5, clamp(${i.softness}, 0.0, 1.0)));`);
    return {
      outputs: {
        force:
          `(${dir} * ${i.strength} + vec2f(-${dir}.y, ${dir}.x) * ${i.swirl}` +
          ` + (${i.velocity} - p.vel) * ${i.carry}) * ${w}`,
      },
    };
  },

  // shape.*  (output named 'pos')
  'shape.point': (_c, i) => ({ outputs: { pos: i.offset! } }),
  'shape.circle': (ctx, i) => {
    const a = ctx.temp('f32');
    ctx.line(`let ${a} = ${TAU} * ${ctx.stableRandom()};`);
    return { outputs: { pos: `vec2f(cos(${a}), sin(${a})) * ${i.radius}` } };
  },
  'shape.torus': (ctx, i) => {
    const a = ctx.temp('f32');
    const r = ctx.temp('f32');
    ctx.line(`let ${a} = ${TAU} * ${ctx.stableRandom()};`);
    ctx.line(`let ${r} = mix(${i.innerRadius}, ${i.outerRadius}, ${ctx.stableRandom()});`);
    return { outputs: { pos: `vec2f(cos(${a}), sin(${a})) * ${r}` } };
  },
  'shape.rectangle': (ctx, i) => ({
    outputs: {
      pos: `(vec2f(${ctx.stableRandom()}, ${ctx.stableRandom()}) - 0.5) * ${i.size}`,
    },
  }),
  'shape.burstRing': (ctx, i) => {
    const a = ctx.temp('f32');
    ctx.line(`let ${a} = ${TAU} * f32(i) / f32(U.spawnCount);`);
    return { outputs: { pos: `vec2f(cos(${a}), sin(${a})) * ${i.radius}` } };
  },
  'shape.polygonalChain': (ctx, i) => ({
    outputs: { pos: `mix(${i.start}, ${i.end}, ${ctx.stableRandom()})` },
  }),
};

export { PI, TAU, HALF_PI };
