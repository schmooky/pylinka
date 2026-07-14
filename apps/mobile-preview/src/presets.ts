/**
 * Curated probe presets — a hand-tuned series built for this harness (not the
 * site's recipe gallery). Each is visually distinct, uses a centred emitter,
 * and keeps particles chunky enough to read on a phone. The finale runs
 * 10,000,000 particles at once (10 systems × 1M) as a GPU stress test.
 */
import type { Literal, Node, PylinkaProject, System } from '@pylinka/graph';

type Vec2 = [number, number];
const f = (v: number): Literal => ({ t: 'f32', v });
const v2 = (v: Vec2): Literal => ({ t: 'vec2', v });
const col = (v: string): Literal => ({ t: 'color', v });

const META = {
  format: 'pylinka/v1' as const,
  version: 1,
  catalogVersion: 1,
  createdAt: '2026-07-14T00:00:00Z',
  updatedAt: '2026-07-14T00:00:00Z',
};

interface SysOpts {
  capacity: number;
  blend?: System['blendMode'];
  mode?: 'flow' | 'burst';
  rate?: number;
  burstCount?: number;
  burstInterval?: number;
  shape?: 'point' | 'circle' | 'rect';
  radius?: number;
  size?: Vec2;
  velMin: Vec2;
  velMax: Vec2;
  lifeMin: number;
  lifeMax: number;
  gravity?: Vec2;
  drag?: number;
  wind?: Vec2; // [strength, angle]
  vortex?: [number, number, number]; // [tangential, inward pull, radius]
  turb?: [number, number, number]; // [strength, cell px, speed]
  colorFrom: string;
  colorTo: string;
  colorEase?: string;
  scaleFrom: number;
  scaleTo?: number;
  scaleEase?: string;
}

/** Build one System graph (mirrors the site's fx builder, trimmed). */
function buildSystem(o: SysOpts, id: string, prefix: string, name: string): System {
  const nodes: Node[] = [];
  const edges: System['graph']['edges'] = [];
  let e = 0;
  const nid = (n: number) => `${prefix}${n}`;
  const link = (fromN: number, fromP: string, toN: number, toP: string) =>
    edges.push({ id: `${prefix}e${e++}`, from: { nodeId: nid(fromN), portId: fromP }, to: { nodeId: nid(toN), portId: toP } });

  if (o.shape === 'circle') nodes.push({ id: nid(1), kind: 'shape.circle', values: { radius: f(o.radius ?? 40) } });
  else if (o.shape === 'rect') nodes.push({ id: nid(1), kind: 'shape.rectangle', values: { size: v2(o.size ?? [100, 100]) } });
  else nodes.push({ id: nid(1), kind: 'shape.point', values: { offset: v2([0, 0]) } });
  nodes.push({ id: nid(2), kind: 'output.spawnPosition' });
  link(1, 'pos', 2, 'pos');

  nodes.push({ id: nid(3), kind: 'gen.randomRange', values: { min: f(o.lifeMin), max: f(o.lifeMax) } });
  nodes.push({ id: nid(4), kind: 'output.initLife' });
  link(3, 'out', 4, 'life');

  nodes.push({ id: nid(5), kind: 'gen.randomVec2', values: { min: v2(o.velMin), max: v2(o.velMax) } });
  nodes.push({ id: nid(6), kind: 'output.initVelocity' });
  link(5, 'out', 6, 'vel');

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
  if (o.wind) {
    nodes.push({ id: nid(11), kind: 'field.directional', values: { strength: f(o.wind[0]), angle: f(o.wind[1]) } });
    nodes.push({ id: nid(12), kind: 'output.addForce' });
    link(11, 'force', 12, 'force');
  }
  if (o.vortex) {
    nodes.push({ id: nid(17), kind: 'field.vortex', values: { center: v2([0, 0]), strength: f(o.vortex[0]), pull: f(o.vortex[1]), radius: f(o.vortex[2]) } });
    nodes.push({ id: nid(18), kind: 'output.addForce' });
    link(17, 'force', 18, 'force');
  }
  if (o.turb) {
    nodes.push({ id: nid(19), kind: 'field.turbulence', values: { strength: f(o.turb[0]), scale: f(o.turb[1]), speed: f(o.turb[2]) } });
    nodes.push({ id: nid(20), kind: 'output.addForce' });
    link(19, 'force', 20, 'force');
  }

  nodes.push({ id: nid(21), kind: 'gen.colorOverLife', structural: { ease: o.colorEase ?? 'linear' }, values: { from: col(o.colorFrom), to: col(o.colorTo) } });
  nodes.push({ id: nid(22), kind: 'output.writeColor' });
  link(21, 'out', 22, 'color');

  nodes.push({ id: nid(23), kind: 'gen.scaleOverLife', structural: { ease: o.scaleEase ?? 'linear' }, values: { from: f(o.scaleFrom), to: f(o.scaleTo ?? 0) } });
  nodes.push({ id: nid(24), kind: 'output.writeScale' });
  link(23, 'out', 24, 'scale');

  const emitter: System['emitter'] =
    o.mode === 'burst'
      ? { mode: 'burst', rate: 0, burst: { count: o.burstCount ?? 150, interval: o.burstInterval ?? 1.4 } }
      : { mode: 'flow', rate: o.rate ?? 400, rateOverDistance: 0 };

  return { id, name, capacity: o.capacity, blendMode: o.blend ?? 'add', enabled: true, space: 'world', emitter, graph: { nodes, edges } };
}

