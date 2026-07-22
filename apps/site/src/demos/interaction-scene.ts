/**
 * Scene for the /interactive lab: a particle field that something moves through.
 *
 * Three systems on one canvas —
 *   dust    a standing field of motes. Two `field.obstacle` nodes push it: one
 *           bound to the flying orb, one to the cursor. Both read live vec2
 *           knobs, so no recompile and no graph edit per frame.
 *   embers  heavier sparks under gravity that actually COLLIDE: walls + floor
 *           (`output.collideRect` inside), a crate (`collideRect` outside) and
 *           the orb itself (`collideCircle`, fed the orb's velocity so a moving
 *           wall kicks what it hits).
 *   trail   short-lived sparks emitted from the orb, so the body reads as a body.
 *
 * Knob names are the contract with the page: orb / orbVel / cursor / cursorVel.
 */
import type { Edge, Literal, Node, ParamDef, PylinkaProject, System } from '@pylinka/graph';

const f = (v: number): Literal => ({ t: 'f32', v });
const v2 = (x: number, y: number): Literal => ({ t: 'vec2', v: [x, y] });
const col = (v: string): Literal => ({ t: 'color', v });

export const KNOBS: ParamDef[] = [
  { id: 'k_orb', name: 'orb', type: 'vec2', scale: 'linear', default: v2(0, 0) },
  { id: 'k_orbVel', name: 'orbVel', type: 'vec2', scale: 'linear', default: v2(0, 0) },
  { id: 'k_cursor', name: 'cursor', type: 'vec2', scale: 'linear', default: v2(-9999, -9999) },
  { id: 'k_cursorVel', name: 'cursorVel', type: 'vec2', scale: 'linear', default: v2(0, 0) },
];

export interface SceneGeometry {
  /** world size in px (device pixels — the page renders 1 world px = 1 device px) */
  width: number;
  height: number;
  /** y of the floor */
  floorY: number;
  /** the solid crate the embers bounce off */
  crate: { x: number; y: number; w: number; h: number };
  /** radius of the flying orb's solid core */
  orbRadius: number;
}

export function geometryFor(width: number, height: number): SceneGeometry {
  return {
    width,
    height,
    floorY: height - Math.round(height * 0.08),
    crate: {
      x: Math.round(width * 0.62),
      y: height - Math.round(height * 0.08) - Math.round(height * 0.22),
      w: Math.round(width * 0.16),
      h: Math.round(height * 0.22),
    },
    orbRadius: Math.max(34, Math.round(Math.min(width, height) * 0.045)),
  };
}

/** Small helper: build a graph from a node list + `from>to` edge shorthand. */
function graph(nodes: Node[], links: string[]): { nodes: Node[]; edges: Edge[] } {
  const edges: Edge[] = links.map((l, i) => {
    const [from, to] = l.split('>') as [string, string];
    const [fn, fp] = from.split('.') as [string, string];
    const [tn, tp] = to.split('.') as [string, string];
    return { id: `e${i}`, from: { nodeId: fn, portId: fp }, to: { nodeId: tn, portId: tp } };
  });
  return { nodes, edges };
}

