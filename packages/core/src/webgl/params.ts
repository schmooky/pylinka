/**
 * Interpret a pylinka System's graph into WebGL2 engine parameters. This is the
 * pragmatic v1 runtime path (REQUIREMENTS §5.4 "non-GPU/interpreter preview" +
 * §13.12 WebGL2 fallback): recognised node patterns map to uniforms of a fixed
 * simulation model. Covers the common slot-VFX set — spawn shape, random init
 * velocity + life, gravity, directional wind (knob-driven), drag, colour-over-
 * life, scale-over-life. Unrecognised nodes are ignored (the effect still runs).
 */
import type { EmitterSettings, Literal, Node, ParamDef, System } from '@pylinka/graph';
import { EASE_INDEX } from './shaders.js';

export interface EngineParams {
  capacity: number;
  emitter: EmitterSettings;
  blend: 'normal' | 'add' | 'screen';
  gravity: [number, number];
  drag: number;
  windPower: number;
  windDir: number;
  /** knob names driving the wind (so runtime setKnob can update it), if any. */
  windPowerKnob?: string;
  windDirKnob?: string;
  velMin: [number, number];
  velMax: [number, number];
  lifeMin: number;
  lifeMax: number;
  shape: 0 | 1 | 2;
  shapeRadius: number;
  shapeSize: [number, number];
  colorFrom: [number, number, number, number];
  colorTo: [number, number, number, number];
  colorEase: number;
  sizeFrom: number;
  sizeTo: number;
  sizeEase: number;
  /**
   * Up to 4 point fields (field.vortex / field.radial). tangential = swirl
   * px/s² (sign = direction), pull = inward suction (+) / push (−), radius =
   * linear falloff distance (0 = global), relative = center is emitter-relative.
   */
  pointFields: {
    center: [number, number];
    tangential: number;
    pull: number;
    radius: number;
    relative: 0 | 1;
  }[];
  /** field.turbulence: [strength, noise cell px, speed] ([0,…] = off). */
  turbulence: [number, number, number];
  /**
   * field.obstacle — up to 4 bodies moving through the field. `center` and
   * `velocity` are absolute world px and are usually knob-bound, so a cursor or
   * a flying object can drive them live (see `setKnob(name, x, y)`).
   */
  obstacles: {
    center: [number, number];
    velocity: [number, number];
    radius: number;
    strength: number;
    softness: number;
    swirl: number;
    carry: number;
    /** 1 = centre is emitter-relative (structural `space: 'emitter'`). */
    relative: 0 | 1;
  }[];
  /** output.collide* — up to 4 solids, resolved after integration. */
  colliders: {
    /** 1 plane · 2 rect inside · 3 rect outside · 4 circle outside · 5 circle inside */
    kind: 1 | 2 | 3 | 4 | 5;
    /** plane: point · rect: min · circle: centre */
    a: [number, number];
    /** plane: normal · rect: max · circle: the disc's own velocity */
    b: [number, number];
    radius: number;
    restitution: number;
    friction: number;
    /** 1 = geometry is emitter-relative (structural `space: 'emitter'`). */
    relative: 0 | 1;
  }[];
  /** output.deathBurst — sub-emitter explosion: countMin..countMax spawns per
   *  parent death, up to `max` (child-pool multiplier + pass count), each
   *  inheriting `inherit` of the parent's death velocity. */
  deathBurst?: { max: number; countMin: number; countMax: number; inherit: number };
}

/** structural `space` → the runtime's emitter-relative flag. */
const rel = (n: Node): 0 | 1 => (n.structural?.space === 'emitter' ? 1 : 0);

/** Knob values as the interpreted runtime holds them: scalar or vec2. */
export type KnobValues = Record<string, number | [number, number]>;

const f = (l: Literal | undefined, d: number): number => (l?.t === 'f32' ? l.v : d);
/** First component of a knob value (vec2 knobs read as scalars where needed). */
const scalar = (v: number | [number, number] | undefined): number =>
  v === undefined ? 0 : typeof v === 'number' ? v : v[0];
const v2 = (l: Literal | undefined, d: [number, number]): [number, number] =>
  l?.t === 'vec2' ? [l.v[0], l.v[1]] : d;

/** '#rrggbbaa' → [r,g,b,a] in 0..1. */
export function parseColor(
  l: Literal | undefined,
  d: [number, number, number, number],
): [number, number, number, number] {
  if (l?.t !== 'color') return d;
  const s = l.v.replace('#', '');
  const h = s.length >= 8 ? s : s.padEnd(8, 'f');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), n(6)];
}

