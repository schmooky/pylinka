/**
 * One particle, evaluated on the CPU across its lifetime — for the small
 * previews next to over-life nodes and in the emitter panel.
 *
 * This is deliberately NOT the simulator. It reads the handful of node kinds
 * that shape a single particle's look over time (scale, alpha, color,
 * rotation, spin) straight from their literal inputs and eases, using the same
 * `sampleEase` the shaders are generated from, so a curve shown here is the
 * curve that runs. Anything it cannot know without running the graph — an
 * input wired from another node, a knob — falls back to the node's literal or
 * schema default, which is the honest approximation for a thumbnail.
 */
import type { Literal, Node, System } from '@pylinka/graph';
import { getSchema, V1_CATALOG } from '@pylinka/graph';
import { sampleEase } from '@pylinka/compiler';

export type LifeProp = 'scale' | 'alpha' | 'color' | 'rotation';

export interface ParticleState {
  /** multiplier on the sprite's base size (8px × scale in the runtime) */
  scale: number;
  alpha: number;
  /** #rrggbb tint */
  color: string;
  /** degrees */
  rotation: number;
}

export const DEFAULT_STATE: ParticleState = { scale: 1, alpha: 1, color: '#ffffff', rotation: 0 };

/** A property driven over normalized age t ∈ [0,1]. */
export interface Track {
  prop: LifeProp;
  at(t: number, lifeSeconds: number): Partial<ParticleState>;
}

const WRITE_PROP: Record<string, LifeProp> = {
  'output.writeScale': 'scale',
  'output.writeAlpha': 'alpha',
  'output.writeColor': 'color',
  'output.writeRotation': 'rotation',
};

function literal(node: Node, port: string): Literal | undefined {
  return node.values?.[port] ?? getSchema(V1_CATALOG, node.kind)?.inputs.find((p) => p.id === port)?.defaultValue;
}

function num(node: Node, port: string, d: number): number {
  const l = literal(node, port);
  return l?.t === 'f32' ? l.v : d;
}

function color(node: Node, port: string, d: string): string {
  const l = literal(node, port);
  return l?.t === 'color' ? l.v : d;
}

function rgba(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  const p = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [p(0), p(2), p(4), h.length >= 8 ? p(6) : 1];
}

function toHex(c: number[]): string {
  return '#' + c.slice(0, 3).map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('');
}

/** Where a node's output lands: the write node it feeds, if any. */
function destinationOf(system: System, nodeId: string): Node | undefined {
  const e = system.graph.edges.find((x) => x.from.nodeId === nodeId && WRITE_PROP[kindOf(system, x.to.nodeId)] !== undefined);
  return e ? system.graph.nodes.find((n) => n.id === e.to.nodeId) : undefined;
}

function kindOf(system: System, id: string): string {
  return system.graph.nodes.find((n) => n.id === id)?.kind ?? '';
}

/** Degrees per unit of the angle the destination expects (writeRotation carries a unit). */
function degreesPerUnit(dest: Node | undefined): number {
  return dest?.structural?.unit === 'radians' ? 180 / Math.PI : 1;
}

/**
 * The track a node contributes, or undefined when it does not shape a single
 * particle's look over life (or its effect cannot be pictured on its own).
 */
export function trackFor(system: System, node: Node): Track | undefined {
  const ease = node.structural?.ease ?? 'linear';
  const e = (t: number) => sampleEase(ease, t);
  const dest = destinationOf(system, node.id);
  const destProp = dest ? WRITE_PROP[dest.kind] : undefined;

  switch (node.kind) {
    case 'gen.scaleOverLife': {
      const a = num(node, 'from', 1), b = num(node, 'to', 0);
      return { prop: 'scale', at: (t) => ({ scale: a + (b - a) * e(t) }) };
    }
    case 'gen.alphaOverLife': {
      const a = num(node, 'from', 1), b = num(node, 'to', 0);
      return { prop: 'alpha', at: (t) => ({ alpha: a + (b - a) * e(t) }) };
    }
    case 'gen.colorOverLife': {
      const a = rgba(color(node, 'from', '#ffffffff')), b = rgba(color(node, 'to', '#ffffff00'));
      return {
        prop: 'color',
        at: (t) => {
          const k = e(t);
          const c = a.map((x, i) => x + (b[i]! - x) * k);
          return { color: toHex(c), alpha: c[3] };
        },
      };
    }
    case 'gen.rotationOverLife': {
      const u = degreesPerUnit(dest);
      const a = num(node, 'from', 0) * u, b = num(node, 'to', 360) * u;
      return { prop: 'rotation', at: (t) => ({ rotation: a + (b - a) * e(t) }) };
    }
    case 'gen.spin': {
      // gen.spin declares its own unit; degrees unless it says radians
      const u = node.structural?.unit === 'radians' ? 180 / Math.PI : 1;
      const rate = num(node, 'rate', 180) * u;
      return { prop: 'rotation', at: (t, life) => ({ rotation: rate * t * life }) };
    }
    case 'gen.curveOverLife':
    case 'gen.numberOverLife': {
      // a generic ramp means whatever it is wired into
      if (!destProp || destProp === 'color') return undefined;
      const a = num(node, 'from', 0), b = num(node, 'to', 1);
      const u = destProp === 'rotation' ? degreesPerUnit(dest) : 1;
      return { prop: destProp, at: (t) => ({ [destProp]: (a + (b - a) * e(t)) * u }) };
    }
    default:
      return undefined;
  }
}

/** Mean lifetime in seconds, from the Init life node (a random range reads as its middle). */
export function lifeSeconds(system: System): number {
  const init = system.graph.nodes.find((n) => n.kind === 'output.initLife');
  if (!init) return 1;
  const edge = system.graph.edges.find((e) => e.to.nodeId === init.id && e.to.portId === 'life');
  if (!edge) return Math.max(0.05, num(init, 'life', 1));
  const src = system.graph.nodes.find((n) => n.id === edge.from.nodeId);
  if (src?.kind === 'gen.randomRange') return Math.max(0.05, (num(src, 'min', 1) + num(src, 'max', 1)) / 2);
  return 1;
}

/** Every track that reaches a write node, for the combined "one particle" preview. */
export function particleTracks(system: System, disabled: readonly string[] = []): Track[] {
  const tracks: Track[] = [];
  for (const w of system.graph.nodes) {
    if (WRITE_PROP[w.kind] === undefined || disabled.includes(w.id)) continue;
    const edge = system.graph.edges.find((e) => e.to.nodeId === w.id);
    const src = edge && system.graph.nodes.find((n) => n.id === edge.from.nodeId);
    if (!src || disabled.includes(src.id)) continue;
    const tr = trackFor(system, src);
    if (tr) tracks.push(tr);
  }
  return tracks;
}

export function stateAt(tracks: readonly Track[], t: number, life: number): ParticleState {
  const s = { ...DEFAULT_STATE };
  for (const tr of tracks) {
    const { alpha, ...rest } = tr.at(t, life);
    Object.assign(s, rest);
    // a color's alpha and an alpha ramp both fade the particle; they multiply
    if (alpha !== undefined) s.alpha *= alpha;
  }
  return s;
}

/** Largest |scale| a set of tracks reaches — the preview scales to fit it. */
export function peakScale(tracks: readonly Track[], life: number): number {
  let m = 0;
  for (let i = 0; i <= 32; i++) m = Math.max(m, Math.abs(stateAt(tracks, i / 32, life).scale));
  return m || 1;
}
