/**
 * 20 worked recipes. Each is a real PylinkaProject built from the common node
 * set the WebGL2 runtime interprets, so every one renders live in the gallery.
 */
import type { Literal, Node, PylinkaProject, System } from '@pylinka/graph';

export type RecipeGroup = 'trails' | 'fire' | 'magic' | 'ambient' | 'ui' | 'abstract';

export interface Recipe {
  slug: string;
  title: string;
  group: RecipeGroup;
  oneLiner: string;
  tags: string[];
  project: PylinkaProject;
}

type Vec2 = [number, number];

interface FxOpts {
  slug: string;
  title: string;
  group: RecipeGroup;
  oneLiner: string;
  tags: string[];
  capacity?: number;
  blend?: System['blendMode'];
  mode?: 'flow' | 'burst';
  rate?: number;
  rod?: number;
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
  wind?: Vec2; // [power, angle]
  colorFrom: string;
  colorTo: string;
  colorEase?: string;
  scaleFrom?: number;
  scaleTo?: number;
  scaleEase?: string;
}

const f = (v: number): Literal => ({ t: 'f32', v });
const v2 = (v: Vec2): Literal => ({ t: 'vec2', v });
const col = (v: string): Literal => ({ t: 'color', v });

function fx(o: FxOpts): Recipe {
  const nodes: Node[] = [];
  const edges: System['graph']['edges'] = [];
  let e = 0;
  const link = (fromN: string, fromP: string, toN: string, toP: string) =>
    edges.push({ id: `e${e++}`, from: { nodeId: fromN, portId: fromP }, to: { nodeId: toN, portId: toP } });

  if (o.shape === 'circle') nodes.push({ id: 'n1', kind: 'shape.circle', values: { radius: f(o.radius ?? 30) } });
  else if (o.shape === 'rect') nodes.push({ id: 'n1', kind: 'shape.rectangle', values: { size: v2(o.size ?? [100, 100]) } });
  else nodes.push({ id: 'n1', kind: 'shape.point', values: { offset: v2([0, 0]) } });
  nodes.push({ id: 'n2', kind: 'output.spawnPosition' });
  link('n1', 'pos', 'n2', 'pos');

  nodes.push({ id: 'n3', kind: 'gen.randomRange', values: { min: f(o.lifeMin), max: f(o.lifeMax) } });
  nodes.push({ id: 'n4', kind: 'output.initLife' });
  link('n3', 'out', 'n4', 'life');

  nodes.push({ id: 'n5', kind: 'gen.randomVec2', values: { min: v2(o.velMin), max: v2(o.velMax) } });
  nodes.push({ id: 'n6', kind: 'output.initVelocity' });
  link('n5', 'out', 'n6', 'vel');

  if (o.gravity && (o.gravity[0] !== 0 || o.gravity[1] !== 0)) {
    nodes.push({ id: 'n7', kind: 'field.gravity', values: { g: v2(o.gravity) } });
    nodes.push({ id: 'n8', kind: 'output.addForce' });
    link('n7', 'force', 'n8', 'force');
  }
  if (o.drag) {
    nodes.push({ id: 'n9', kind: 'field.drag', values: { coefficient: f(o.drag) } });
    nodes.push({ id: 'n10', kind: 'output.drag' });
    link('n9', 'drag', 'n10', 'drag');
  }
  if (o.wind) {
    nodes.push({ id: 'n11', kind: 'field.directional', values: { strength: f(o.wind[0]), angle: f(o.wind[1]) } });
    nodes.push({ id: 'n12', kind: 'output.addForce' });
    link('n11', 'force', 'n12', 'force');
  }

  nodes.push({ id: 'n13', kind: 'gen.colorOverLife', structural: { ease: o.colorEase ?? 'linear' }, values: { from: col(o.colorFrom), to: col(o.colorTo) } });
  nodes.push({ id: 'n14', kind: 'output.writeColor' });
  link('n13', 'out', 'n14', 'color');

  nodes.push({ id: 'n15', kind: 'gen.scaleOverLife', structural: { ease: o.scaleEase ?? 'linear' }, values: { from: f(o.scaleFrom ?? 1), to: f(o.scaleTo ?? 0) } });
  nodes.push({ id: 'n16', kind: 'output.writeScale' });
  link('n15', 'out', 'n16', 'scale');

  const emitter: System['emitter'] =
    o.mode === 'burst'
      ? { mode: 'burst', rate: 0, burst: { count: o.burstCount ?? 150, interval: o.burstInterval ?? 1.5 } }
      : { mode: 'flow', rate: o.rate ?? 200, rateOverDistance: o.rod ?? 0 };

  const project: PylinkaProject = {
    format: 'pylinka/v1',
    version: 1,
    catalogVersion: 1,
    id: o.slug,
    name: o.title,
    createdAt: '2026-07-10T00:00:00Z',
    updatedAt: '2026-07-10T00:00:00Z',
    params: [],
    assets: [],
    systems: [
      { id: 's1', name: 'fx', capacity: o.capacity ?? 2500, blendMode: o.blend ?? 'add', enabled: true, space: 'world', emitter, graph: { nodes, edges } },
    ],
  };

  return { slug: o.slug, title: o.title, group: o.group, oneLiner: o.oneLiner, tags: o.tags, project };
}