export function extractParams(
  system: System,
  params: ParamDef[],
  knobValues: KnobValues,
): EngineParams {
  const g = system.graph;
  const nodes = new Map(g.nodes.map((n) => [n.id, n] as const));
  const paramById = new Map(params.map((pp) => [pp.id, pp] as const));
  const source = (nodeId: string | undefined, portId: string): Node | undefined => {
    if (nodeId === undefined) return undefined;
    const e = g.edges.find((ed) => ed.to.nodeId === nodeId && ed.to.portId === portId);
    return e ? nodes.get(e.from.nodeId) : undefined;
  };
  const byKind = (kind: string) => g.nodes.find((n) => n.kind === kind);
  /** f32 port value: knob-driven (param.ref edge or knobBinding) or the literal. */
  const fk = (n: Node | undefined, portId: string, d: number): number => {
    if (!n) return d;
    const knob = resolveKnob(n, portId, source, paramById);
    if (knob !== undefined) {
      const live = knobValues[knob];
      if (live !== undefined) return typeof live === 'number' ? live : live[0];
      const pd = params.find((x) => x.name === knob);
      return pd?.default.t === 'f32' ? pd.default.v : d;
    }
    return f(n.values?.[portId], d);
  };
  /** vec2 port value, knob-driven the same way — this is the cursor path. */
  const vk = (n: Node | undefined, portId: string, d: [number, number]): [number, number] => {
    if (!n) return d;
    const knob = resolveKnob(n, portId, source, paramById);
    if (knob !== undefined) {
      const live = knobValues[knob];
      if (Array.isArray(live)) return [live[0], live[1]];
      if (typeof live === 'number') return [live, 0];
      const pd = params.find((x) => x.name === knob);
      if (pd?.default.t === 'vec2') return [pd.default.v[0], pd.default.v[1]];
    }
    return v2(n.values?.[portId], d);
  };

  const p: EngineParams = {
    capacity: system.capacity,
    emitter: system.emitter,
    blend: system.blendMode,
    gravity: [0, 0],
    drag: 0,
    windPower: 0,
    windDir: 0,
    velMin: [-20, -60],
    velMax: [20, -120],
    lifeMin: 1,
    lifeMax: 1.5,
    shape: 0,
    shapeRadius: 40,
    shapeSize: [80, 80],
    colorFrom: [1, 1, 1, 1],
    colorTo: [1, 1, 1, 0],
    colorEase: 0,
    sizeFrom: 8,
    sizeTo: 0,
    sizeEase: 0,
    pointFields: [],
    turbulence: [0, 120, 1],
    obstacles: [],
    colliders: [],
  };

  const shapeNode = source(byKind('output.spawnPosition')?.id, 'pos');
  if (shapeNode?.kind === 'shape.circle') {
    p.shape = 1;
    p.shapeRadius = fk(shapeNode, 'radius', 40);
  } else if (shapeNode?.kind === 'shape.rectangle') {
    p.shape = 2;
    p.shapeSize = v2(shapeNode.values?.size, [80, 80]);
  }

  const velNode = source(byKind('output.initVelocity')?.id, 'vel');
  if (velNode?.kind === 'gen.randomVec2') {
    p.velMin = v2(velNode.values?.min, p.velMin);
    p.velMax = v2(velNode.values?.max, p.velMax);
  }

  const lifeNode = source(byKind('output.initLife')?.id, 'life');
  if (lifeNode?.kind === 'gen.randomRange') {
    p.lifeMin = fk(lifeNode, 'min', 1);
    p.lifeMax = fk(lifeNode, 'max', 1.5);
  } else {
    const lit = byKind('output.initLife')?.values?.life;
    if (lit?.t === 'f32') {
      p.lifeMin = lit.v;
      p.lifeMax = lit.v;
    }
  }

  for (const n of g.nodes) {
    if (n.kind === 'field.gravity') p.gravity = v2(n.values?.g, [0, 300]);
    if (n.kind === 'field.drag') p.drag = fk(n, 'coefficient', 0);
    if (n.kind === 'field.vortex' && p.pointFields.length < 4) {
      p.pointFields.push({
        center: v2(n.values?.center, [0, 0]),
        tangential: fk(n, 'strength', 300),
        pull: fk(n, 'pull', 0),
        radius: fk(n, 'radius', 240),
        relative: 1,
      });
    }
    if (n.kind === 'field.radial' && p.pointFields.length < 4) {
      // schema: +strength pushes away from center → pull is the negation
      p.pointFields.push({
        center: v2(n.values?.center, [0, 0]),
        tangential: 0,
        pull: -fk(n, 'strength', 0),
        radius: 0,
        relative: 0,
      });
    }
    if (n.kind === 'field.turbulence') {
      p.turbulence = [fk(n, 'strength', 200), fk(n, 'scale', 120), fk(n, 'speed', 1)];
    }
    if (n.kind === 'field.obstacle' && p.obstacles.length < 4) {
      p.obstacles.push({
        center: vk(n, 'center', [0, 0]),
        velocity: vk(n, 'velocity', [0, 0]),
        radius: fk(n, 'radius', 140),
        strength: fk(n, 'strength', 2400),
        softness: fk(n, 'softness', 0.5),
        swirl: fk(n, 'swirl', 0),
        carry: fk(n, 'carry', 0),
        relative: rel(n),
      });
    }
    if (n.kind === 'output.collidePlane' && p.colliders.length < 4) {
      p.colliders.push({
        kind: 1,
        a: vk(n, 'point', [0, 400]),
        b: vk(n, 'normal', [0, -1]),
        radius: 0,
        restitution: fk(n, 'restitution', 0.45),
        friction: fk(n, 'friction', 0.1),
        relative: rel(n),
      });
    }
    if (n.kind === 'output.collideRect' && p.colliders.length < 4) {
      p.colliders.push({
        kind: (n.structural?.mode ?? 'inside') === 'outside' ? 3 : 2,
        a: vk(n, 'min', [-300, -300]),
        b: vk(n, 'max', [300, 300]),
        radius: 0,
        restitution: fk(n, 'restitution', 0.45),
        friction: fk(n, 'friction', 0.1),
        relative: rel(n),
      });
    }
    if (n.kind === 'output.collideCircle' && p.colliders.length < 4) {
      p.colliders.push({
        kind: (n.structural?.mode ?? 'outside') === 'inside' ? 5 : 4,
        a: vk(n, 'center', [0, 0]),
        b: vk(n, 'velocity', [0, 0]),
        radius: fk(n, 'radius', 120),
        restitution: fk(n, 'restitution', 0.45),
        friction: fk(n, 'friction', 0.1),
        relative: rel(n),
      });
    }
    if (n.kind === 'field.directional') {
      const strengthKnob = resolveKnob(n, 'strength', source, paramById);
      const angleKnob = resolveKnob(n, 'angle', source, paramById);
      if (strengthKnob) {
        p.windPowerKnob = strengthKnob;
        p.windPower = scalar(knobValues[strengthKnob]);
      } else p.windPower = f(n.values?.strength, 0);
      if (angleKnob) {
        p.windDirKnob = angleKnob;
        p.windDir = scalar(knobValues[angleKnob]);
      } else p.windDir = f(n.values?.angle, 0);
    }
  }

  const colorNode = byKind('gen.colorOverLife');
  if (colorNode) {
    p.colorFrom = parseColor(colorNode.values?.from, p.colorFrom);
    p.colorTo = parseColor(colorNode.values?.to, p.colorTo);
    p.colorEase = EASE_INDEX[colorNode.structural?.ease ?? 'linear'] ?? 0;
  }

  const scaleNode = byKind('gen.scaleOverLife');
  if (scaleNode) {
    p.sizeFrom = fk(scaleNode, 'from', 1) * 8;
    p.sizeTo = fk(scaleNode, 'to', 0) * 8;
    p.sizeEase = EASE_INDEX[scaleNode.structural?.ease ?? 'linear'] ?? 0;
  }

  const burstNode = byKind('output.deathBurst');
  if (burstNode) {
    const raw = Number(burstNode.structural?.max ?? '8');
    const max = Number.isFinite(raw) ? Math.min(64, Math.max(1, Math.floor(raw))) : 8;
    p.deathBurst = {
      max,
      countMin: fk(burstNode, 'countMin', 1),
      countMax: fk(burstNode, 'countMax', 1),
      inherit: fk(burstNode, 'inheritVelocity', 0),
    };
  }

  return p;
}

/** Resolve the knob NAME driving a port (via param.ref edge or knobBinding). */
function resolveKnob(
  node: Node,
  portId: string,
  source: (nodeId: string | undefined, portId: string) => Node | undefined,
  paramById: Map<string, ParamDef>,
): string | undefined {
  const src = source(node.id, portId);
  if (src?.kind === 'param.ref') {
    const pid = src.structural?.param;
    return pid !== undefined ? paramById.get(pid)?.name : undefined;
  }
  const bound = node.knobBindings?.[portId];
  return bound !== undefined ? paramById.get(bound)?.name : undefined;
}