export interface Preset {
  title: string;
  group: string;
  tags: string[];
  project: PylinkaProject;
}

/** One system → one preset. */
function fx(title: string, group: string, tags: string[], o: SysOpts): Preset {
  return {
    title,
    group,
    tags,
    project: { ...META, id: title, name: title, params: [], assets: [], systems: [buildSystem(o, 's1', 'n', 'fx')] },
  };
}

const PI = Math.PI;

export const PRESETS: Preset[] = [
  // 1 — arcing gold fountain
  fx('Fountain', 'flow', ['gravity', 'gold'], {
    capacity: 6000, rate: 900, velMin: [-90, -520], velMax: [90, -360], lifeMin: 1.4, lifeMax: 2.2,
    gravity: [0, 520], colorFrom: '#fff1b8ff', colorTo: '#ff5a1e00', colorEase: 'power2.out',
    scaleFrom: 2.6, scaleTo: 0.4, scaleEase: 'power2.out',
  }),
  // 2 — tight cyan vortex
  fx('Cyan Vortex', 'vortex', ['vortex', 'swirl'], {
    capacity: 9000, rate: 1100, shape: 'circle', radius: 170, velMin: [-15, -15], velMax: [15, 15],
    lifeMin: 1.8, lifeMax: 3, drag: 0.4, vortex: [1000, 260, 420],
    colorFrom: '#7df9ffff', colorTo: '#1e40af00', colorEase: 'sine.out', scaleFrom: 2.2, scaleTo: 0.5,
  }),
  // 3 — slow galaxy spiral (vortex + turbulence)
  fx('Galaxy Spiral', 'vortex', ['vortex', 'stars', 'turbulence'], {
    capacity: 16000, rate: 1400, shape: 'circle', radius: 280, velMin: [-8, -8], velMax: [8, 8],
    lifeMin: 3.5, lifeMax: 6, vortex: [280, 55, 0], turb: [70, 240, 0.35],
    colorFrom: '#eaf2ffff', colorTo: '#9b6bff00', colorEase: 'sine.out', scaleFrom: 1.6, scaleTo: 0.3,
  }),
  // 4 — periodic radial supernova
  fx('Supernova', 'burst', ['burst', 'explosion'], {
    capacity: 12000, mode: 'burst', burstCount: 900, burstInterval: 1.6, shape: 'circle', radius: 20,
    velMin: [-520, -520], velMax: [520, 520], lifeMin: 1.1, lifeMax: 2, drag: 0.7,
    colorFrom: '#ffffffff', colorTo: '#ff2a0000', colorEase: 'power2.in',
    scaleFrom: 3, scaleTo: 0, scaleEase: 'power2.in',
  }),
  // 5 — downpour
  fx('Downpour', 'flow', ['rain', 'gravity'], {
    capacity: 8000, rate: 1200, shape: 'rect', size: [520, 40], velMin: [-20, 120], velMax: [20, 300],
    lifeMin: 1.4, lifeMax: 2.4, gravity: [0, 700], colorFrom: '#bfe9ffff', colorTo: '#3a6bd400',
    colorEase: 'linear', scaleFrom: 1.6, scaleTo: 1.2,
  }),
  // 6 — turbulent nebula gas
  fx('Nebula', 'field', ['turbulence', 'gas'], {
    capacity: 12000, rate: 900, blend: 'screen', shape: 'circle', radius: 210, velMin: [-14, -14], velMax: [14, 14],
    lifeMin: 3, lifeMax: 5.5, drag: 0.5, turb: [430, 150, 0.5],
    colorFrom: '#ff7be6cc', colorTo: '#5b2bff00', colorEase: 'sine.inOut', scaleFrom: 3.2, scaleTo: 1.4, scaleEase: 'sine.inOut',
  }),
  // 7 — black hole pull-in
  fx('Black Hole', 'vortex', ['vortex', 'pull'], {
    capacity: 14000, rate: 1500, shape: 'circle', radius: 300, velMin: [-12, -12], velMax: [12, 12],
    lifeMin: 1.6, lifeMax: 2.8, vortex: [480, 720, 0],
    colorFrom: '#d7c4ffff', colorTo: '#ffffff00', colorEase: 'power2.in', scaleFrom: 2, scaleTo: 0.25,
  }),
  // 8 — cyclone funnel (vortex + updraft)
  fx('Cyclone', 'vortex', ['vortex', 'wind'], {
    capacity: 11000, rate: 1300, shape: 'rect', size: [90, 320], velMin: [-25, -30], velMax: [25, 30],
    lifeMin: 1.2, lifeMax: 2.2, vortex: [1300, 240, 300], wind: [180, -PI / 2],
    colorFrom: '#e8eef6ff', colorTo: '#5b6b8000', colorEase: 'sine.out', scaleFrom: 1.7, scaleTo: 2.6, scaleEase: 'sine.out',
  }),
  // 9 — expanding ring pulses
  fx('Ring Pulse', 'burst', ['burst', 'rings'], {
    capacity: 9000, mode: 'burst', burstCount: 700, burstInterval: 1.1, shape: 'circle', radius: 12,
    velMin: [-360, -360], velMax: [360, 360], lifeMin: 1.2, lifeMax: 1.5, drag: 0.9,
    colorFrom: '#7cffd8ff', colorTo: '#0e7c9a00', colorEase: 'sine.out', scaleFrom: 2.4, scaleTo: 0.2,
  }),
  // 10 — fire devil (vortex + turbulence + updraft)
  fx('Ember Devil', 'vortex', ['vortex', 'fire'], {
    capacity: 13000, rate: 1500, shape: 'circle', radius: 90, velMin: [-40, -160], velMax: [40, -40],
    lifeMin: 1, lifeMax: 2, gravity: [0, -220], vortex: [1000, 200, 320], turb: [150, 90, 1.2],
    colorFrom: '#fff0a8ff', colorTo: '#e0341800', colorEase: 'power2.out', scaleFrom: 2.4, scaleTo: 0,
  }),
  // 11 — aurora drift
  fx('Aurora Drift', 'field', ['turbulence', 'ambient'], {
    capacity: 10000, rate: 700, blend: 'screen', shape: 'rect', size: [560, 120], velMin: [-10, -24], velMax: [10, -6],
    lifeMin: 3.5, lifeMax: 6, drag: 0.3, turb: [120, 220, 0.3], wind: [30, -PI / 2],
    colorFrom: '#8affc6cc', colorTo: '#2a9bff00', colorEase: 'sine.inOut', scaleFrom: 2.8, scaleTo: 1.2, scaleEase: 'sine.inOut',
  }),
];

