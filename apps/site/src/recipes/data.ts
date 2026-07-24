/**
 * 20 worked recipes. Each is a real PylinkaProject built from the common node
 * set the WebGL2 runtime interprets, so every one renders live in the gallery.
 */
import type { Literal, Node, PylinkaProject, System } from '@pylinka/graph';
import type { EditorProject, EmitterPathData } from '../editor/types';
import { MASK_BOLT, MASK_HEART, MASK_RING, MASK_STAR, MASK_WIN } from '../editor/maskShapes';

export type RecipeGroup = 'trails' | 'fire' | 'magic' | 'ambient' | 'ui' | 'abstract' | 'swirl' | 'drawn' | 'physics' | 'combo';

export interface RecipeAtlas {
  url: string;
  cols: number;
  rows: number;
  frameW: number;
  frameH: number;
  pad: number;
  fps: number;
  play: 'loop' | 'once';
  pick: 'per-particle' | 'per-spawn';
}

export interface Recipe {
  slug: string;
  title: string;
  group: RecipeGroup;
  oneLiner: string;
  tags: string[];
  project: PylinkaProject;
  /** optional textured atlas sequence (e.g. a spinning coin) bound to systems[0]. */
  atlas?: RecipeAtlas;
  /** multi-emitter: per-system atlas (systemId → sequence). */
  systemAtlases?: Record<string, RecipeAtlas>;
  /** sub-emitters: childSystemId → parentSystemId (child spawns on parent deaths). */
  subEmitters?: Record<string, string>;
}

/** The extracted piggy-cash coins: 7 colour rows × 10 flip frames. */
const COINS: RecipeAtlas = { url: '/atlas/coins.png', cols: 10, rows: 7, frameW: 138, frameH: 138, pad: 2, fps: 14, play: 'loop', pick: 'per-particle' };

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
  /** field.vortex around the emitter: [tangential strength, inward pull, falloff radius (0 = global)] */
  vortex?: [number, number, number];
  /** field.turbulence: [strength, noise cell px, speed] */
  turb?: [number, number, number];
  colorFrom: string;
  colorTo: string;
  colorEase?: string;
  scaleFrom?: number;
  scaleTo?: number;
  scaleEase?: string;
  atlas?: RecipeAtlas;
  /**
   * Solid geometry + moving bodies. All of these are authored in EMITTER space
   * (structural `space: 'emitter'`), so a recipe stays correct at any card size
   * — same reason velocities and radii are plain px here.
   */
  /** floor plane `y` px below the emitter */
  floor?: { y: number; bounce?: number; friction?: number };
  /** box the particles are kept inside, centred on the emitter */
  box?: { w: number; h: number; bounce?: number; friction?: number };
  /** solid crate they bounce off, offset from the emitter */
  crate?: { x: number; y: number; w: number; h: number; bounce?: number; friction?: number };
  /** solid disc they bounce off, offset from the emitter */
  disc?: { x: number; y: number; r: number; bounce?: number; friction?: number };
  /** field.obstacle: a body that shoves the field aside (see the interaction lab) */
  obstacle?: {
    x?: number;
    y?: number;
    radius: number;
    strength: number;
    softness?: number;
    swirl?: number;
    carry?: number;
    /** the body's own velocity — drives `carry`, i.e. the bow wave */
    vel?: Vec2;
  };
  /** drawn emission area: particles spawn only inside this mask (data-URL image) */
  mask?: { src: string; width: number };
  /** emitter trajectory spline (normalized 0..1 canvas points) */
  path?: EmitterPathData;
}

const f = (v: number): Literal => ({ t: 'f32', v });
const v2 = (v: Vec2): Literal => ({ t: 'vec2', v });
const col = (v: string): Literal => ({ t: 'color', v });

/** The physics/emitter subset of a recipe — everything that shapes one System. */
type SysOpts = Omit<FxOpts, 'slug' | 'title' | 'group' | 'oneLiner' | 'tags' | 'atlas'>;

/** Build one System (emitter + graph). Node/edge ids use prefix `idp` so they
 * stay globally unique when several systems share a project. */
