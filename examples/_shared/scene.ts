/**
 * Tiny effect-graph builder shared by the example apps.
 *
 * In real life you AUTHOR these graphs in the pylinka editor and export a
 * `.pylinka.json` — the project describes the *simulation* only, never the art.
 * This helper just lets the examples spell a handful of effects inline so the
 * interesting part of each `main.ts` stays about **pixi + textures**, not about
 * hand-writing node graphs. Read `main.ts` first; this is the boring part.
 */
import type { Literal, Node, PylinkaProject, System } from '@pylinka/graph';

type Vec2 = [number, number];
const f = (v: number): Literal => ({ t: 'f32', v });
const v2 = (v: Vec2): Literal => ({ t: 'vec2', v });
const col = (v: string): Literal => ({ t: 'color', v });

export interface EmitterOpts {
  blend?: System['blendMode'];
  capacity?: number;
  /** flow (steady rate) or burst (count every interval) */
  mode?: 'flow' | 'burst';
  rate?: number;
  burst?: { count: number; interval: number };
  shape?: 'point' | 'circle' | 'rect';
  radius?: number;
  size?: Vec2;
  velMin: Vec2;
  velMax: Vec2;
  lifeMin: number;
  lifeMax: number;
  gravity?: Vec2;
  drag?: number;
  /** field.vortex around the emitter: [tangential strength, inward pull, radius] */
  vortex?: [number, number, number];
  colorFrom: string;
  colorTo: string;
  colorEase?: string;
  scaleFrom?: number;
  scaleTo?: number;
}

/** Build one System (emitter + node graph). `idp` prefixes node ids so several
 *  systems can live in one project without id clashes. */
export function emitter(name: string, idp: string, o: EmitterOpts): System {
  const nodes: Node[] = [];
  const edges: System['graph']['edges'] = [];
  let e = 0;
  const nid = (n: number) => `${idp}${n}`;
  const link = (fn: number, fp: string, tn: number, tp: string) =>
    edges.push({ id: `${idp}e${e++}`, from: { nodeId: nid(fn), portId: fp }, to: { nodeId: nid(tn), portId: tp } });

  // where particles are born
  if (o.shape === 'circle') nodes.push({ id: nid(1), kind: 'shape.circle', values: { radius: f(o.radius ?? 30) } });
  else if (o.shape === 'rect') nodes.push({ id: nid(1), kind: 'shape.rectangle', values: { size: v2(o.size ?? [100, 100]) } });
  else nodes.push({ id: nid(1), kind: 'shape.point', values: { offset: v2([0, 0]) } });
  nodes.push({ id: nid(2), kind: 'output.spawnPosition' });
  link(1, 'pos', 2, 'pos');

  // how long they live + their launch velocity
  nodes.push({ id: nid(3), kind: 'gen.randomRange', values: { min: f(o.lifeMin), max: f(o.lifeMax) } });
  nodes.push({ id: nid(4), kind: 'output.initLife' });
  link(3, 'out', 4, 'life');
  nodes.push({ id: nid(5), kind: 'gen.randomVec2', values: { min: v2(o.velMin), max: v2(o.velMax) } });
  nodes.push({ id: nid(6), kind: 'output.initVelocity' });
  link(5, 'out', 6, 'vel');

  // forces
  if (o.gravity && (o.gravity[0] !== 0 || o.gravity[1] !== 0)) {
    nodes.push({ id: nid(7), kind: 'field.gravity', values: { g: v2(o.gravity) } });
    nodes.push({ id: nid(8), kind: 'output.addForce' });
    link(7, 'force', 8, 'force');
  }
  if (o.drag) {
    nodes.push({ id: nid(9), kind: 'field.drag', values: { coefficient: f(o.drag) } });
    nodes.push({ id: nid(10), kind: 'output.drag' });
    link(9, 'drag', 10, 'drag');
  }
  if (o.vortex) {
    nodes.push({ id: nid(11), kind: 'field.vortex', values: { center: v2([0, 0]), strength: f(o.vortex[0]), pull: f(o.vortex[1]), radius: f(o.vortex[2]) } });
    nodes.push({ id: nid(12), kind: 'output.addForce' });
    link(11, 'force', 12, 'force');
  }

  // look: colour + size over life
  nodes.push({ id: nid(13), kind: 'gen.colorOverLife', structural: { ease: o.colorEase ?? 'linear' }, values: { from: col(o.colorFrom), to: col(o.colorTo) } });
  nodes.push({ id: nid(14), kind: 'output.writeColor' });
  link(13, 'out', 14, 'color');
  nodes.push({ id: nid(15), kind: 'gen.scaleOverLife', structural: { ease: 'linear' }, values: { from: f(o.scaleFrom ?? 1), to: f(o.scaleTo ?? 0) } });
  nodes.push({ id: nid(16), kind: 'output.writeScale' });
  link(15, 'out', 16, 'scale');

  const em: System['emitter'] =
    o.mode === 'burst'
      ? { mode: 'burst', rate: 0, burst: o.burst ?? { count: 60, interval: 1.5 } }
      : { mode: 'flow', rate: o.rate ?? 120 };

  return { id: idp, name, capacity: o.capacity ?? 1500, blendMode: o.blend ?? 'add', enabled: true, space: 'world', emitter: em, graph: { nodes, edges } };
}

const META = { format: 'pylinka/v1' as const, version: 1, catalogVersion: 1, createdAt: '2026-07-24T00:00:00Z', updatedAt: '2026-07-24T00:00:00Z' };

/** Wrap systems into a project the runtime can boot. */
export function project(id: string, systems: System[]): PylinkaProject {
  return { ...META, id, name: id, params: [], assets: [], systems };
}