export const RECIPES: Recipe[] = [
  // ── trails ────────────────────────────────────────────────────────────
  fx({ slug: 'coin-spark-trail', title: 'Coin Spark Trail', group: 'trails', oneLiner: 'Amber sparks that hang and fall behind a flying coin.', tags: ['trail', 'sparks', 'gravity'], capacity: 4000, rate: 420, rod: 1.4, velMin: [-45, -150], velMax: [45, -240], lifeMin: 0.6, lifeMax: 1.3, gravity: [0, 340], colorFrom: '#ffd27aff', colorTo: '#ff3b0000', colorEase: 'power2.out', scaleFrom: 1.6, scaleEase: 'power2.out' }),
  fx({ slug: 'comet-tail', title: 'Comet Tail', group: 'trails', oneLiner: 'A cyan comet streak with drag and no gravity.', tags: ['trail', 'drag', 'additive'], capacity: 4000, rate: 520, rod: 2, velMin: [-15, -15], velMax: [15, 15], lifeMin: 0.8, lifeMax: 1.6, drag: 1.6, colorFrom: '#aee9ffff', colorTo: '#3a86ff00', colorEase: 'power2.out', scaleFrom: 1.2, scaleEase: 'power2.out' }),
  fx({ slug: 'pixie-trail', title: 'Pixie Trail', group: 'trails', oneLiner: 'Soft pink pixie dust drifting behind the cursor.', tags: ['trail', 'magic', 'soft'], capacity: 3000, rate: 340, rod: 1.2, velMin: [-20, -40], velMax: [20, -90], lifeMin: 0.5, lifeMax: 1, gravity: [0, 60], colorFrom: '#ffd0ffff', colorTo: '#c060ff00', colorEase: 'sine.out', scaleFrom: 1, scaleEase: 'power2.out' }),
  fx({ slug: 'smoke-trail', title: 'Smoke Trail', group: 'trails', oneLiner: 'Grey smoke that rises, grows, and thins out.', tags: ['trail', 'smoke', 'normal'], capacity: 2500, blend: 'normal', rate: 130, rod: 0.6, velMin: [-10, -30], velMax: [10, -60], lifeMin: 1.5, lifeMax: 2.5, gravity: [0, -20], drag: 0.8, colorFrom: '#cfcfcfaa', colorTo: '#66666600', colorEase: 'sine.out', scaleFrom: 0.6, scaleTo: 2.4, scaleEase: 'sine.out' }),

  // ── fire ──────────────────────────────────────────────────────────────
  fx({ slug: 'campfire', title: 'Campfire', group: 'fire', oneLiner: 'A warm licking flame rising from embers.', tags: ['fire', 'additive', 'rise'], capacity: 3000, shape: 'circle', radius: 18, rate: 520, velMin: [-15, -70], velMax: [15, -130], lifeMin: 0.5, lifeMax: 1.1, gravity: [0, -40], colorFrom: '#ffe08aff', colorTo: '#ff2a0000', colorEase: 'power2.out', scaleFrom: 1.4, scaleEase: 'power2.out' }),
  fx({ slug: 'torch', title: 'Torch', group: 'fire', oneLiner: 'A tight, tall torch flame.', tags: ['fire', 'tall'], capacity: 3000, rate: 600, velMin: [-8, -90], velMax: [8, -170], lifeMin: 0.4, lifeMax: 0.8, gravity: [0, -60], colorFrom: '#fff3b0ff', colorTo: '#ff5a0000', colorEase: 'power2.out', scaleFrom: 1.2, scaleEase: 'power2.out' }),
  fx({ slug: 'ember-rise', title: 'Ember Rise', group: 'fire', oneLiner: 'Slow embers floating up from a wide bed.', tags: ['fire', 'embers', 'ambient'], capacity: 2000, shape: 'rect', size: [140, 20], rate: 110, velMin: [-6, -40], velMax: [6, -95], lifeMin: 1.2, lifeMax: 2.2, gravity: [0, -25], drag: 0.5, colorFrom: '#ff7a2aff', colorTo: '#5a1a0000', colorEase: 'sine.out', scaleFrom: 0.5, scaleEase: 'sine.out' }),
  fx({ slug: 'blue-flame', title: 'Blue Flame', group: 'fire', oneLiner: 'A hot blue-white flame.', tags: ['fire', 'blue', 'hot'], capacity: 3000, shape: 'circle', radius: 12, rate: 560, velMin: [-10, -100], velMax: [10, -180], lifeMin: 0.4, lifeMax: 0.9, gravity: [0, -70], colorFrom: '#b3f0ffff', colorTo: '#2a6bff00', colorEase: 'power2.out', scaleFrom: 1.3, scaleEase: 'power2.out' }),

  // ── magic ─────────────────────────────────────────────────────────────
  fx({ slug: 'fairy-dust', title: 'Fairy Dust', group: 'magic', oneLiner: 'Twinkling gold motes drifting in every direction.', tags: ['magic', 'twinkle', 'gold'], capacity: 2600, rate: 260, velMin: [-30, -30], velMax: [30, 30], lifeMin: 1, lifeMax: 2, gravity: [0, 40], drag: 0.6, colorFrom: '#fff6a8ff', colorTo: '#ffd06600', colorEase: 'sine.inOut', scaleFrom: 1, scaleEase: 'power2.out' }),
  fx({ slug: 'arcane-burst', title: 'Arcane Burst', group: 'magic', oneLiner: 'A pulsing violet ring that bursts and settles.', tags: ['magic', 'burst', 'ring'], capacity: 2600, mode: 'burst', burstCount: 260, burstInterval: 1.3, velMin: [-170, -170], velMax: [170, 170], lifeMin: 0.6, lifeMax: 1.1, drag: 2.3, colorFrom: '#c77dffff', colorTo: '#5a2a9900', colorEase: 'power2.out', scaleFrom: 1.6, scaleEase: 'power2.out' }),
  fx({ slug: 'healing-glow', title: 'Healing Glow', group: 'magic', oneLiner: 'Gentle green light rising and dissolving.', tags: ['magic', 'green', 'screen'], capacity: 2200, blend: 'screen', shape: 'rect', size: [60, 20], rate: 190, velMin: [-12, -50], velMax: [12, -110], lifeMin: 1, lifeMax: 1.8, gravity: [0, -40], colorFrom: '#b8ffccff', colorTo: '#26e07a00', colorEase: 'sine.out', scaleFrom: 1, scaleEase: 'power2.out' }),
  fx({ slug: 'star-sparkle', title: 'Star Sparkle', group: 'magic', oneLiner: 'A field of twinkling stars.', tags: ['magic', 'stars', 'field'], capacity: 1800, shape: 'rect', size: [220, 140], rate: 130, velMin: [-6, -6], velMax: [6, 6], lifeMin: 0.6, lifeMax: 1.4, colorFrom: '#ffffffff', colorTo: '#88bbff00', colorEase: 'power2.out', scaleFrom: 1.4, scaleEase: 'power2.out' }),

  // ── ambient ───────────────────────────────────────────────────────────
  fx({ slug: 'snowfall', title: 'Snowfall', group: 'ambient', oneLiner: 'Soft snow drifting down across the scene.', tags: ['ambient', 'snow', 'normal'], capacity: 2000, blend: 'normal', shape: 'rect', size: [420, 20], rate: 120, velMin: [-8, 20], velMax: [8, 55], lifeMin: 3, lifeMax: 6, gravity: [0, 8], drag: 0.2, wind: [10, 0], colorFrom: '#ffffffee', colorTo: '#ffffff66', colorEase: 'linear', scaleFrom: 0.8, scaleTo: 0.8 }),
  fx({ slug: 'rain', title: 'Rain', group: 'ambient', oneLiner: 'Fast cool rain streaking down.', tags: ['ambient', 'rain', 'normal'], capacity: 2400, blend: 'normal', shape: 'rect', size: [420, 10], rate: 320, velMin: [-4, 320], velMax: [4, 520], lifeMin: 0.5, lifeMax: 1, gravity: [0, 500], colorFrom: '#a9c7ffcc', colorTo: '#5a86cc00', colorEase: 'linear', scaleFrom: 0.5, scaleTo: 0.5 }),
  fx({ slug: 'fireflies', title: 'Fireflies', group: 'ambient', oneLiner: 'A handful of glowing fireflies wandering.', tags: ['ambient', 'glow', 'sparse'], capacity: 600, shape: 'rect', size: [300, 180], rate: 26, velMin: [-14, -14], velMax: [14, 14], lifeMin: 1.5, lifeMax: 3, drag: 0.8, colorFrom: '#d8ff7aff', colorTo: '#3a6b0000', colorEase: 'sine.inOut', scaleFrom: 1, scaleEase: 'sine.inOut' }),

  // ── ui ────────────────────────────────────────────────────────────────
  fx({ slug: 'confetti-pop', title: 'Confetti Pop', group: 'ui', oneLiner: 'A celebratory confetti burst that rains down.', tags: ['ui', 'burst', 'celebrate'], capacity: 1200, blend: 'normal', mode: 'burst', burstCount: 180, burstInterval: 1.8, shape: 'rect', size: [30, 10], velMin: [-170, -280], velMax: [170, -120], lifeMin: 1, lifeMax: 1.8, gravity: [0, 520], colorFrom: '#ffd54aff', colorTo: '#ff8a3cff', colorEase: 'linear', scaleFrom: 1.4, scaleTo: 0.9 }),
  fx({ slug: 'success-sparkle', title: 'Success Sparkle', group: 'ui', oneLiner: 'A green success pop for buttons and toasts.', tags: ['ui', 'success', 'burst'], capacity: 1400, mode: 'burst', burstCount: 130, burstInterval: 1.5, shape: 'circle', radius: 8, velMin: [-130, -130], velMax: [130, 130], lifeMin: 0.5, lifeMax: 1, drag: 2.6, colorFrom: '#9dffb0ff', colorTo: '#26c96a00', colorEase: 'power2.out', scaleFrom: 1.5, scaleEase: 'power2.out' }),
  fx({ slug: 'gold-coins', title: 'Gold Shower', group: 'ui', oneLiner: 'Golden coins arcing up and falling — jackpot.', tags: ['ui', 'gold', 'reward'], capacity: 1600, shape: 'rect', size: [40, 10], rate: 70, velMin: [-30, -260], velMax: [30, -380], lifeMin: 1.2, lifeMax: 2, gravity: [0, 600], colorFrom: '#ffe27aff', colorTo: '#c8901e00', colorEase: 'sine.out', scaleFrom: 1.4, scaleTo: 0.9 }),

  // ── abstract ──────────────────────────────────────────────────────────
  fx({ slug: 'plasma-drift', title: 'Plasma Drift', group: 'abstract', oneLiner: 'Slow magenta plasma blobs blooming and merging.', tags: ['abstract', 'screen', 'soft'], capacity: 900, blend: 'screen', shape: 'rect', size: [200, 130], rate: 55, velMin: [-30, -30], velMax: [30, 30], lifeMin: 1.5, lifeMax: 3, drag: 1, colorFrom: '#ff5ab3ff', colorTo: '#5a2a9900', colorEase: 'sine.inOut', scaleFrom: 2, scaleTo: 3.2, scaleEase: 'sine.inOut' }),
  fx({ slug: 'ink-bloom', title: 'Ink Bloom', group: 'abstract', oneLiner: 'Ink blooming outward and settling into the dark.', tags: ['abstract', 'burst', 'ink'], capacity: 1600, blend: 'normal', mode: 'burst', burstCount: 220, burstInterval: 2, velMin: [-90, -90], velMax: [90, 90], lifeMin: 1.5, lifeMax: 2.5, drag: 3, colorFrom: '#3a56c8ff', colorTo: '#05051500', colorEase: 'sine.out', scaleFrom: 1, scaleTo: 2.4, scaleEase: 'sine.out' }),
];
