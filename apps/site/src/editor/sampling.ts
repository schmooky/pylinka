/**
 * A tiny CPU evaluator for the node previews: sample a handful of particles
 * and, where asked, fly them through their lifetime.
 *
 * It follows the compiler's formulas (packages/compiler/src/codegen.ts and the
 * integrator in wgsl.ts) so a preview draws what the GPU will do:
 *   - randomRange / randomVec2 are `mix(min, max, r)`, one r per component;
 *   - Circle spawns ON the circle, Torus between its radii, Rectangle inside;
 *   - each step: `vel += force·dt; vel *= e^(−drag·dt); pos += vel·dt`;
 *   - spawn positions are relative to the emitter, which sits at the origin.
 *
 * Randomness is seeded, so a preview is stable from frame to frame and only
 * changes when the graph does. A random node draws once per particle (the
 * shader's stable random), however many times it is read, and every draw is a
 * hash of (particle, node, slot) rather than the next number in a sequence:
 * switching one node off must not reshuffle everyone else's particles, or a
 * with/without comparison would compare two different sprays. Kinds this cannot
 * model (turbulence, collisions…) contribute nothing and are reported, so the
 * preview can say it is approximate instead of quietly lying.
 */
import type { Literal, Node, ParamDef, System } from '@pylinka/graph';
import { getSchema, V1_CATALOG } from '@pylinka/graph';
import { sampleEase } from '@pylinka/compiler';

export type Vec = [number, number];
export type Value = number | Vec;

const TAU = Math.PI * 2;

