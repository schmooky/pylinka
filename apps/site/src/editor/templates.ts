/**
 * Starting points for a new emitter.
 *
 * An empty emitter is a spawn position and a lifetime and nothing else — true
 * to the model and useless as a beginning, because the first useful effect is
 * six nodes away and you have to know which six. These are those six, already
 * wired, for the shapes people actually reach for. Every one is a real graph
 * built from the ordinary catalog: fork it and take it apart.
 *
 * Deliberately small. A gallery of finished effects lives at /recipes; this is
 * the handful you would otherwise rebuild by hand every time.
 */
import type { Literal, Node, System } from '@pylinka/graph';

type Vec2 = [number, number];

const f = (v: number): Literal => ({ t: 'f32', v });
const v2 = (v: Vec2): Literal => ({ t: 'vec2', v });
const col = (v: string): Literal => ({ t: 'color', v });

interface Recipe {
  shape?: {
    kind: 'shape.point' | 'shape.circle' | 'shape.rectangle' | 'shape.burstRing';
    values: Node['values'];
  };
  life: Vec2;
  vel: { min: Vec2; max: Vec2 };
  gravity?: Vec2;
  drag?: number;
  /** field.vortex around the emitter: [tangential, inward pull, falloff radius] */
  vortex?: [number, number, number];
  /** field.turbulence: [strength, cell px, speed] */
  turbulence?: [number, number, number];
  color: [string, string];
  scale: [number, number];
  ease?: string;
}

/** Build one template's graph. Node ids are local; paste rewrites them. */
function build(r: Recipe): System['graph'] {
  const nodes: Node[] = [];
  const edges: System['graph']['edges'] = [];
  let e = 0;
  const link = (from: string, fp: string, to: string, tp: string) =>
    edges.push({ id: `te${e++}`, from: { nodeId: from, portId: fp }, to: { nodeId: to, portId: tp } });

  const shape = r.shape ?? { kind: 'shape.point' as const, values: { offset: v2([0, 0]) } };
  nodes.push({ id: 't1', kind: shape.kind, values: shape.values });
  nodes.push({ id: 't2', kind: 'output.spawnPosition' });
  link('t1', 'pos', 't2', 'pos');

  nodes.push({ id: 't3', kind: 'gen.randomRange', values: { min: f(r.life[0]), max: f(r.life[1]) } });
  nodes.push({ id: 't4', kind: 'output.initLife' });
  link('t3', 'out', 't4', 'life');

  nodes.push({ id: 't5', kind: 'gen.randomVec2', values: { min: v2(r.vel.min), max: v2(r.vel.max) } });
  nodes.push({ id: 't6', kind: 'output.initVelocity' });
  link('t5', 'out', 't6', 'vel');

  if (r.gravity) {
    nodes.push({ id: 't7', kind: 'field.gravity', values: { g: v2(r.gravity) } });
    nodes.push({ id: 't8', kind: 'output.addForce' });
    link('t7', 'force', 't8', 'force');
  }
  if (r.drag !== undefined) {
    nodes.push({ id: 't9', kind: 'field.drag', values: { coefficient: f(r.drag) } });
    nodes.push({ id: 't10', kind: 'output.drag' });
    link('t9', 'drag', 't10', 'drag');
  }

  if (r.vortex) {
    nodes.push({
      id: 't15',
      kind: 'field.vortex',
      values: {
        center: v2([0, 0]),
        strength: f(r.vortex[0]),
        pull: f(r.vortex[1]),
        radius: f(r.vortex[2]),
      },
    });
    nodes.push({ id: 't16', kind: 'output.addForce' });
    link('t15', 'force', 't16', 'force');
  }
  if (r.turbulence) {
    nodes.push({
      id: 't17',
      kind: 'field.turbulence',
      values: {
        strength: f(r.turbulence[0]),
        scale: f(r.turbulence[1]),
        speed: f(r.turbulence[2]),
      },
    });
    nodes.push({ id: 't18', kind: 'output.addForce' });
    link('t17', 'force', 't18', 'force');
  }

  nodes.push({
    id: 't11',
    kind: 'gen.colorOverLife',
    structural: { ease: r.ease ?? 'power2.out' },
    values: { from: col(r.color[0]), to: col(r.color[1]) },
  });
  nodes.push({ id: 't12', kind: 'output.writeColor' });
  link('t11', 'out', 't12', 'color');

  nodes.push({
    id: 't13',
    kind: 'gen.scaleOverLife',
    structural: { ease: r.ease ?? 'power2.out' },
    values: { from: f(r.scale[0]), to: f(r.scale[1]) },
  });
  nodes.push({ id: 't14', kind: 'output.writeScale' });
  link('t13', 'out', 't14', 'scale');

  return { nodes, edges };
}

export interface EmitterTemplate {
  id: string;
  name: string;
  /** one line saying what it does, not what it is made of */
  hint: string;
  system: Omit<System, 'id'>;
}

const sys = (
  name: string,
  emitter: System['emitter'],
  blendMode: System['blendMode'],
  capacity: number,
  r: Recipe,
): Omit<System, 'id'> => ({
  name,
  capacity,
  blendMode,
  enabled: true,
  space: 'world',
  emitter,
  graph: build(r),
});