function buildSystem(o: SysOpts, id: string, idp: string, name: string, enabled = true): System {
  const nodes: Node[] = [];
  const edges: System['graph']['edges'] = [];
  let e = 0;
  const nid = (n: number) => `${idp}${n}`;
  const link = (fromN: number, fromP: string, toN: number, toP: string) =>
    edges.push({ id: `${idp}e${e++}`, from: { nodeId: nid(fromN), portId: fromP }, to: { nodeId: nid(toN), portId: toP } });

  if (o.shape === 'circle') nodes.push({ id: nid(1), kind: 'shape.circle', values: { radius: f(o.radius ?? 30) } });
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
  if (o.obstacle) {
    const ob = o.obstacle;
    nodes.push({
      id: nid(13),
      kind: 'field.obstacle',
      structural: { space: 'emitter' },
      values: {
        center: v2([ob.x ?? 0, ob.y ?? 0]),
        velocity: v2(ob.vel ?? [0, 0]),
        radius: f(ob.radius),
        strength: f(ob.strength),
        softness: f(ob.softness ?? 0.6),
        swirl: f(ob.swirl ?? 0),
        carry: f(ob.carry ?? 0),
      },
    });
    nodes.push({ id: nid(14), kind: 'output.addForce' });
    link(13, 'force', 14, 'force');
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

  // look nodes get ids AFTER every force id (17-20) so auto-layout keeps the
  // Forces annotation group vertically contiguous
  nodes.push({ id: nid(21), kind: 'gen.colorOverLife', structural: { ease: o.colorEase ?? 'linear' }, values: { from: col(o.colorFrom), to: col(o.colorTo) } });
  nodes.push({ id: nid(22), kind: 'output.writeColor' });
  link(21, 'out', 22, 'color');

  nodes.push({ id: nid(23), kind: 'gen.scaleOverLife', structural: { ease: o.scaleEase ?? 'linear' }, values: { from: f(o.scaleFrom ?? 1), to: f(o.scaleTo ?? 0) } });
  nodes.push({ id: nid(24), kind: 'output.writeScale' });
  link(23, 'out', 24, 'scale');

  // solid geometry — pure output sinks, so they get ids after the look nodes
  let cid = 25;
  const solid = (kind: string, structural: Record<string, string>, values: Node['values']) =>
    nodes.push({ id: nid(cid++), kind, structural: { space: 'emitter', ...structural }, values });
  if (o.floor) {
    solid('output.collidePlane', {}, {
      point: v2([0, o.floor.y]), normal: v2([0, -1]),
      restitution: f(o.floor.bounce ?? 0.45), friction: f(o.floor.friction ?? 0.12),
    });
  }
  if (o.box) {
    const [hw, hh] = [o.box.w / 2, o.box.h / 2];
    solid('output.collideRect', { mode: 'inside' }, {
      min: v2([-hw, -hh]), max: v2([hw, hh]),
      restitution: f(o.box.bounce ?? 0.5), friction: f(o.box.friction ?? 0.08),
    });
  }
  if (o.crate) {
    solid('output.collideRect', { mode: 'outside' }, {
      min: v2([o.crate.x, o.crate.y]), max: v2([o.crate.x + o.crate.w, o.crate.y + o.crate.h]),
      restitution: f(o.crate.bounce ?? 0.4), friction: f(o.crate.friction ?? 0.25),
    });
  }
  if (o.disc) {
    solid('output.collideCircle', { mode: 'outside' }, {
      center: v2([o.disc.x, o.disc.y]), radius: f(o.disc.r),
      restitution: f(o.disc.bounce ?? 0.6), friction: f(o.disc.friction ?? 0.1),
      velocity: v2([0, 0]),
    });
  }

  const emitter: System['emitter'] =
    o.mode === 'burst'
      ? { mode: 'burst', rate: 0, burst: { count: o.burstCount ?? 150, interval: o.burstInterval ?? 1.5 } }
      : { mode: 'flow', rate: o.rate ?? 200, rateOverDistance: o.rod ?? 0 };

  return { id, name, capacity: o.capacity ?? 2500, blendMode: o.blend ?? 'add', enabled, space: 'world', emitter, graph: { nodes, edges } };
}

const META = { format: 'pylinka/v1' as const, version: 1, catalogVersion: 1, createdAt: '2026-07-10T00:00:00Z', updatedAt: '2026-07-10T00:00:00Z' };

function fx(o: FxOpts): Recipe {
  const project: PylinkaProject = { ...META, id: o.slug, name: o.title, params: [], assets: [], systems: [buildSystem(o, 's1', 'n', 'fx')] };
  // drawn emission areas + trajectory splines ride on the project as editor
  // extras — forkRecipe structured-clones them straight into the editor
  if (o.mask) (project as EditorProject).systemMasks = { s1: { src: o.mask.src, width: o.mask.width, offset: [0, 0] } };
  if (o.path) (project as EditorProject).systemPaths = { s1: o.path };
  return { slug: o.slug, title: o.title, group: o.group, oneLiner: o.oneLiner, tags: o.tags, project, ...(o.atlas ? { atlas: o.atlas } : {}) };
}



/** One emitter in a multi-emitter recipe. */
type Layer = SysOpts & {
  name: string;
  atlas?: RecipeAtlas;
  /** as a sub-emitter child: burst this many particles per parent death, up to
   *  `max` (also the child-pool multiplier), inheriting a fraction of the
   *  parent's death velocity. Adds an output.deathBurst node to this system. */
  burst?: { max: number; countMin: number; countMax: number; inherit: number };
};
interface ComboOpts {
  slug: string;
  title: string;
  group: RecipeGroup;
  oneLiner: string;
  tags: string[];
  layers: Layer[];
  /** sub-emitter links as [childLayerIndex, parentLayerIndex] pairs. */
  links?: [number, number][];
}

const PREFIX = 'abcdefgh';
/** Compose several emitters (optionally wired as sub-emitters) into one recipe. */
function combo(o: ComboOpts): Recipe {
  const sysId = (i: number) => `s${i + 1}`;
  const systems = o.layers.map((L, i) => buildSystem(L, sysId(i), PREFIX[i]!, L.name));
  // death-burst: turn a sub-emitter child into a real explosion (many spawns
  // per parent death) via an output.deathBurst node.
  o.layers.forEach((L, i) => {
    if (!L.burst) return;
    systems[i]!.graph.nodes.push({
      id: `${PREFIX[i]!}40`,
      kind: 'output.deathBurst',
      structural: { max: String(L.burst.max) },
      values: {
        countMin: f(L.burst.countMin),
        countMax: f(L.burst.countMax),
        inheritVelocity: f(L.burst.inherit),
      },
    });
  });
  const systemAtlases: Record<string, RecipeAtlas> = {};
  o.layers.forEach((L, i) => { if (L.atlas) systemAtlases[sysId(i)] = L.atlas; });
  const subEmitters: Record<string, string> = {};
  for (const [c, p] of o.links ?? []) subEmitters[sysId(c)] = sysId(p);
  const project: PylinkaProject = { ...META, id: o.slug, name: o.title, params: [], assets: [], systems };
  return {
    slug: o.slug, title: o.title, group: o.group, oneLiner: o.oneLiner, tags: o.tags, project,
    ...(Object.keys(systemAtlases).length ? { systemAtlases } : {}),
    ...(Object.keys(subEmitters).length ? { subEmitters } : {}),
  };
}

/** Showcase for the standalone gen.ease node: particle SIZE is driven by an Ease
 *  node wired from input.ageNormalized → a `back.out` curve that overshoots, so
 *  motes pop in. (The Ease node runs on the compiled backends; open on WebGPU/
 *  WebGL2 to see the pop — the interpreted gallery falls back to a plain fade.) */
function easePop(): Recipe {
  const nid = (n: number) => `k${n}`;
  const edge = (i: number, fn: number, fp: string, tn: number, tp: string) => ({
    id: `ke${i}`, from: { nodeId: nid(fn), portId: fp }, to: { nodeId: nid(tn), portId: tp },
  });
  const nodes: Node[] = [
    { id: nid(1), kind: 'shape.circle', values: { radius: f(70) } },
    { id: nid(2), kind: 'output.spawnPosition' },
    { id: nid(3), kind: 'gen.randomRange', values: { min: f(0.9), max: f(1.7) } },
    { id: nid(4), kind: 'output.initLife' },
    { id: nid(5), kind: 'gen.randomVec2', values: { min: v2([-12, -12]), max: v2([12, 12]) } },
    { id: nid(6), kind: 'output.initVelocity' },
    { id: nid(7), kind: 'input.ageNormalized' },
    { id: nid(8), kind: 'gen.ease', structural: { ease: 'back.out' } },
    { id: nid(9), kind: 'output.writeScale' },
    { id: nid(10), kind: 'gen.colorOverLife', structural: { ease: 'sine.out' }, values: { from: col('#d8c7ffff'), to: col('#6a2ad000') } },
    { id: nid(11), kind: 'output.writeColor' },
  ];
  const graph = {
    nodes,
    edges: [
      edge(1, 1, 'pos', 2, 'pos'),
      edge(2, 3, 'out', 4, 'life'),
      edge(3, 5, 'out', 6, 'vel'),
      edge(4, 7, 'out', 8, 't'),
      edge(5, 8, 'out', 9, 'scale'),
      edge(6, 10, 'out', 11, 'color'),
    ],
  };
  const system: System = {
    id: 's1', name: 'motes', capacity: 1400, blendMode: 'add', enabled: true, space: 'world',
    emitter: { mode: 'flow', rate: 26 }, graph,
  };
  const project: PylinkaProject = { ...META, id: 'ease-pop', name: 'Ease Pop', params: [], assets: [], systems: [system] };
  return {
    slug: 'ease-pop', title: 'Ease Pop', group: 'abstract',
    oneLiner: 'Violet motes that pop in — size driven by a standalone Ease node (back.out) wired from age.',
    tags: ['ease', 'curve', 'nodes', 'scale'], project,
  };
}

export const RECIPES: Recipe[] = [
  easePop(),
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

  // ── more trails ─────────────────────────────────────────────────────────
  fx({ slug: 'sparkler', title: 'Sparkler', group: 'trails', oneLiner: 'Crackling white-gold sparks spraying in every direction.', tags: ['trail', 'sparks', 'crackle'], capacity: 4000, rate: 700, rod: 2, velMin: [-60, -60], velMax: [60, 60], lifeMin: 0.3, lifeMax: 0.7, gravity: [0, 200], drag: 1, colorFrom: '#fffbe0ff', colorTo: '#ffcf3c00', colorEase: 'power2.out', scaleFrom: 1, scaleEase: 'power2.out' }),
  fx({ slug: 'neon-swipe', title: 'Neon Swipe', group: 'trails', oneLiner: 'A magenta-to-cyan neon streak.', tags: ['trail', 'neon', 'additive'], capacity: 3500, rate: 600, rod: 2.5, velMin: [-10, -10], velMax: [10, 10], lifeMin: 0.6, lifeMax: 1.2, drag: 2, colorFrom: '#ff4ff0ff', colorTo: '#00e5ff00', colorEase: 'power2.out', scaleFrom: 1.4, scaleEase: 'power2.out' }),
  fx({ slug: 'ghost-wisp', title: 'Ghost Wisp', group: 'trails', oneLiner: 'A pale wisp that swells and fades on screen blend.', tags: ['trail', 'ghost', 'screen'], capacity: 2500, blend: 'screen', rate: 220, rod: 1, velMin: [-14, -30], velMax: [14, -70], lifeMin: 1, lifeMax: 2, gravity: [0, -10], drag: 0.7, colorFrom: '#cfe8ffcc', colorTo: '#5a86cc00', colorEase: 'sine.out', scaleFrom: 1, scaleTo: 1.6, scaleEase: 'sine.out' }),

  // ── more fire ─────────────────────────────────────────────────────────
  fx({ slug: 'inferno', title: 'Inferno', group: 'fire', oneLiner: 'A roaring wide blaze.', tags: ['fire', 'big', 'roar'], capacity: 4000, shape: 'circle', radius: 26, rate: 800, velMin: [-25, -120], velMax: [25, -220], lifeMin: 0.6, lifeMax: 1.2, gravity: [0, -50], colorFrom: '#ffd66aff', colorTo: '#c81e0000', colorEase: 'power2.out', scaleFrom: 1.8, scaleEase: 'power2.out' }),
  fx({ slug: 'candle', title: 'Candle', group: 'fire', oneLiner: 'A small, calm candle flame.', tags: ['fire', 'small', 'calm'], capacity: 1500, rate: 200, velMin: [-3, -40], velMax: [3, -70], lifeMin: 0.5, lifeMax: 0.9, gravity: [0, -40], colorFrom: '#fff0c0ff', colorTo: '#ff8a2a00', colorEase: 'power2.out', scaleFrom: 0.8, scaleEase: 'power2.out' }),
  fx({ slug: 'will-o-wisp', title: "Will-o'-Wisp", group: 'fire', oneLiner: 'An eerie green marsh flame.', tags: ['fire', 'green', 'eerie'], capacity: 2500, shape: 'circle', radius: 10, rate: 400, velMin: [-8, -60], velMax: [8, -120], lifeMin: 0.5, lifeMax: 1, gravity: [0, -60], colorFrom: '#c8ffcaff', colorTo: '#1e9e5a00', colorEase: 'power2.out', scaleFrom: 1.2, scaleEase: 'power2.out' }),

  // ── more magic ────────────────────────────────────────────────────────
  fx({ slug: 'spell-cast', title: 'Spell Cast', group: 'magic', oneLiner: 'A violet spell detonating and settling.', tags: ['magic', 'burst', 'violet'], capacity: 2600, mode: 'burst', burstCount: 300, burstInterval: 1.2, velMin: [-180, -180], velMax: [180, 180], lifeMin: 0.6, lifeMax: 1.1, drag: 2.4, colorFrom: '#b98cffff', colorTo: '#4a1e8c00', colorEase: 'power2.out', scaleFrom: 1.6, scaleEase: 'power2.out' }),
  fx({ slug: 'frost-shimmer', title: 'Frost Shimmer', group: 'magic', oneLiner: 'Icy blue sparkles hanging in the air.', tags: ['magic', 'ice', 'shimmer'], capacity: 1800, shape: 'rect', size: [180, 120], rate: 150, velMin: [-8, -8], velMax: [8, 8], lifeMin: 0.8, lifeMax: 1.6, colorFrom: '#d8f4ffff', colorTo: '#7ac8ff00', colorEase: 'sine.inOut', scaleFrom: 1.3, scaleEase: 'power2.out' }),
  fx({ slug: 'stardust-fall', title: 'Stardust Fall', group: 'magic', oneLiner: 'Slow stardust settling from above.', tags: ['magic', 'fall', 'stars'], capacity: 1600, shape: 'rect', size: [300, 10], rate: 90, velMin: [-6, 20], velMax: [6, 60], lifeMin: 2, lifeMax: 4, gravity: [0, 30], colorFrom: '#fff2b0ff', colorTo: '#c86bff00', colorEase: 'linear', scaleFrom: 1, scaleEase: 'power2.out' }),
  fx({ slug: 'enchant-ring', title: 'Enchant Ring', group: 'magic', oneLiner: 'A golden ring pulsing outward.', tags: ['magic', 'ring', 'gold'], capacity: 2000, mode: 'burst', burstCount: 200, burstInterval: 1.6, shape: 'circle', radius: 40, velMin: [-30, -30], velMax: [30, 30], lifeMin: 0.8, lifeMax: 1.4, drag: 1.4, colorFrom: '#ffe27aff', colorTo: '#c8901e00', colorEase: 'power2.out', scaleFrom: 1.4, scaleEase: 'power2.out' }),

  // ── more ambient ──────────────────────────────────────────────────────
  fx({ slug: 'ash-fall', title: 'Ash Fall', group: 'ambient', oneLiner: 'Grey ash drifting down on the wind.', tags: ['ambient', 'ash', 'normal'], capacity: 2000, blend: 'normal', shape: 'rect', size: [420, 20], rate: 100, velMin: [-6, 20], velMax: [6, 50], lifeMin: 3, lifeMax: 5, gravity: [0, 12], wind: [18, 0], colorFrom: '#9a9a9aaa', colorTo: '#55555500', colorEase: 'linear', scaleFrom: 0.7, scaleTo: 0.7 }),
  fx({ slug: 'pollen-drift', title: 'Pollen Drift', group: 'ambient', oneLiner: 'Yellow-green pollen floating lazily.', tags: ['ambient', 'pollen', 'soft'], capacity: 800, shape: 'rect', size: [320, 200], rate: 45, velMin: [-8, -8], velMax: [8, 8], lifeMin: 3, lifeMax: 6, drag: 0.4, colorFrom: '#eaff8acc', colorTo: '#c8d05a00', colorEase: 'sine.inOut', scaleFrom: 0.6, scaleEase: 'power2.out' }),
  fx({ slug: 'bubbles', title: 'Bubbles', group: 'ambient', oneLiner: 'Bubbles rising and shimmering.', tags: ['ambient', 'bubbles', 'screen'], capacity: 900, blend: 'screen', shape: 'rect', size: [360, 20], rate: 60, velMin: [-10, -40], velMax: [10, -90], lifeMin: 2.5, lifeMax: 4, gravity: [0, -30], drag: 0.5, colorFrom: '#bfe8ffff', colorTo: '#7ad0ff33', colorEase: 'sine.out', scaleFrom: 1, scaleTo: 1.3, scaleEase: 'sine.out' }),
  fx({ slug: 'embers-drift', title: 'Embers Drift', group: 'ambient', oneLiner: 'Warm embers floating up across a wide bed.', tags: ['ambient', 'embers', 'additive'], capacity: 1400, shape: 'rect', size: [400, 20], rate: 70, velMin: [-6, -30], velMax: [6, -70], lifeMin: 1.5, lifeMax: 3, gravity: [0, -20], colorFrom: '#ff8a3aff', colorTo: '#5a1a0000', colorEase: 'sine.out', scaleFrom: 0.5, scaleEase: 'power2.out' }),

  // ── more ui ───────────────────────────────────────────────────────────
  fx({ slug: 'xp-orbs', title: 'XP Orbs', group: 'ui', oneLiner: 'Green XP orbs arcing up on reward.', tags: ['ui', 'xp', 'reward'], capacity: 1400, shape: 'rect', size: [40, 10], rate: 50, velMin: [-40, -160], velMax: [40, -280], lifeMin: 1, lifeMax: 1.8, gravity: [0, 300], colorFrom: '#9dff6aff', colorTo: '#2ec86a00', colorEase: 'sine.out', scaleFrom: 1.4, scaleTo: 0.8 }),
  fx({ slug: 'notification-ping', title: 'Notification Ping', group: 'ui', oneLiner: 'A crisp blue ping for alerts.', tags: ['ui', 'ping', 'burst'], capacity: 900, mode: 'burst', burstCount: 90, burstInterval: 1.4, shape: 'circle', radius: 6, velMin: [-150, -150], velMax: [150, 150], lifeMin: 0.4, lifeMax: 0.8, drag: 3, colorFrom: '#8ad0ffff', colorTo: '#2a6bff00', colorEase: 'power2.out', scaleFrom: 1.6, scaleEase: 'power2.out' }),
  fx({ slug: 'heart-pop', title: 'Heart Pop', group: 'ui', oneLiner: 'Pink hearts popping up on a like.', tags: ['ui', 'love', 'burst'], capacity: 1000, blend: 'normal', mode: 'burst', burstCount: 100, burstInterval: 1.8, shape: 'rect', size: [24, 10], velMin: [-100, -220], velMax: [100, -100], lifeMin: 1, lifeMax: 1.6, gravity: [0, 420], colorFrom: '#ff8ab0ff', colorTo: '#ff3b6bff', colorEase: 'linear', scaleFrom: 1.4, scaleTo: 0.8 }),

  // ── more abstract ─────────────────────────────────────────────────────
  fx({ slug: 'nebula', title: 'Nebula', group: 'abstract', oneLiner: 'Slow indigo nebula clouds blooming.', tags: ['abstract', 'nebula', 'screen'], capacity: 800, blend: 'screen', shape: 'rect', size: [220, 140], rate: 40, velMin: [-20, -20], velMax: [20, 20], lifeMin: 2, lifeMax: 4, drag: 1.2, colorFrom: '#6a5aff88', colorTo: '#2a0a5500', colorEase: 'sine.inOut', scaleFrom: 2.4, scaleTo: 3.6, scaleEase: 'sine.inOut' }),
  fx({ slug: 'data-stream', title: 'Data Stream', group: 'abstract', oneLiner: 'Green data raining down the screen.', tags: ['abstract', 'matrix', 'additive'], capacity: 2400, shape: 'rect', size: [400, 10], rate: 260, velMin: [-2, 200], velMax: [2, 340], lifeMin: 0.8, lifeMax: 1.4, gravity: [0, 200], colorFrom: '#6affa0ff', colorTo: '#0a3a1e00', colorEase: 'linear', scaleFrom: 0.5, scaleTo: 0.5 }),
  fx({ slug: 'energy-burst', title: 'Energy Burst', group: 'abstract', oneLiner: 'A cyan energy detonation.', tags: ['abstract', 'burst', 'energy'], capacity: 2600, mode: 'burst', burstCount: 260, burstInterval: 1.3, velMin: [-200, -200], velMax: [200, 200], lifeMin: 0.5, lifeMax: 1, drag: 2.8, colorFrom: '#6afaffff', colorTo: '#0a4a8c00', colorEase: 'power2.out', scaleFrom: 1.6, scaleEase: 'power2.out' }),

  // ── textured coin sequences (random tinted coin, spinning) ──────────────
  fx({ slug: 'coin-shower', title: 'Coin Shower', group: 'ui', oneLiner: 'Spinning coins in random colours raining down.', tags: ['ui', 'coins', 'reward'], capacity: 400, blend: 'normal', shape: 'rect', size: [60, 10], rate: 42, velMin: [-30, 60], velMax: [30, 180], lifeMin: 2, lifeMax: 3.5, gravity: [0, 240], colorFrom: '#ffffffff', colorTo: '#ffffff00', colorEase: 'sine.in', scaleFrom: 3.5, scaleTo: 3.5, atlas: COINS }),
  fx({ slug: 'coin-fountain', title: 'Coin Fountain', group: 'ui', oneLiner: 'Coins erupting upward and arcing back down.', tags: ['ui', 'coins', 'fountain'], capacity: 500, blend: 'normal', rate: 60, velMin: [-120, -300], velMax: [120, -150], lifeMin: 1.6, lifeMax: 2.6, gravity: [0, 460], colorFrom: '#ffffffff', colorTo: '#ffffff00', colorEase: 'sine.in', scaleFrom: 3.4, scaleTo: 3.4, atlas: COINS }),
  fx({ slug: 'jackpot-burst', title: 'Jackpot Burst', group: 'ui', oneLiner: 'A big coin explosion for a jackpot win.', tags: ['ui', 'coins', 'jackpot'], capacity: 800, blend: 'normal', mode: 'burst', burstCount: 130, burstInterval: 1.8, velMin: [-240, -240], velMax: [240, 240], lifeMin: 1.4, lifeMax: 2.4, gravity: [0, 380], drag: 0.5, colorFrom: '#ffffffff', colorTo: '#ffffff00', colorEase: 'sine.in', scaleFrom: 3.2, scaleTo: 3.2, atlas: COINS }),
  fx({ slug: 'gem-spin', title: 'Gem Spin', group: 'magic', oneLiner: 'A slow field of random gems tumbling in place.', tags: ['magic', 'gems', 'spin'], capacity: 220, blend: 'normal', shape: 'rect', size: [220, 130], rate: 14, velMin: [-8, -8], velMax: [8, 8], lifeMin: 2.5, lifeMax: 4.5, colorFrom: '#ffffffff', colorTo: '#ffffff33', colorEase: 'sine.inOut', scaleFrom: 3.6, scaleTo: 3.6, atlas: COINS }),

  // ── combo: multi-emitter & sub-emitter (spawn on death) ─────────────────
  combo({
    slug: 'firework', title: 'Firework', group: 'combo',
    oneLiner: 'Rockets climb, then burst into coloured sparks where they die.',
    tags: ['combo', 'sub-emitter', 'burst'],
    layers: [
      { name: 'rocket', capacity: 520, blend: 'add', rate: 16, velMin: [-60, -640], velMax: [60, -520], lifeMin: 0.7, lifeMax: 1, gravity: [0, 320], colorFrom: '#fff6c8ff', colorTo: '#ffdd8800', colorEase: 'sine.out', scaleFrom: 1, scaleTo: 0.6 },
      { name: 'burst', capacity: 520, blend: 'add', shape: 'circle', radius: 4, velMin: [-300, -300], velMax: [300, 300], lifeMin: 0.7, lifeMax: 1.2, gravity: [0, 260], drag: 1.1, colorFrom: '#fff0a0ff', colorTo: '#ff3ca000', colorEase: 'power2.out', scaleFrom: 1.4, scaleTo: 0 },
    ],
    links: [[1, 0]],
  }),
  combo({
    slug: 'exploding-ships', title: 'Exploding Ships', group: 'combo',
    oneLiner: 'Rockets climb and burst into a shower of shrapnel where each one dies.',
    tags: ['combo', 'sub-emitter', 'explosion', 'burst', 'death-burst'],
    layers: [
      { name: 'ships', capacity: 128, blend: 'add', shape: 'rect', size: [260, 12], rate: 55, velMin: [-70, -280], velMax: [70, -430], lifeMin: 0.75, lifeMax: 1.1, gravity: [0, 380], colorFrom: '#fff2c0ff', colorTo: '#ff9a3cff', colorEase: 'linear', scaleFrom: 1.3, scaleTo: 1 },
      { name: 'shrapnel', blend: 'add', velMin: [-280, -280], velMax: [280, 280], lifeMin: 0.5, lifeMax: 1.15, gravity: [0, 560], drag: 1.3, colorFrom: '#ffe08aff', colorTo: '#ff3b0000', colorEase: 'power2.out', scaleFrom: 1.6, scaleTo: 0, burst: { max: 20, countMin: 10, countMax: 18, inherit: 0.3 } },
    ],
    links: [[1, 0]],
  }),
  combo({
    slug: 'coin-pop', title: 'Coin Pop', group: 'combo',
    oneLiner: 'Coins fly up and pop into a gold spark where each one lands.',
    tags: ['combo', 'coins', 'sub-emitter'],
    layers: [
      { name: 'coins', capacity: 400, blend: 'normal', rate: 26, velMin: [-150, -380], velMax: [150, -220], lifeMin: 1, lifeMax: 1.5, gravity: [0, 480], colorFrom: '#ffffffff', colorTo: '#ffffff00', colorEase: 'sine.in', scaleFrom: 3, scaleTo: 3, atlas: COINS },
      { name: 'sparkle', capacity: 400, blend: 'add', velMin: [-90, -150], velMax: [90, -20], lifeMin: 0.35, lifeMax: 0.7, gravity: [0, 300], colorFrom: '#fff2b0ff', colorTo: '#ffcf3c00', colorEase: 'power2.out', scaleFrom: 1.2, scaleTo: 0 },
    ],
    links: [[1, 0]],
  }),
  combo({
    slug: 'ember-smoke', title: 'Ember Smoke', group: 'combo',
    oneLiner: 'Embers rise and each leaves a puff of smoke when it burns out.',
    tags: ['combo', 'smoke', 'sub-emitter'],
    layers: [
      { name: 'embers', capacity: 1200, blend: 'add', shape: 'rect', size: [120, 16], rate: 55, velMin: [-10, -70], velMax: [10, -130], lifeMin: 0.9, lifeMax: 1.6, gravity: [0, -30], drag: 0.4, colorFrom: '#ff9a3aff', colorTo: '#7a1a0000', colorEase: 'sine.out', scaleFrom: 0.7, scaleTo: 0.2 },
      { name: 'smoke', capacity: 1200, blend: 'normal', velMin: [-14, -24], velMax: [14, -54], lifeMin: 1.2, lifeMax: 2.2, gravity: [0, -16], drag: 0.8, colorFrom: '#8a8a8a88', colorTo: '#33333300', colorEase: 'sine.out', scaleFrom: 0.5, scaleTo: 2.2, scaleEase: 'sine.out' },
    ],
    links: [[1, 0]],
  }),
  combo({
    slug: 'twin-flame', title: 'Twin Flame', group: 'combo',
    oneLiner: 'Two emitters layered — an orange blaze around a blue-white core.',
    tags: ['combo', 'fire', 'multi-emitter'],
    layers: [
      { name: 'outer', capacity: 2600, blend: 'add', shape: 'circle', radius: 18, rate: 480, velMin: [-16, -80], velMax: [16, -150], lifeMin: 0.5, lifeMax: 1, gravity: [0, -45], colorFrom: '#ffd27aff', colorTo: '#ff2a0000', colorEase: 'power2.out', scaleFrom: 1.5, scaleTo: 0 },
      { name: 'core', capacity: 2600, blend: 'add', shape: 'circle', radius: 8, rate: 420, velMin: [-8, -110], velMax: [8, -200], lifeMin: 0.4, lifeMax: 0.8, gravity: [0, -70], colorFrom: '#d8f0ffff', colorTo: '#3a7cff00', colorEase: 'power2.out', scaleFrom: 1, scaleTo: 0 },
    ],
  }),
  combo({
    slug: 'comet-and-smoke', title: 'Comet & Smoke', group: 'combo',
    oneLiner: 'A cyan comet core with a faint smoke trail — two emitters, one path.',
    tags: ['combo', 'trail', 'multi-emitter'],
    layers: [
      { name: 'core', capacity: 3500, blend: 'add', rate: 520, rod: 2, velMin: [-15, -15], velMax: [15, 15], lifeMin: 0.8, lifeMax: 1.5, drag: 1.6, colorFrom: '#aee9ffff', colorTo: '#3a86ff00', colorEase: 'power2.out', scaleFrom: 1.3, scaleTo: 0 },
      { name: 'smoke', capacity: 2500, blend: 'normal', rate: 120, rod: 0.8, velMin: [-8, -10], velMax: [8, -30], lifeMin: 1, lifeMax: 1.8, drag: 0.6, colorFrom: '#88aaccaa', colorTo: '#33445500', colorEase: 'sine.out', scaleFrom: 0.8, scaleTo: 2.2, scaleEase: 'sine.out' },
    ],
  }),

  // ── swirl — vortex / helix / turbulence ──────────────────────────────
  fx({ slug: 'whirlpool', title: 'Whirlpool', group: 'swirl',
    oneLiner: 'Water sucked around and down a spinning drain.',
    tags: ['vortex', 'water', 'swirl'],
    capacity: 5000, rate: 700, shape: 'circle', radius: 190, velMin: [-20, -20], velMax: [20, 20],
    lifeMin: 1.6, lifeMax: 2.8, drag: 0.5, vortex: [900, 260, 380],
    colorFrom: '#7dd3fcff', colorTo: '#1e3a8a00', colorEase: 'sine.out', scaleFrom: 1.1, scaleTo: 0.2 }),
  fx({ slug: 'black-hole', title: 'Black Hole', group: 'swirl',
    oneLiner: 'Everything spirals into the singularity and blinks out.',
    tags: ['vortex', 'pull', 'space'],
    capacity: 5000, rate: 600, shape: 'circle', radius: 240, velMin: [-10, -10], velMax: [10, 10],
    lifeMin: 1.4, lifeMax: 2.4, vortex: [420, 620, 0],
    colorFrom: '#c4b5fdff', colorTo: '#ffffff00', colorEase: 'power2.in', scaleFrom: 0.9, scaleTo: 0.15 }),
  fx({ slug: 'galaxy', title: 'Galaxy', group: 'swirl',
    oneLiner: 'A slow spiral of stars with a hint of turbulence.',
    tags: ['vortex', 'stars', 'ambient'],
    capacity: 6000, rate: 450, shape: 'circle', radius: 260, velMin: [-6, -6], velMax: [6, 6],
    lifeMin: 3, lifeMax: 5, vortex: [230, 40, 0], turb: [60, 220, 0.4],
    colorFrom: '#e0f2feff', colorTo: '#818cf800', colorEase: 'sine.out', scaleFrom: 0.55, scaleTo: 0.1 }),
  fx({ slug: 'cyclone', title: 'Cyclone', group: 'swirl',
    oneLiner: 'A tight funnel — swirl, suction and updraft.',
    tags: ['vortex', 'wind', 'helix'],
    capacity: 4500, rate: 620, shape: 'rect', size: [70, 240], velMin: [-25, -30], velMax: [25, 30],
    lifeMin: 1, lifeMax: 2, vortex: [1200, 220, 260], wind: [150, -1.5708],
    colorFrom: '#e2e8f0ff', colorTo: '#64748b00', colorEase: 'sine.out', scaleFrom: 0.9, scaleTo: 1.8, scaleEase: 'sine.out' }),
  fx({ slug: 'helix-climb', title: 'Helix Climb', group: 'swirl',
    oneLiner: 'Particles corkscrew upward around the emitter — a rising helix.',
    tags: ['helix', 'vortex', 'updraft'],
    capacity: 4000, rate: 520, velMin: [-140, -20], velMax: [140, 20],
    lifeMin: 1.4, lifeMax: 2.2, gravity: [0, -230], vortex: [820, 340, 0], drag: 0.25,
    colorFrom: '#99f6e4ff', colorTo: '#0d948800', colorEase: 'sine.out', scaleFrom: 1, scaleTo: 0.2 }),
  fx({ slug: 'ember-vortex', title: 'Ember Vortex', group: 'swirl',
    oneLiner: 'A fire devil — embers caught in a burning swirl.',
    tags: ['vortex', 'fire', 'embers'],
    capacity: 4500, rate: 560, shape: 'circle', radius: 90, velMin: [-40, -120], velMax: [40, -30],
    lifeMin: 0.9, lifeMax: 1.8, vortex: [950, 180, 300], turb: [140, 90, 1.2],
    colorFrom: '#ffd27aff', colorTo: '#ef444400', colorEase: 'power2.out', scaleFrom: 1.3, scaleTo: 0 }),
  fx({ slug: 'turbulent-motes', title: 'Turbulent Motes', group: 'swirl',
    oneLiner: 'Dust motes wandering on curling air — pure turbulence.',
    tags: ['turbulence', 'dust', 'ambient'],
    capacity: 3000, rate: 260, shape: 'circle', radius: 250, velMin: [-8, -8], velMax: [8, 8],
    lifeMin: 2.5, lifeMax: 4.5, drag: 0.7, turb: [420, 110, 0.6],
    colorFrom: '#f8fafccc', colorTo: '#94a3b800', colorEase: 'sine.inOut', scaleFrom: 0.5, scaleTo: 0.9, scaleEase: 'sine.inOut' }),

  // ── drawn — painted / image emission areas ───────────────────────────
  fx({ slug: 'heart-glow', title: 'Heart Glow', group: 'drawn',
    oneLiner: 'A heart drawn in softly rising rose sparkles.',
    tags: ['drawn', 'mask', 'love'],
    capacity: 4000, rate: 700, velMin: [-8, -30], velMax: [8, -8],
    lifeMin: 0.8, lifeMax: 1.6, mask: { src: MASK_HEART, width: 330 },
    colorFrom: '#fda4afff', colorTo: '#e11d4800', colorEase: 'sine.out', scaleFrom: 0.8, scaleTo: 0.1 }),
  fx({ slug: 'star-stamp', title: 'Star Stamp', group: 'drawn',
    oneLiner: 'A five-point star stamped in golden glitter.',
    tags: ['drawn', 'mask', 'gold'],
    capacity: 4000, rate: 750, velMin: [-12, -12], velMax: [12, 12],
    lifeMin: 0.6, lifeMax: 1.4, mask: { src: MASK_STAR, width: 340 },
    colorFrom: '#fde68aff', colorTo: '#f59e0b00', colorEase: 'power2.out', scaleFrom: 0.9, scaleTo: 0.1 }),
  fx({ slug: 'bolt-strike', title: 'Bolt Strike', group: 'drawn',
    oneLiner: 'A lightning bolt crackling with electric sparks.',
    tags: ['drawn', 'mask', 'electric'],
    capacity: 4500, rate: 900, velMin: [-25, -25], velMax: [25, 25],
    lifeMin: 0.25, lifeMax: 0.7, mask: { src: MASK_BOLT, width: 300 },
    colorFrom: '#e0f2feff', colorTo: '#22d3ee00', colorEase: 'power2.out', scaleFrom: 1, scaleTo: 0.15 }),
  fx({ slug: 'win-sign', title: 'WIN Sign', group: 'drawn',
    oneLiner: 'The word WIN burning in casino-gold sparks.',
    tags: ['drawn', 'mask', 'slot', 'text'],
    capacity: 5000, rate: 950, velMin: [-10, -35], velMax: [10, -6],
    lifeMin: 0.6, lifeMax: 1.2, mask: { src: MASK_WIN, width: 430 },
    colorFrom: '#fef08aff', colorTo: '#f9731600', colorEase: 'power2.out', scaleFrom: 0.9, scaleTo: 0.1 }),
  fx({ slug: 'halo-ring', title: 'Halo Ring', group: 'drawn',
    oneLiner: 'A drawn ring shimmering like a halo.',
    tags: ['drawn', 'mask', 'ring'],
    capacity: 3500, rate: 620, velMin: [-10, -18], velMax: [10, -4],
    lifeMin: 0.9, lifeMax: 1.8, mask: { src: MASK_RING, width: 320 },
    colorFrom: '#fef9c3ff', colorTo: '#eab30800', colorEase: 'sine.out', scaleFrom: 0.7, scaleTo: 0.1 }),

  // ── path-driven trails ───────────────────────────────────────────────
  fx({ slug: 'infinity-loop', title: 'Infinity Loop', group: 'trails',
    oneLiner: 'A comet rides a figure-eight spline forever.',
    tags: ['path', 'spline', 'trail'],
    capacity: 4500, rate: 520, rod: 1.6, velMin: [-15, -15], velMax: [15, 15],
    lifeMin: 0.7, lifeMax: 1.4, drag: 1.2,
    path: { points: [[0.2, 0.5], [0.35, 0.3], [0.5, 0.5], [0.65, 0.7], [0.82, 0.5], [0.65, 0.3], [0.5, 0.5], [0.35, 0.7]], duration: 6, mode: 'loop', closed: true },
    colorFrom: '#a5f3fcff', colorTo: '#6366f100', colorEase: 'power2.out', scaleFrom: 1.2, scaleTo: 0 }),
  fx({ slug: 'pendulum-sparks', title: 'Pendulum Sparks', group: 'trails',
    oneLiner: 'Sparks swing along an arc — a spline played ping-pong.',
    tags: ['path', 'spline', 'sparks'],
    capacity: 4000, rate: 480, rod: 1.2, velMin: [-20, -60], velMax: [20, 10],
    lifeMin: 0.6, lifeMax: 1.2, gravity: [0, 320],
    path: { points: [[0.16, 0.3], [0.5, 0.72], [0.84, 0.3]], duration: 2.6, mode: 'pingpong', closed: false },
    colorFrom: '#fcd34dff', colorTo: '#dc262600', colorEase: 'power2.out', scaleFrom: 1.1, scaleTo: 0 }),

  // ── physics — solid geometry + bodies moving through the field ────────
  fx({ slug: 'fountain-basin', title: 'Fountain Basin', group: 'physics',
    oneLiner: 'Sparks arc up and bounce off the basin floor below.',
    tags: ['collision', 'floor', 'gravity'],
    capacity: 4000, rate: 460, shape: 'point', velMin: [-165, -430], velMax: [165, -570],
    lifeMin: 2.6, lifeMax: 3.6, gravity: [0, 900], drag: 0.04,
    floor: { y: 170, bounce: 0.46, friction: 0.16 },
    colorFrom: '#bfefffff', colorTo: '#2f7fff00', colorEase: 'power2.out', scaleFrom: 1.1, scaleTo: 0.5 }),

  fx({ slug: 'snow-globe', title: 'Snow Globe', group: 'physics',
    oneLiner: 'Motes drift inside a sealed box, tapping off the walls.',
    tags: ['collision', 'box', 'ambient'],
    capacity: 6000, rate: 700, shape: 'rect', size: [520, 380],
    velMin: [-38, -30], velMax: [38, 40], lifeMin: 3.4, lifeMax: 5.2,
    gravity: [0, 46], drag: 0.28, turb: [70, 150, 0.5],
    box: { w: 560, h: 420, bounce: 0.7, friction: 0.04 },
    colorFrom: '#e8f4ffcc', colorTo: '#9ec9ff00', colorEase: 'sine.inOut', scaleFrom: 0.85, scaleTo: 0.5 }),

  fx({ slug: 'hail-on-crate', title: 'Hail on Crate', group: 'physics',
    oneLiner: 'Hail splits around a solid crate and settles on the floor.',
    tags: ['collision', 'crate', 'rain'],
    capacity: 5000, rate: 620, shape: 'rect', size: [640, 430],
    velMin: [-25, 40], velMax: [25, 150], lifeMin: 1.9, lifeMax: 2.8, gravity: [0, 1000],
    crate: { x: -110, y: 40, w: 220, h: 150, bounce: 0.45, friction: 0.3 },
    floor: { y: 210, bounce: 0.32, friction: 0.3 },
    colorFrom: '#dff1ffff', colorTo: '#7fb4e800', scaleFrom: 0.8, scaleTo: 0.55 }),

  fx({ slug: 'spark-anvil', title: 'Spark Anvil', group: 'physics',
    oneLiner: 'A burst rains onto a steel ball and sprays off it.',
    tags: ['collision', 'circle', 'burst'],
    capacity: 4000, rate: 900, shape: 'rect', size: [300, 8],
    velMin: [-45, 40], velMax: [45, 130], lifeMin: 1.1, lifeMax: 1.7, gravity: [0, 1200],
    disc: { x: 0, y: 130, r: 105, bounce: 0.52, friction: 0.08 },
    floor: { y: 235, bounce: 0.3, friction: 0.34 },
    colorFrom: '#fff0c2ff', colorTo: '#ff5a1f00', colorEase: 'power2.out', scaleFrom: 1, scaleTo: 0.4 }),

  fx({ slug: 'stream-past-stone', title: 'Stream Past Stone', group: 'physics',
    oneLiner: 'A drifting stream parts around an invisible body and curls behind it.',
    tags: ['obstacle', 'wake', 'flow'],
    capacity: 9000, rate: 2600, shape: 'rect', size: [960, 520],
    velMin: [235, -12], velMax: [315, 12], lifeMin: 1.6, lifeMax: 2.4, drag: 0.1,
    obstacle: { x: -40, y: 0, radius: 200, strength: 2600, softness: 0.55, swirl: 2400, carry: 0.35 },
    colorFrom: '#a8e8ffcc', colorTo: '#2b6cff00', colorEase: 'sine.out', scaleFrom: 0.8, scaleTo: 0.45 }),

  fx({ slug: 'magnet-void', title: 'Magnet Void', group: 'physics',
    oneLiner: 'Dust orbits a hole it can never fall into.',
    tags: ['obstacle', 'swirl', 'void'],
    capacity: 9000, rate: 1500, shape: 'rect', size: [620, 500],
    velMin: [-16, -16], velMax: [16, 16], lifeMin: 3.2, lifeMax: 4.6, drag: 0.22,
    obstacle: { radius: 215, strength: 600, softness: 0.9, swirl: 3600, carry: 0 },
    colorFrom: '#ffd8f4cc', colorTo: '#7a3cff00', colorEase: 'sine.inOut', scaleFrom: 0.75, scaleTo: 0.4 }),
];