// 12 — the finale: 10,000,000 particles at once (10 systems × 1,000,000),
// a giant vortex galaxy. This is a deliberate GPU stress test; fps will drop.
const MILLION = 1_000_000;
const finaleSystems: System[] = Array.from({ length: 10 }, (_, i) =>
  buildSystem(
    {
      capacity: MILLION,
      rate: 170_000, // saturate the pool: ~1M alive per system
      shape: 'circle',
      radius: 320,
      velMin: [-10, -10],
      velMax: [10, 10],
      lifeMin: 5,
      lifeMax: 9,
      vortex: [360 + i * 12, 70, 0],
      turb: [60, 260, 0.3],
      colorFrom: i % 2 ? '#bfe0ffff' : '#ffd0f0ff',
      colorTo: '#7b3bff00',
      colorEase: 'sine.out',
      scaleFrom: 0.5,
      scaleTo: 0.15,
    },
    `s${i + 1}`,
    String.fromCharCode(97 + i), // a,b,c… unique node-id prefixes
    `swarm-${i + 1}`,
  ),
);

PRESETS.push({
  title: '10 Million',
  group: 'stress',
  tags: ['vortex', '10M', 'stress'],
  project: { ...META, id: '10-million', name: '10 Million', params: [], assets: [], systems: finaleSystems },
});