/** mulberry32: small, fast, good enough to scatter a preview. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a — turns a node id into a seed, so each node scatters differently. */
export function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const num = (v: Value): number => (typeof v === 'number' ? v : v[0]);
const vec = (v: Value): Vec => (typeof v === 'number' ? [v, v] : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const len = (v: Vec) => Math.hypot(v[0], v[1]);
const norm = (v: Vec): Vec => {
  const l = len(v);
  return l > 1e-6 ? [v[0] / l, v[1] / l] : [0, 0];
};

function fromLiteral(l: Literal | undefined): Value {
  if (!l) return 0;
  if (l.t === 'f32') return l.v;
  if (l.t === 'vec2') return [l.v[0], l.v[1]];
  return 0;
}

/** Kinds that only mean something in the running sim; a preview skips them. */
const UNMODELLED = new Set([
  'field.turbulence',
  'field.obstacle',
  'output.collidePlane',
  'output.collideRect',
  'output.collideCircle',
  'output.reflectInRect',
  'output.killIf',
  'output.killIfOutOfRect',
  'output.writePosition',
]);

interface State {
  pos: Vec;
  vel: Vec;
  age: number;
  life: number;
  index: number;
  count: number;
}

export class Sampler {
  /** node kinds met that the preview could not model */
  readonly approx = new Set<string>();
  private readonly nodes: Map<string, Node>;
  private readonly draws = new Map<string, number>();
  private values = new Map<string, Value>();
  private state: State = { pos: [0, 0], vel: [0, 0], age: 0, life: 1, index: 0, count: 1 };

  constructor(
    private readonly system: System,
    private readonly params: readonly ParamDef[],
    private readonly seed: number,
    private readonly exclude: ReadonlySet<string> = new Set(),
  ) {
    this.nodes = new Map(system.graph.nodes.map((n) => [n.id, n]));
  }

  /** Start a new particle: fresh random draws, fresh values. */
  particle(index: number, count: number, life = 1): void {
    this.draws.clear();
    this.values.clear();
    this.state = { pos: [0, 0], vel: [0, 0], age: 0, life, index, count };
  }

  /** Move to a new moment in the same particle's life: randoms stay, values recompute. */
  at(pos: Vec, vel: Vec, age: number, life: number): void {
    this.values.clear();
    this.state = { ...this.state, pos, vel, age, life };
  }

  /** One stable random per (node, slot) for the current particle. */
  private r(nodeId: string, slot = 0): number {
    const key = `${nodeId}#${slot}`;
    let v = this.draws.get(key);
    if (v === undefined) {
      v = rng(seedOf(`${this.seed}:${this.state.index}:${key}`))();
      this.draws.set(key, v);
    }
    return v;
  }

  /** The value arriving at an input port. */
  input(nodeId: string, port: string): Value {
    const e = this.system.graph.edges.find((x) => x.to.nodeId === nodeId && x.to.portId === port);
    if (e) return this.output(e.from.nodeId, e.from.portId);
    const node = this.nodes.get(nodeId);
    if (!node) return 0;
    const knob = node.knobBindings?.[port];
    if (knob) return fromLiteral(this.params.find((p) => p.id === knob)?.default);
    return fromLiteral(
      node.values?.[port] ?? getSchema(V1_CATALOG, node.kind)?.inputs.find((p) => p.id === port)?.defaultValue,
    );
  }

  /** A node's output value for the current particle and moment. */
  output(nodeId: string, port: string): Value {
    const key = `${nodeId}.${port}`;
    const hit = this.values.get(key);
    if (hit !== undefined) return hit;
    const v = this.compute(nodeId, port);
    this.values.set(key, v);
    return v;
  }

  private compute(id: string, port: string): Value {
    const node = this.nodes.get(id);
    if (!node) return 0;
    if (this.exclude.has(id)) return port === 'force' ? [0, 0] : 0;
    const i = (p: string) => this.input(id, p);
    const n = (p: string) => num(i(p));
    const v = (p: string) => vec(i(p));
    const s = this.state;
    const ease = (t: number) => sampleEase(node.structural?.ease ?? 'linear', Math.min(1, Math.max(0, t)));
    const ageN = s.life > 0 ? s.age / s.life : 0;

    switch (node.kind) {
      case 'param.ref':
        return fromLiteral(this.params.find((p) => p.id === node.structural?.param)?.default);

      case 'input.position':
        return s.pos;
      case 'input.velocity':
        return s.vel;
      case 'input.age':
        return s.age;
      case 'input.ageNormalized':
        return ageN;
      case 'input.life':
        return s.life;
      case 'input.time':
        return s.age;
      case 'input.frame':
        return Math.floor(s.age * 60);
      case 'input.spawnIndex':
        return s.index;
      case 'input.emitterPosition':
      case 'input.emitterVelocity':
        return [0, 0];

      case 'gen.random':
        return this.r(id);
      case 'gen.randomRange':
        return mix(n('min'), n('max'), this.r(id));
      case 'gen.randomVec2': {
        const a = v('min'), b = v('max');
        return [mix(a[0], b[0], this.r(id, 0)), mix(a[1], b[1], this.r(id, 1))];
      }
      case 'gen.frameRandom':
        return rng(seedOf(`${this.seed}:${s.index}:${id}:${Math.floor(s.age * 60)}`))();
      case 'gen.noise': {
        const p = s.pos, sc = n('scale');
        const x = Math.sin(p[0] * sc * 12.9898 + p[1] * sc * 78.233 + s.age * n('speed')) * 43758.5453;
        return (x - Math.floor(x)) * 2 - 1;
      }
      case 'gen.curveOverLife':
      case 'gen.scaleOverLife':
      case 'gen.numberOverLife':
      case 'gen.alphaOverLife':
      case 'gen.rotationOverLife':
        return mix(n('from'), n('to'), ease(ageN));
      case 'gen.spin':
        return (node.structural?.unit === 'radians' ? n('rate') : (n('rate') * Math.PI) / 180) * s.age;
      case 'gen.ease':
        return ease(n('t'));

      case 'math.add':
        return n('a') + n('b');
      case 'math.sub':
        return n('a') - n('b');
      case 'math.mul':
        return n('a') * n('b');
      case 'math.div': {
        const b = n('b');
        return Math.abs(b) > 1e-6 ? n('a') / b : 0;
      }
      case 'math.mad':
        return n('a') * n('b') + n('c');
      case 'math.mix':
        return mix(n('a'), n('b'), n('t'));
      case 'math.clamp':
        return Math.min(n('max'), Math.max(n('min'), n('x')));
      case 'math.min':
        return Math.min(n('a'), n('b'));
      case 'math.max':
        return Math.max(n('a'), n('b'));
      case 'math.sin':
        return Math.sin(n('x'));
      case 'math.cos':
        return Math.cos(n('x'));
      case 'math.radians':
        return (n('degrees') * Math.PI) / 180;
      case 'math.abs':
        return Math.abs(n('x'));
      case 'math.length':
        return len(v('v'));
      case 'math.normalize':
        return norm(v('v'));
      case 'math.rotate2d': {
        const a = n('angle'), p = v('v'), c = Math.cos(a), sn = Math.sin(a);
        return [p[0] * c - p[1] * sn, p[0] * sn + p[1] * c];
      }
      case 'math.splat':
        return [n('x'), n('x')];
      case 'math.makeVec2':
        return [n('x'), n('y')];
      case 'math.component':
        return v('v')[node.structural?.index === 'y' ? 1 : 0];
      case 'math.swizzle': {
        const p = v('v'), pat = node.structural?.pattern ?? 'xy';
        return [p[pat[0] === 'y' ? 1 : 0], p[pat[1] === 'y' ? 1 : 0]];
      }

      case 'field.gravity':
        return v('g');
      case 'field.directional': {
        const a = n('angle'), k = n('strength');
        return [Math.cos(a) * k, Math.sin(a) * k];
      }
      case 'field.radial': {
        const d = norm([s.pos[0] - v('center')[0], s.pos[1] - v('center')[1]]);
        return [d[0] * n('strength'), d[1] * n('strength')];
      }
      case 'field.drag':
        return n('coefficient');
      case 'field.vortex': {
        const c = v('center');
        const d: Vec = [s.pos[0] - c[0], s.pos[1] - c[1]];
        const l = Math.max(len(d), 1e-3);
        const dir: Vec = [d[0] / l, d[1] / l];
        const r = n('radius');
        const w = r > 0 ? Math.min(1, Math.max(0, 1 - l / Math.max(r, 1e-3))) : 1;
        const k = n('strength'), pull = n('pull');
        return [(-dir[1] * k - dir[0] * pull) * w, (dir[0] * k - dir[1] * pull) * w];
      }

      case 'shape.point':
        return v('offset');
      case 'shape.circle': {
        const a = TAU * this.r(id), rad = n('radius');
        return [Math.cos(a) * rad, Math.sin(a) * rad];
      }
      case 'shape.torus': {
        const a = TAU * this.r(id, 0), rad = mix(n('innerRadius'), n('outerRadius'), this.r(id, 1));
        return [Math.cos(a) * rad, Math.sin(a) * rad];
      }
      case 'shape.rectangle': {
        const size = v('size');
        return [(this.r(id, 0) - 0.5) * size[0], (this.r(id, 1) - 0.5) * size[1]];
      }
      case 'shape.burstRing': {
        const a = (TAU * s.index) / Math.max(1, s.count), rad = n('radius');
        return [Math.cos(a) * rad, Math.sin(a) * rad];
      }
      case 'shape.polygonalChain': {
        const a = v('start'), b = v('end'), t = this.r(id);
        return [mix(a[0], b[0], t), mix(a[1], b[1], t)];
      }

      default:
        this.approx.add(node.kind);
        return port === 'force' || port === 'pos' || port === 'vel' ? [0, 0] : 0;
    }
  }
}

/** `count` samples of one node output, one particle each (age 0). */
export function sampleOutput(
  system: System,
  params: readonly ParamDef[],
  nodeId: string,
  port: string,
  count: number,
): Value[] {
  const s = new Sampler(system, params, seedOf(nodeId));
  const out: Value[] = [];
  for (let k = 0; k < count; k++) {
    s.particle(k, count);
    out.push(s.output(nodeId, port));
  }
  return out;
}

export interface Path {
  life: number;
  /** positions, one every `every` steps, emitter at the origin */
  pts: Vec[];
}

/**
 * Fly `count` particles through their lives. `exclude` switches nodes off
 * (a field outputs zero, a write node is skipped) — how a force node draws
 * "with me" against "without me".
 */
export function simulate(
  system: System,
  params: readonly ParamDef[],
  opts: { count?: number; exclude?: ReadonlySet<string>; dt?: number; maxLife?: number } = {},
): { paths: Path[]; approx: string[] } {
  const count = opts.count ?? 12;
  const dt = opts.dt ?? 1 / 60;
  const exclude = opts.exclude ?? new Set<string>();
  const s = new Sampler(system, params, seedOf(system.id), exclude);
  const of = (kind: string) => system.graph.nodes.filter((n) => n.kind === kind && !exclude.has(n.id));
  const spawn = of('output.spawnPosition')[0];
  const initVel = of('output.initVelocity')[0];
  const initLife = of('output.initLife')[0];
  const forces = of('output.addForce');
  const drags = of('output.drag');
  const setVel = of('output.setVelocity')[0];
  for (const n of system.graph.nodes) if (UNMODELLED.has(n.kind)) s.approx.add(n.kind);

  const paths: Path[] = [];
  for (let k = 0; k < count; k++) {
    s.particle(k, count);
    const life = Math.min(opts.maxLife ?? 8, Math.max(0.05, initLife ? num(s.input(initLife.id, 'life')) : 1));
    // same particle, now that its life is known: keep its random draws
    s.at([0, 0], [0, 0], 0, life);
    let pos: Vec = spawn ? [...vec(s.input(spawn.id, 'pos'))] : [0, 0];
    let vel: Vec = initVel ? [...vec(s.input(initVel.id, 'vel'))] : [0, 0];
    const steps = Math.max(1, Math.ceil(life / dt));
    const every = Math.max(1, Math.round(steps / 48));
    const pts: Vec[] = [pos];
    for (let step = 1; step <= steps; step++) {
      s.at(pos, vel, (step - 1) * dt, life);
      if (setVel) {
        vel = [...vec(s.input(setVel.id, 'vel'))];
      } else {
        let fx = 0, fy = 0;
        for (const f of forces) {
          const fv = vec(s.input(f.id, 'force'));
          fx += fv[0];
          fy += fv[1];
        }
        let dragK = 0;
        for (const d of drags) dragK += num(s.input(d.id, 'drag'));
        const decay = Math.exp(-dragK * dt);
        vel = [(vel[0] + fx * dt) * decay, (vel[1] + fy * dt) * decay];
      }
      pos = [pos[0] + vel[0] * dt, pos[1] + vel[1] * dt];
      if (step % every === 0 || step === steps) pts.push(pos);
    }
    paths.push({ life, pts });
  }
  return { paths, approx: [...s.approx] };
}

/** What a node's output is wired into — the write node that gives it meaning. */
export function destinationOf(system: System, nodeId: string): Node | undefined {
  for (const e of system.graph.edges) {
    if (e.from.nodeId !== nodeId) continue;
    const to = system.graph.nodes.find((n) => n.id === e.to.nodeId);
    if (to) return to;
  }
  return undefined;
}