function dustSystem(g: SceneGeometry): System {
  return {
    id: 'dust',
    name: 'dust',
    // dense enough that the hole the orb punches reads as displaced smoke
    // rather than as individual stars going missing
    capacity: 70000,
    blendMode: 'add',
    enabled: true,
    space: 'world',
    emitter: { mode: 'flow', rate: 7000 },
    graph: graph(
      [
        { id: 'n1', kind: 'shape.rectangle', values: { size: v2(g.width * 1.05, g.height * 1.05) } },
        { id: 'n2', kind: 'output.spawnPosition' },
        { id: 'n3', kind: 'gen.randomRange', values: { min: f(7), max: f(13) } },
        { id: 'n4', kind: 'output.initLife' },
        { id: 'n5', kind: 'gen.randomVec2', values: { min: v2(-14, -10), max: v2(14, 10) } },
        { id: 'n6', kind: 'output.initVelocity' },
        // a slow curl so the field breathes instead of sitting still
        {
          id: 'n7',
          kind: 'field.turbulence',
          values: { strength: f(14), scale: f(320), speed: f(0.18) },
        },
        { id: 'n8', kind: 'output.addForce' },
        { id: 'n9', kind: 'field.drag', values: { coefficient: f(1.4) } },
        { id: 'n10', kind: 'output.drag' },
        // the flying orb: hard push + a strong swirl, and `carry` drags motes
        // along with it — that's the bow wave and the wake behind it
        {
          id: 'n11',
          kind: 'field.obstacle',
          knobBindings: { center: 'k_orb', velocity: 'k_orbVel' },
          values: {
            center: v2(0, 0),
            velocity: v2(0, 0),
            radius: f(g.orbRadius * 4.6),
            strength: f(5200),
            softness: f(0.8),
            swirl: f(1500),
            carry: f(2.6),
          },
        },
        { id: 'n12', kind: 'output.addForce' },
        // the cursor: softer, mostly a gust of wind you drag around
        {
          id: 'n13',
          kind: 'field.obstacle',
          knobBindings: { center: 'k_cursor', velocity: 'k_cursorVel' },
          values: {
            center: v2(-9999, -9999),
            velocity: v2(0, 0),
            radius: f(190),
            strength: f(2200),
            softness: f(0.85),
            swirl: f(420),
            carry: f(1.6),
          },
        },
        { id: 'n14', kind: 'output.addForce' },
        {
          id: 'n15',
          kind: 'gen.colorOverLife',
          structural: { ease: 'sine.inOut' },
          // big, faint, additive quads: they overlap into a haze instead of
          // reading as separate specks (and it's the blend/overdraw path that
          // actually stresses the ROP, which is the point of a lab scene)
          values: { from: col('#7fb8ff26'), to: col('#d8ecff00') },
        },
        { id: 'n16', kind: 'output.writeColor' },
        {
          id: 'n17',
          kind: 'gen.scaleOverLife',
          structural: { ease: 'sine.inOut' },
          values: { from: f(0.7), to: f(0.6) },
        },
        { id: 'n18', kind: 'output.writeScale' },
      ],
      [
        'n1.pos>n2.pos',
        'n3.out>n4.life',
        'n5.out>n6.vel',
        'n7.force>n8.force',
        'n9.drag>n10.drag',
        'n11.force>n12.force',
        'n13.force>n14.force',
        'n15.out>n16.color',
        'n17.out>n18.scale',
      ],
    ),
  };
}