export const EMITTER_TEMPLATES: EmitterTemplate[] = [
  {
    id: 'sparks',
    name: 'Sparks',
    hint: 'Hot flecks thrown upward that fall and cool.',
    system: sys('sparks', { mode: 'flow', rate: 300 }, 'add', 3000, {
      life: [0.5, 1.1],
      vel: { min: [-60, -160], max: [60, -260] },
      gravity: [0, 420],
      color: ['#ffe6a8ff', '#ff3c0000'],
      scale: [1.4, 0],
    }),
  },
  {
    id: 'smoke',
    name: 'Smoke',
    hint: 'Grey puffs that rise, spread and thin out.',
    system: sys('smoke', { mode: 'flow', rate: 90 }, 'normal', 1500, {
      shape: { kind: 'shape.circle', values: { radius: f(16) } },
      life: [1.4, 2.6],
      vel: { min: [-12, -30], max: [12, -70] },
      gravity: [0, -20],
      drag: 0.8,
      color: ['#d0d0d0aa', '#55555500'],
      scale: [0.6, 2.6],
      ease: 'sine.out',
    }),
  },
  {
    id: 'trail',
    name: 'Trail',
    hint: 'A tight streak that drags to a stop behind a moving emitter.',
    system: sys('trail', { mode: 'flow', rate: 420, rateOverDistance: 1.6 }, 'add', 3000, {
      life: [0.4, 0.9],
      vel: { min: [-14, -14], max: [14, 14] },
      drag: 1.8,
      color: ['#bfe9ffff', '#3a7cff00'],
      scale: [1.1, 0],
    }),
  },
  {
    id: 'burst',
    name: 'Burst',
    hint: 'A radial pop, once every couple of seconds.',
    system: sys(
      'burst',
      { mode: 'burst', rate: 0, burst: { count: 90, interval: 1.6 } },
      'add',
      1200,
      {
        life: [0.6, 1.2],
        vel: { min: [-280, -280], max: [280, 280] },
        gravity: [0, 180],
        drag: 0.9,
        color: ['#ffffffff', '#ff9c3c00'],
        scale: [1.6, 0.2],
      },
    ),
  },
  {
    id: 'fall',
    name: 'Falling',
    hint: 'A wide curtain drifting down the frame — snow, ash, confetti.',
    system: sys('falling', { mode: 'flow', rate: 60 }, 'normal', 1200, {
      shape: { kind: 'shape.rectangle', values: { size: v2([520, 10]) } },
      life: [2.2, 3.6],
      vel: { min: [-18, 40], max: [18, 110] },
      gravity: [0, 40],
      drag: 0.4,
      color: ['#ffffffff', '#ffffff33'],
      scale: [0.9, 0.7],
      ease: 'sine.inOut',
    }),
  },
  {
    id: 'fountain',
    name: 'Fountain',
    hint: 'A jet thrown up that arcs over and falls back.',
    system: sys('fountain', { mode: 'flow', rate: 260 }, 'add', 3000, {
      shape: { kind: 'shape.circle', values: { radius: f(10) } },
      life: [1.1, 1.9],
      vel: { min: [-90, -320], max: [90, -460] },
      gravity: [0, 520],
      color: ['#bfe0ffff', '#2f6fff00'],
      scale: [1.2, 0.2],
    }),
  },
  {
    id: 'vortex',
    name: 'Vortex',
    hint: 'Everything caught in a slow swirl around the centre.',
    system: sys('vortex', { mode: 'flow', rate: 160 }, 'add', 2000, {
      shape: { kind: 'shape.circle', values: { radius: f(56) } },
      life: [1.6, 2.8],
      vel: { min: [-10, -10], max: [10, 10] },
      drag: 0.1,
      vortex: [1400, 110, 320],
      color: ['#e8d8ffff', '#5a2fd000'],
      scale: [1.3, 0.4],
      ease: 'sine.out',
    }),
  },
  {
    id: 'fireflies',
    name: 'Fireflies',
    hint: 'Slow motes wandering on a turbulent breeze.',
    system: sys('fireflies', { mode: 'flow', rate: 30 }, 'add', 500, {
      shape: { kind: 'shape.rectangle', values: { size: v2([460, 300]) } },
      life: [2.4, 4],
      vel: { min: [-8, -8], max: [8, 8] },
      drag: 0.6,
      turbulence: [90, 130, 0.6],
      color: ['#fff2b0ff', '#ffb03c00'],
      scale: [0.8, 0.3],
      ease: 'sine.inOut',
    }),
  },
  {
    id: 'shockwave',
    name: 'Shockwave',
    hint: 'A ring that expands and thins, once every beat.',
    system: sys(
      'shockwave',
      { mode: 'burst', rate: 0, burst: { count: 120, interval: 1.4 } },
      'add',
      600,
      {
        shape: { kind: 'shape.burstRing', values: { radius: f(24) } },
        life: [0.5, 0.7],
        vel: { min: [-420, -420], max: [420, 420] },
        drag: 2.4,
        color: ['#ffffffff', '#7fd4ff00'],
        scale: [1.1, 0.2],
        ease: 'expo.out',
      },
    ),
  },
  {
    id: 'rain',
    name: 'Rain',
    hint: 'Fast streaks falling on a slant.',
    system: sys('rain', { mode: 'flow', rate: 220 }, 'normal', 2000, {
      shape: { kind: 'shape.rectangle', values: { size: v2([620, 8]) } },
      life: [0.8, 1.2],
      vel: { min: [40, 520], max: [90, 720] },
      color: ['#cfe4ffcc', '#8fb4ff22'],
      scale: [0.7, 0.5],
      ease: 'linear',
    }),
  },
  {
    id: 'glow',
    name: 'Glow',
    hint: 'One soft flash at the start — a hit, a pickup, a pop.',
    system: sys('glow', { mode: 'once', rate: 0, burst: { count: 30, interval: 0 } }, 'add', 200, {
      life: [0.3, 0.5],
      vel: { min: [-40, -40], max: [40, 40] },
      drag: 3,
      color: ['#ffffffff', '#ffd28a00'],
      scale: [3.2, 0],
      ease: 'expo.out',
    }),
  },
];