function emberSystem(g: SceneGeometry): System {
  const { crate } = g;
  return {
    id: 'embers',
    name: 'embers',
    capacity: 4000,
    blendMode: 'add',
    enabled: true,
    space: 'world',
    emitter: { mode: 'flow', rate: 220 },
    graph: graph(
      [
        { id: 'n1', kind: 'shape.rectangle', values: { size: v2(g.width * 0.9, 8) } },
        { id: 'n2', kind: 'output.spawnPosition' },
        { id: 'n3', kind: 'gen.randomRange', values: { min: f(5), max: f(9) } },
        { id: 'n4', kind: 'output.initLife' },
        { id: 'n5', kind: 'gen.randomVec2', values: { min: v2(-70, 20), max: v2(70, 90) } },
        { id: 'n6', kind: 'output.initVelocity' },
        { id: 'n7', kind: 'field.gravity', values: { g: v2(0, 620) } },
        { id: 'n8', kind: 'output.addForce' },
        { id: 'n9', kind: 'field.drag', values: { coefficient: f(0.12) } },
        { id: 'n10', kind: 'output.drag' },
        // walls + floor in one box (the ceiling sits far above the viewport)
        {
          id: 'n11',
          kind: 'output.collideRect',
          structural: { mode: 'inside' },
          values: {
            min: v2(6, -4000),
            max: v2(g.width - 6, g.floorY),
            restitution: f(0.42),
            friction: f(0.22),
          },
        },
        // the crate: a solid they have to bounce off or roll down
        {
          id: 'n12',
          kind: 'output.collideRect',
          structural: { mode: 'outside' },
          values: {
            min: v2(crate.x, crate.y),
            max: v2(crate.x + crate.w, crate.y + crate.h),
            restitution: f(0.38),
            friction: f(0.3),
          },
        },
        // and the orb itself — a moving wall, so it punts them
        {
          id: 'n13',
          kind: 'output.collideCircle',
          structural: { mode: 'outside' },
          knobBindings: { center: 'k_orb', velocity: 'k_orbVel' },
          values: {
            center: v2(0, 0),
            radius: f(g.orbRadius),
            restitution: f(0.72),
            friction: f(0.05),
            velocity: v2(0, 0),
          },
        },
        {
          id: 'n14',
          kind: 'gen.colorOverLife',
          structural: { ease: 'power2.out' },
          values: { from: col('#ffd9a3ff'), to: col('#ff7a3c00') },
        },
        { id: 'n15', kind: 'output.writeColor' },
        {
          id: 'n16',
          kind: 'gen.scaleOverLife',
          structural: { ease: 'linear' },
          values: { from: f(0.62), to: f(0.4) },
        },
        { id: 'n17', kind: 'output.writeScale' },
      ],
      [
        'n1.pos>n2.pos',
        'n3.out>n4.life',
        'n5.out>n6.vel',
        'n7.force>n8.force',
        'n9.drag>n10.drag',
        'n14.out>n15.color',
        'n16.out>n17.scale',
      ],
    ),
  };
}

function trailSystem(g: SceneGeometry): System {
  return {
    id: 'trail',
    name: 'trail',
    capacity: 3000,
    blendMode: 'add',
    enabled: true,
    space: 'world',
    emitter: { mode: 'flow', rate: 460, rateOverDistance: 0.9 },
    graph: graph(
      [
        { id: 'n1', kind: 'shape.circle', values: { radius: f(g.orbRadius * 0.75) } },
        { id: 'n2', kind: 'output.spawnPosition' },
        { id: 'n3', kind: 'gen.randomRange', values: { min: f(0.35), max: f(0.9) } },
        { id: 'n4', kind: 'output.initLife' },
        { id: 'n5', kind: 'gen.randomVec2', values: { min: v2(-40, -40), max: v2(40, 40) } },
        { id: 'n6', kind: 'output.initVelocity' },
        { id: 'n7', kind: 'field.drag', values: { coefficient: f(2.2) } },
        { id: 'n8', kind: 'output.drag' },
        {
          id: 'n9',
          kind: 'gen.colorOverLife',
          structural: { ease: 'power2.out' },
          values: { from: col('#eaf7ffff'), to: col('#3ba7ff00') },
        },
        { id: 'n10', kind: 'output.writeColor' },
        {
          id: 'n11',
          kind: 'gen.scaleOverLife',
          structural: { ease: 'power2.out' },
          values: { from: f(0.9), to: f(0) },
        },
        { id: 'n12', kind: 'output.writeScale' },
      ],
      [
        'n1.pos>n2.pos',
        'n3.out>n4.life',
        'n5.out>n6.vel',
        'n7.drag>n8.drag',
        'n9.out>n10.color',
        'n11.out>n12.scale',
      ],
    ),
  };
}

export function buildProject(g: SceneGeometry): PylinkaProject {
  return {
    format: 'pylinka/v1',
    version: 1,
    catalogVersion: 1,
    id: 'interaction-lab',
    name: 'Interaction lab',
    createdAt: '2026-07-22T00:00:00Z',
    updatedAt: '2026-07-22T00:00:00Z',
    params: KNOBS,
    assets: [],
    systems: [dustSystem(g), emberSystem(g), trailSystem(g)],
  };
}
