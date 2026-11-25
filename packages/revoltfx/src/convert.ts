/**
 * RevoltFX bundle → PylinkaProject.
 *
 * One RevoltFX effect (an emitter or a sequence, by name) becomes one project.
 * Every emitter the effect can reach becomes a System: its own emitter, the
 * `childs` started with it, the emitters a sequence starts, and the emitters
 * spawned on particle birth/death (as linked sub-emitters). MAPPING.md is the
 * specification; each branch below cites the row it implements.
 *
 * What a project cannot hold (when an emitter starts, how long it runs, the
 * exact RevoltFX spawn clock, triggers, auto-rotation) goes into `timeline`,
 * which the pixi player (`@pylinka/revoltfx/pixi`) runs.
 */
import { CATALOG_VERSION } from '@pylinka/graph';
import type { EmitterSettings, ParamDef, PylinkaProject, System } from '@pylinka/graph';
import { fadeWindow, heldRamp, mapEase, type FittedEase } from './ease.js';
import { BASE_PX, FALLBACK_SIZE, componentSize, movieClipFrames, spriteBox, type SpriteBox } from './frames.js';
import { GraphBuilder, type F, type V } from './graph.js';
import { Report, type FidelityIssue } from './report.js';
import { sanitizeBundle } from './sanitize.js';
import {
  REVOLTFX_BUNDLE_HASH,
  REVOLTFX_SETTINGS_VERSION,
  type RfxBundle,
  type RfxEmitter,
  type RfxSequence,
  type RfxSequenceEffect,
  type RfxSpawnDef,
  type SheetData,
} from './types.js';

const TAU = Math.PI * 2;
/** RevoltFX steps per frame; per-frame settings are read at this rate. */
const FPS = 60;
const BLEND = ['normal', 'add', 'multiply', 'screen'] as const;
/** `output.deathBurst` `max` options. */
const BURST_MAX_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];
const BURST_CAP = 128;

export interface ConvertOptions {
  /**
   * The spritesheet JSON (TexturePacker hash, as RevoltFX loads it). Supplies
   * texture sizes, anchors and movie-clip frame lists. Without it every texture
   * is assumed to be 64×64 and movie clips cannot be resolved.
   */
  sheet?: SheetData;
  /**
   * Who runs the emitter clock.
   * - `'project'` (default): the project's own `emitter` settings approximate
   *   RevoltFX timing, so it plays in the editor or through plain createPylinka.
   * - `'runtime'`: top-level emitters never fire on their own (`rate: 0`); the
   *   pixi player drives them with RevoltFX's exact spawn clock.
   */
  drive?: 'project' | 'runtime';
  /** `FX.particleFac`: multiplies every spawn count (default 1). */
  particleFac?: number;
  /** How deep sub-emitter spawns may nest (default 4). Deeper levels are reported. */
  maxDepth?: number;
  /** Timestamp for `createdAt`/`updatedAt` (default: now). Pass one for reproducible output. */
  now?: string;
  /**
   * Which namespace `name` is looked up in. RevoltFX keeps emitters and
   * sequences apart (`getParticleEmitter` / `getEffectSequence`), and a bundle
   * can use one name for both. Default: the emitter if there is one.
   */
  kind?: 'emitter' | 'sequence';
}

/** How the player textures a system. */
export interface SystemTexture {
  kind: 'sprite' | 'movieclip';
  /** sheet frame names: one for a sprite, the clip frames in order for a movie clip */
  frames: string[];
  anchorX: number;
  anchorY: number;
  /** square canvas geometry (see frames.ts); the graph's scale assumes this side */
  box: SpriteBox;
  /** movie clip playback */
  fps?: number;
  play?: 'loop' | 'hold';
}

/** RevoltFX's spawn clock for one emitter instance (`ParticleEmitter.update`). */
export interface SpawnClock {
  /** seconds between spawns, `Rnd.float(min, max)` */
  frequencyMin: number;
  frequencyMax: number;
  /** per spawn, `Rnd.integer(min, max)` (max exclusive when min < max) */
  countMin: number;
  countMax: number;
  /** `FX.particleFac`: the spawn count multiplier */
  particleFac: number;
  /** seconds; 0 = forever when `infinite`, a single spawn otherwise */
  duration: number;
  infinite: boolean;
}

/** One emitter (or sequence sprite) the player starts. */
export interface EmitTrack {
  /** Pylinka system name */
  system: string;
  /** RevoltFX emitter/sequence the track came from */
  source: string;
  /** seconds after the effect starts */
  at: number;
  clock: SpawnClock;
  /** knob holding this emitter's rotation (radians), when it has one */
  rotationParam?: string;
  /** rotation relative to the effect, radians (`settings.rotation`) */
  rotation: number;
  /** radians per second added to the rotation (`autoRotation` × 60) */
  autoRotation: number;
  /** index of the track whose rotation this one adds (`childs[].adoptRotation`) */
  adoptRotationOf?: number;
  /** index of the track that started this one (an emitter child stops with its parent) */
  parent?: number;
  /** pixi container id (`containerId`) */
  containerId?: string;
}

export interface TriggerTrack {
  at: number;
  value: string;
}

export interface Timeline {
  emits: EmitTrack[];
  triggers: TriggerTrack[];
  /**
   * Seconds the effect can stay visible after its last spawn: the longest
   * particle lifetime summed along any parent → sub-emitter chain. The player
   * uses it to report completion without reading particle counts back from the GPU.
   */
  tail: number;
}

export interface ConvertedEffect {
  name: string;
  kind: 'emitter' | 'sequence';
  project: PylinkaProject;
  /** keyed by System.name; feed to `createPylinka({ textures })` after baking */
  textures: Record<string, SystemTexture>;
  timeline: Timeline;
  issues: FidelityIssue[];
}

interface Ctx {
  bundle: RfxBundle;
  opts: Required<Omit<ConvertOptions, 'sheet' | 'now' | 'kind'>> & Pick<ConvertOptions, 'sheet'>;
  report: Report;
  systems: System[];
  params: ParamDef[];
  subEmitters: Record<string, string>;
  textures: Record<string, SystemTexture>;
  timeline: Timeline;
  names: Map<string, number>;
  /** System.id → longest particle life, seconds */
  lifeMax: Map<string, number>;
  emitterById: Map<number, RfxEmitter>;
  sequenceById: Map<number, RfxSequence>;
  useBlendModes: boolean;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/** Every effect in a bundle, by name, per namespace. */
export function convertBundle(
  bundle: RfxBundle,
  opts: Omit<ConvertOptions, 'kind'> = {},
): { emitters: Record<string, ConvertedEffect>; sequences: Record<string, ConvertedEffect> } {
  const clean = sanitizeBundle(bundle);
  const emitters: Record<string, ConvertedEffect> = {};
  const sequences: Record<string, ConvertedEffect> = {};
  for (const e of clean.emitters) emitters[e.name] = convertEffect(clean, e.name, { ...opts, kind: 'emitter' });
  for (const s of clean.sequences) sequences[s.name] = convertEffect(clean, s.name, { ...opts, kind: 'sequence' });
  return { emitters, sequences };
}

/** Names of the effects a bundle defines. */
export function listEffects(bundle: RfxBundle): { emitters: string[]; sequences: string[] } {
  return {
    emitters: (bundle.emitters ?? []).map((e) => e.name),
    sequences: (bundle.sequences ?? []).map((s) => s.name),
  };
}

/**
 * Convert one effect. A name that is both an emitter and a sequence resolves to
 * the emitter unless `opts.kind` says otherwise.
 */
export function convertEffect(bundle: RfxBundle, name: string, opts: ConvertOptions = {}): ConvertedEffect {
  const clean = sanitizeBundle(bundle);
  const report = new Report();
  if (clean.__h !== undefined && clean.__h !== REVOLTFX_BUNDLE_HASH) {
    report.add('warning', 'bundle.hash', name, `Bundle hash "${clean.__h}" is not RevoltFX's; RevoltFX itself would refuse to load it.`);
  }
  if (clean.__v !== undefined && clean.__v !== REVOLTFX_SETTINGS_VERSION) {
    report.add('warning', 'bundle.version', name, `Settings version ${clean.__v} differs from ${REVOLTFX_SETTINGS_VERSION}.`);
  }
  if (opts.sheet === undefined) {
    report.add(
      'warning',
      'texture.size',
      name,
      `No spritesheet data: every texture is treated as ${FALLBACK_SIZE}×${FALLBACK_SIZE} px and movie clips cannot be resolved.`,
    );
  }

  const ctx: Ctx = {
    bundle: clean,
    opts: {
      drive: opts.drive ?? 'project',
      particleFac: opts.particleFac ?? 1,
      maxDepth: opts.maxDepth ?? 4,
      sheet: opts.sheet,
    },
    report,
    systems: [],
    params: [],
    subEmitters: {},
    textures: {},
    timeline: { emits: [], triggers: [], tail: 0 },
    names: new Map(),
    lifeMax: new Map(),
    emitterById: new Map(clean.emitters.map((e) => [e.id, e])),
    sequenceById: new Map(clean.sequences.map((s) => [s.id, s])),
    useBlendModes: clean.useBlendModes !== false,
  };

  const emitter = opts.kind !== 'sequence' ? clean.emitters.find((e) => e.name === name) : undefined;
  const sequence = emitter === undefined && opts.kind !== 'emitter' ? clean.sequences.find((s) => s.name === name) : undefined;
  if (emitter === undefined && sequence === undefined) {
    const what = opts.kind ?? 'emitter or sequence';
    throw new Error(`RevoltFX bundle has no ${what} named "${name}".`);
  }

  if (emitter !== undefined) {
    topEmitter(ctx, emitter, 1, 0, undefined, undefined);
  } else {
    playSequence(ctx, sequence!);
  }

  ctx.timeline.tail = tail(ctx);
  const now = opts.now ?? new Date().toISOString();
  const project: PylinkaProject = {
    format: 'pylinka/v1',
    version: 1,
    catalogVersion: CATALOG_VERSION,
    id: `revoltfx-${emitter !== undefined ? 'emitter' : 'sequence'}-${slug(name)}`,
    name,
    createdAt: now,
    updatedAt: now,
    params: ctx.params,
    assets: [],
    systems: ctx.systems,
    ...(Object.keys(ctx.subEmitters).length > 0 ? { subEmitters: ctx.subEmitters } : {}),
  };
  return {
    name,
    kind: emitter !== undefined ? 'emitter' : 'sequence',
    project,
    textures: ctx.textures,
    timeline: ctx.timeline,
    issues: report.issues,
  };
}

// ---------------------------------------------------------------------------
// effects → systems
// ---------------------------------------------------------------------------

/** A top-level emitter instance: driven by the timeline, positioned at the effect. */
function topEmitter(
  ctx: Ctx,
  e: RfxEmitter,
  scaleMod: number,
  at: number,
  adoptRotationOf: number | undefined,
  parent: number | undefined,
  depth = 0,
  /** rotation (rad) and autoRotation (rad/s) this emitter adds to, when it adopts its parent's */
  inherited: { rotation: number; spin: number } = { rotation: 0, spin: 0 },
): void {
  if (depth > 8) {
    ctx.report.add('warning', 'emitter.childs', e.name, 'Emitter children nest more than 8 levels deep; the rest were dropped.');
    return;
  }
  const sysName = uniqueName(ctx, e.name);
  const paramId = `p${ctx.params.length + 1}`;
  ctx.params.push({
    id: paramId,
    name: paramName(ctx, sysName),
    type: 'f32',
    scale: 'linear',
    default: { t: 'f32', v: e.rotation + inherited.rotation },
    unit: 'rad',
    group: 'rotation',
  });

  const clock = spawnClock(ctx, e);
  const emitter = ctx.opts.drive === 'runtime' ? ({ mode: 'flow', rate: 0 } as const) : projectEmitter(ctx, e, at);
  // in the player-driven mode the player turns the knob itself
  const spin = e.autoRotation * FPS + inherited.spin;
  emitterSystem(
    ctx,
    e,
    sysName,
    { scaleMod, rotation: { param: paramId }, sub: undefined, emitter, ...(ctx.opts.drive === 'project' && spin !== 0 ? { spin: { rate: spin, delay: at } } : {}) },
    0,
  );

  const index = ctx.timeline.emits.length;
  ctx.timeline.emits.push({
    system: sysName,
    source: e.name,
    at,
    clock,
    rotationParam: paramId,
    rotation: e.rotation,
    autoRotation: e.autoRotation * FPS,
    ...(adoptRotationOf !== undefined ? { adoptRotationOf } : {}),
    ...(parent !== undefined ? { parent } : {}),
    ...(e.containerId ? { containerId: e.containerId } : {}),
  });
  // MAPPING: emitter `childs` start with this emitter, at its position.
  for (const def of e.childs) {
    const child = refEmitter(ctx, def, e.name, 'emitter.childs');
    if (child === undefined) continue;
    const adopt = def.adoptRotation ? { rotation: e.rotation + inherited.rotation, spin } : { rotation: 0, spin: 0 };
    topEmitter(ctx, child, scaleMod * (def.scale || 1), at, def.adoptRotation ? index : undefined, index, depth + 1, adopt);
  }
}

/** A sequence: its elements become timed tracks. */
function playSequence(ctx: Ctx, seq: RfxSequence): void {
  const seqScale = mean(seq.scaleMin, seq.scaleMax);
  // EffectSequence.setNextEffect: element i+1 is only scheduled once element i
  // has fired, so a smaller delay after a larger one waits for it.
  let cursor = 0;
  for (const fx of seq.effects) {
    cursor = Math.max(cursor, fx.delay || 0);
    const at = (seq.delay || 0) + cursor;
    switch (fx.componentType) {
      case 2: {
        const e = ctx.emitterById.get(Number(fx.componentId));
        if (e === undefined) {
          ctx.report.add('warning', 'sequence.emitter', seq.name, `Element ${fx.id} names emitter ${String(fx.componentId)}, which the bundle does not have.`);
          break;
        }
        const m = mean(fx.scaleMin, fx.scaleMax) * seqScale;
        if (fx.scaleMin !== fx.scaleMax || seq.scaleMin !== seq.scaleMax) {
          ctx.report.add('approximate', 'sequence.scaleRange', seq.name, `Emitter "${e.name}" gets a random scale per play in RevoltFX; the conversion uses the mean (${round(m)}).`);
        }
        topEmitter(ctx, e, m, at, undefined, undefined);
        break;
      }
      case 0:
      case 1:
        spriteElement(ctx, seq, fx, at);
        break;
      case 3:
        ctx.timeline.triggers.push({ at, value: fx.triggerValue });
        break;
      default:
        ctx.report.add('warning', 'sequence.componentType', seq.name, `Element ${fx.id} has unknown componentType ${String(fx.componentType)}.`);
    }
  }
}

/** The one-particle graph of a sequence sprite / movie clip. */
function spriteGraph(seq: RfxSequence, fx: RfxSequenceEffect, tex: SystemTexture, rotation: (g: GraphBuilder) => F, m: number): GraphBuilder {
  const S = tex.box.side / BASE_PX;
  const g = new GraphBuilder();
  // init
  g.add('output.spawnPosition', { pos: [0, 0] });
  g.add('output.initLife', { life: Math.max(fx.duration, 1e-3) });
  g.add('output.initRotation', { rot: g.add2(rotation(g), g.range(fx.rotationMin, fx.rotationMax)) }, { unit: 'radians' });
  // update: scale = rnd(element) × rnd(sequence) × scaleMod × texture side
  const scale = g.mul(g.mul(g.range(fx.scaleMin, fx.scaleMax), g.range(seq.scaleMin, seq.scaleMax)), S * m);
  g.add('output.writeScale', { scale });
  if (fx.tint !== 0xffffff) g.add('output.writeColor', { color: hexColor(fx.tint) });
  const alpha = g.range(fx.alphaMin, fx.alphaMax);
  if (alpha !== 1) g.add('output.writeAlpha', { alpha });
  return g;
}

/** A sequence sprite / movie clip: one particle, alive for `duration`. */
function spriteElement(ctx: Ctx, seq: RfxSequence, fx: RfxSequenceEffect, at: number): void {
  const id = String(fx.componentId ?? '');
  const sysName = uniqueName(ctx, `${seq.name}.${id || 'sprite'}`);
  const paramId = `p${ctx.params.length + 1}`;
  ctx.params.push({ id: paramId, name: paramName(ctx, sysName), type: 'f32', scale: 'linear', default: { t: 'f32', v: 0 }, unit: 'rad', group: 'rotation' });
  const cp = fx.componentParams ?? { animationSpeedMin: 1, animationSpeedMax: 1, anchorX: 0.5, anchorY: 0.5, loop: false };
  const tex = texture(ctx, seq.name, fx.componentType, id, cp.anchorX, cp.anchorY, cp.loop ? mean(cp.animationSpeedMin || 1, cp.animationSpeedMax || 1) : 1, cp.loop);
  if (fx.componentType === 1 && cp.loop && cp.animationSpeedMin !== cp.animationSpeedMax) {
    ctx.report.add('approximate', 'movieclip.animationSpeed', seq.name, `Movie clip "${id}" plays at a random speed per play in RevoltFX; the conversion uses the mean.`);
  }
  const g = spriteGraph(seq, fx, tex, (gb) => gb.knob(paramId), 1);

  ctx.lifeMax.set(`s${ctx.systems.length + 1}`, Math.max(fx.duration, 1e-3));
  ctx.systems.push({
    id: `s${ctx.systems.length + 1}`,
    name: sysName,
    capacity: 4,
    blendMode: blend(ctx, fx.blendMode, seq.name),
    enabled: true,
    space: 'world',
    emitter: ctx.opts.drive === 'runtime' ? { mode: 'flow', rate: 0 } : { mode: 'once', rate: 0, burst: { count: 1, interval: 1 }, ...(at > 0 ? { delay: at } : {}) },
    graph: g.graph(),
  });
  ctx.textures[sysName] = tex;
  ctx.timeline.emits.push({
    system: sysName,
    source: seq.name,
    at,
    clock: { frequencyMin: 0, frequencyMax: 0, countMin: 1, countMax: 1, particleFac: 1, duration: 0, infinite: false },
    rotationParam: paramId,
    rotation: 0,
    autoRotation: 0,
    ...(fx.containerId ? { containerId: fx.containerId } : {}),
  });
}

type SubEvent = 'death' | 'birth' | 'age' | 'bounce' | 'alive';

interface SubLink {
  parent: string;
  on: SubEvent;
  /** inclusive integer count range per parent event */
  countMin: number;
  countMax: number;
  /** on 'age': parent age in seconds */
  at?: number;
  /** on 'alive': events per second */
  rate?: number;
}

interface EmitterRole {
  scaleMod: number;
  /** a knob (top level) or a fixed angle (sub-emitter) */
  rotation: { param: string } | { value: number };
  sub: SubLink | undefined;
  /** the System.emitter to write (sub-emitters never fire on their own) */
  emitter?: EmitterSettings;
  /** autoRotation, rad/s, accumulated from `delay` seconds on (top level only) */
  spin?: { rate: number; delay: number };
}

/**
 * Build the System for one emitter instance and add it to ctx, then add its
 * sub-emitter children (which need it in place to link to).
 */
function emitterSystem(ctx: Ctx, e: RfxEmitter, sysName: string, role: EmitterRole, depth: number): System {
  const ps = e.particleSettings;
  const m = role.scaleMod;
  const src = e.name;
  const report = ctx.report;
  const tex = texture(
    ctx,
    src,
    ps.componentType,
    ps.componentId,
    ps.componentParams.anchorX,
    ps.componentParams.anchorY,
    mean(ps.componentParams.animationSpeedMin || 1, ps.componentParams.animationSpeedMax || 1),
    ps.componentParams.loop,
  );
  if (ps.componentType === 1 && ps.componentParams.animationSpeedMin !== ps.componentParams.animationSpeedMax) {
    report.add('approximate', 'movieclip.animationSpeed', src, 'Movie clip speed is random per particle in RevoltFX; the conversion plays every particle at the mean speed.');
  }
  ctx.textures[sysName] = tex;
  const S = tex.box.side / BASE_PX;

  const g = new GraphBuilder();
  const core = e.core.params;
  const gravityMode = e.useGravity;
  const useAlign = gravityMode && ps.align;

  // ---- init -----------------------------------------------------------------
  const life = g.range(ps.durationMin * m, ps.durationMax * m);
  g.add('output.initLife', { life });

  const rotation = role.rotation;
  // built on first use, so an unused emitter angle leaves no dead nodes
  const lazy = <T,>(make: () => T): (() => T) => {
    let v: T | undefined;
    let made = false;
    return () => {
      if (!made) {
        v = make();
        made = true;
      }
      return v as T;
    };
  };
  // emitter rotation at spawn: the knob (or a fixed angle), plus autoRotation
  // accumulated since this emitter started (input.time counts from the system's start)
  const rotOf = lazy<F>(() => {
    const base: F = 'param' in rotation ? g.knob(rotation.param) : rotation.value;
    if (role.spin === undefined || role.spin.rate === 0) return base;
    const since = role.spin.delay > 0 ? g.add2(g.op('input.time'), -role.spin.delay) : g.op('input.time');
    return g.add2(base, g.mul(since, role.spin.rate));
  });
  const emitDir = lazy<V>(() => g.vec(g.cos(rotOf()), g.sin(rotOf())));
  let pos: V = [0, 0];
  let dir: (() => V) = emitDir;
  /** birth sprite rotation (radians) */
  let birthRot: () => F = rotOf;

  switch (e.core.type) {
    case 'box': {
      // BoxEmitterCore: offset in an axis-aligned box, rotated by the emitter
      const local = g.vec(g.range((-core.width * m) / 2, (core.width * m) / 2), g.range((-core.height * m) / 2, (core.height * m) / 2));
      pos = g.rotate(local, rotOf());
      if (core.radial) {
        const p = pos;
        dir = lazy(() => g.normalize(p));
        // BoxEmitterCore: rotation = emitter rotation + atan2(y, x) = heading of the rotated offset
        birthRot = lazy(() => g.op('math.atan2', { y: g.component(p, 'y'), x: g.component(p, 'x') }));
      }
      break;
    }
    case 'ring':
    case 'circle':
    default: {
      const theta = lazy<F>(() => {
        if (e.core.type === 'ring' && core.uniform) return ringUniformAngle(ctx, g, e, rotOf());
        if (e.core.type === 'circle' && !core.angle) return g.add2(rotOf(), g.range(0, TAU));
        return g.add2(rotOf(), g.range(-core.angle / 2, core.angle / 2));
      });
      const u = lazy<V>(() => g.vec(g.cos(theta()), g.sin(theta())));
      if (core.radius > 0) {
        const radius = e.core.type === 'ring' ? core.radius * m : g.range(0, core.radius * m);
        pos = g.scale(u(), radius);
      }
      if (core.radial) {
        dir = u;
        birthRot = theta;
      }
      if (e.core.type !== 'ring' && e.core.type !== 'circle') {
        report.add('warning', 'core.type', src, `Unknown core type "${String(e.core.type)}"; treated as a circle.`);
      }
      break;
    }
  }
  g.add('output.spawnPosition', { pos });

  const randomStart = ps.useRotation && ps.randomStartRotation && !useAlign;
  g.add('output.initRotation', { rot: randomStart ? g.range(0, TAU) : birthRot() }, { unit: 'radians' });

  let distanceEase: string | undefined;
  if (ps.useMotion) {
    if (gravityMode) {
      // moveSpeed is px per frame
      const speed = g.range(ps.moveSpeedMin * m * FPS, ps.moveSpeedMax * m * FPS);
      if (speed !== 0) g.add('output.initVelocity', { vel: g.scale(dir(), speed) });
    } else {
      // Particle.init: Rnd.integer(dMin, dMax) * 0.8 * scaleMod, then * 0.8 again.
      // The velocity slot carries the whole displacement; the update pass
      // walks the particle along it by the ease's step each frame.
      const distance = g.mul(g.range(ps.distanceMin, ps.distanceMax), 0.64 * m);
      if (distance !== 0) {
        g.add('output.initVelocity', { vel: g.scale(dir(), distance) });
        distanceEase = ps.distanceEase;
      }
    }
  }

  // ---- update ---------------------------------------------------------------
  if (gravityMode) {
    if (e.gravity !== 0) g.add('output.addForce', { force: g.op('field.gravity', { g: [0, e.gravity * FPS * FPS] }, undefined, 'force') });
    if (e.useFloor && e.floorY > 0) {
      g.add('output.collidePlane', {
        point: [0, e.floorY],
        normal: [0, -1],
        restitution: g.range(ps.bounceFacMin * m, ps.bounceFacMax * m),
        friction: g.range(ps.frictionMin * m, ps.frictionMax * m),
      });
      if (ps.stopOnBounce) {
        // the plane parks the particle on floorY; the next frame kills it there
        g.add('output.killIfOutOfRect', { min: [-1e6, -1e6], max: [1e6, e.floorY - 0.01] });
        report.add('approximate', 'particle.stopOnBounce', src, 'stopOnBounce: the particle dies on the frame after it hits the floor, one frame later than RevoltFX.');
      }
    }
  } else if (distanceEase !== undefined) {
    // exact eased tween: pos += D·(E((age + dt)/life) − E(age/life))
    const ease = mapEase(distanceEase);
    noteEase(ctx, src, 'distanceEase', distanceEase, ease);
    const age = g.op('input.age');
    const lifeU = g.op('input.life');
    const next = g.op('gen.ease', { t: g.div(g.add2(age, g.op('input.dt')), lifeU) }, { ease: ease.key });
    const now = g.op('gen.ease', { t: g.op('input.ageNormalized') }, { ease: ease.key });
    const step = g.add2(next, g.mul(now, -1));
    const p = g.op('input.position');
    const v = g.op('input.velocity');
    g.add('output.writePosition', {
      pos: g.vec(g.op('math.mad', { a: g.component(v, 'x'), b: step, c: g.component(p, 'x') }), g.op('math.mad', { a: g.component(v, 'y'), b: step, c: g.component(p, 'y') })),
    });
  }

  // rotation: RevoltFX adds rotationSpeed (rad per frame) to whatever the angle is
  const spinning = ps.useRotation && !(ps.rotationSpeedMin === 0 && ps.rotationSpeedMax === 0);
  let spinStep: F = 0;
  if (spinning) {
    let rate = g.range(ps.rotationSpeedMin * m * FPS, ps.rotationSpeedMax * m * FPS);
    if (ps.randomRotationDirection) {
      // sign = sin(x) / |sin(x)|, x uniform → ±1 with even odds
      const sx = g.sin(g.range(0, TAU));
      rate = g.mul(rate, g.div(sx, g.abs(sx)));
    }
    spinStep = g.mul(rate, g.op('input.dt'));
  }
  if (useAlign) {
    // Particle.update: rotation = atan2(velocity), then the spin step on top
    const v = g.op('input.velocity');
    const heading = g.op('math.atan2', { y: g.component(v, 'y'), x: g.component(v, 'x') });
    g.add('output.writeRotation', { rot: g.add2(heading, spinStep) }, { unit: 'radians' });
  } else if (spinning) {
    g.add('output.writeRotation', { rot: g.add2(g.op('input.rotation'), spinStep) }, { unit: 'radians' });
  }

  if (ps.useAlpha) {
    const a0 = g.range(ps.alphaStartMin, ps.alphaStartMax);
    const a1 = g.range(ps.alphaEndMin, ps.alphaEndMax);
    let alpha: F;
    if (ps.fadeIn) {
      const ramp = heldRamp(ps.alphaEase, ps.fadeInDurationFac);
      const win = fadeWindow(ps.fadeInEase, ps.fadeInDurationFac);
      noteEase(ctx, src, 'alphaEase (with fadeIn)', ps.alphaEase, ramp);
      noteEase(ctx, src, 'fadeInEase', ps.fadeInEase, win);
      const t = () => g.op('gen.numberOverLife', { from: 0, to: 1 }, { ease: ramp.key });
      const w = g.op('gen.numberOverLife', { from: 0, to: 1 }, { ease: win.key });
      alpha = g.mul(g.mix(a0, a1, t), w);
    } else {
      const ease = mapEase(ps.alphaEase);
      noteEase(ctx, src, 'alphaEase', ps.alphaEase, ease);
      alpha = a0 === a1 ? a0 : g.op('gen.alphaOverLife', { from: a0, to: a1 }, { ease: ease.key });
    }
    if (alpha !== 1) g.add('output.writeAlpha', { alpha });
  }

  // scale: RevoltFX scale × the texture's square side / BASE_PX
  /** one axis' tween (start/end ranges, its ease, scaleIn window) */
  const tween = (sMin: number, sMax: number, eMin: number, eMax: number, easeName: string, label: string): F => {
    const s0 = g.range(sMin * m, sMax * m);
    let s1 = g.range(eMin, eMax);
    // Particle.init: end = start + (end − start) · scaleMod
    if (m !== 1) s1 = g.mix(s0, s1, m);
    if (ps.scaleIn) {
      const ramp = heldRamp(easeName, ps.scaleInDurationFac);
      const win = fadeWindow(ps.scaleInEase, ps.scaleInDurationFac);
      noteEase(ctx, src, `${label} (with scaleIn)`, easeName, ramp);
      noteEase(ctx, src, 'scaleInEase', ps.scaleInEase, win);
      const t = () => g.op('gen.numberOverLife', { from: 0, to: 1 }, { ease: ramp.key });
      const w = g.op('gen.numberOverLife', { from: 0, to: 1 }, { ease: win.key });
      return g.mul(g.mix(s0, s1, t), w);
    }
    if (typeof s0 === 'number' && typeof s1 === 'number' && s0 === s1) return s0;
    const ease = mapEase(easeName);
    noteEase(ctx, src, label, easeName, ease);
    return g.op('gen.numberOverLife', { from: s0, to: s1 }, { ease: ease.key });
  };
  if (ps.useScale && !ps.uniformScale) {
    const sx = tween(ps.scaleXStartMin, ps.scaleXStartMax, ps.scaleXEndMin, ps.scaleXEndMax, ps.scaleXEase, 'scaleXEase');
    const sy = tween(ps.scaleYStartMin, ps.scaleYStartMax, ps.scaleYEndMin, ps.scaleYEndMax, ps.scaleYEase, 'scaleYEase');
    g.add('output.writeScaleXY', { scale: g.vec(g.mul(sx, S), g.mul(sy, S)) });
  } else {
    const scale = ps.useScale ? tween(ps.scaleStartMin, ps.scaleStartMax, ps.scaleEndMin, ps.scaleEndMax, ps.scaleEase, 'scaleEase') : 1;
    g.add('output.writeScale', { scale: g.mul(scale, S) });
  }

  if (ps.useTint && ps.tintStart !== ps.tintEnd) {
    const ease = mapEase(ps.tintEase);
    noteEase(ctx, src, 'tintEase', ps.tintEase, ease);
    g.add('output.writeColor', { color: g.op('gen.colorOverLife', { from: hexColor(ps.tintStart), to: hexColor(ps.tintEnd) }, { ease: ease.key }) });
  } else if (ps.useTint && ps.tintStart !== 0xffffff) {
    g.add('output.writeColor', { color: hexColor(ps.tintStart) });
  }

  if (!ps.addOnTop) {
    report.add('unsupported', 'particle.addOnTop', src, 'addOnTop: false draws new particles under old ones; Pylinka draws in pool order.');
  }

  // ---- sub-emitter link -----------------------------------------------------
  let burstMax = 1;
  if (role.sub !== undefined) {
    const sub = role.sub;
    // pool copies per parent: one per particle per event, or, for a trail, the
    // children alive at once (rate × child life)
    const need = sub.on === 'alive' ? Math.ceil((sub.rate ?? 1) * Math.max(ps.durationMin, ps.durationMax) * m * sub.countMax) + 1 : sub.countMax;
    burstMax = BURST_MAX_OPTIONS.find((o) => o >= need) ?? BURST_CAP;
    if (need > BURST_CAP) {
      report.add('approximate', 'spawn.count', src, `Needs up to ${need} live particles per parent; Pylinka caps a sub-emitter at ${BURST_CAP}.`);
    }
    // round(mix(a − ½, b + ½, r)) is uniform over the integers a..b
    g.add(
      'output.deathBurst',
      {
        countMin: sub.countMin - 0.499,
        countMax: Math.min(sub.countMax, BURST_CAP) + 0.499,
        inheritVelocity: 0,
        ...(sub.on === 'age' ? { at: sub.at ?? 0.5 } : {}),
        ...(sub.on === 'alive' ? { rate: sub.rate ?? 1 } : {}),
      },
      { max: String(burstMax), on: sub.on },
    );
  }

  let capacity = estimateCapacity(ctx, e, m);
  const parent = role.sub !== undefined ? ctx.systems.find((x) => x.name === role.sub!.parent) : undefined;
  // the engines size a child pool as parent capacity × burst max
  if (role.sub !== undefined) capacity = Math.max(1, (parent?.capacity ?? 64) * burstMax);
  const system: System = {
    id: `s${ctx.systems.length + 1}`,
    name: sysName,
    capacity,
    blendMode: blend(ctx, ps.blendMode, src),
    enabled: true,
    space: 'world',
    emitter: role.emitter ?? { mode: 'flow', rate: 0 },
    graph: g.graph(),
  };
  ctx.systems.push(system);
  ctx.lifeMax.set(system.id, Math.max(ps.durationMin, ps.durationMax) * m);
  if (parent !== undefined) ctx.subEmitters[system.id] = parent.id;

  // ---- particle spawns / trails → child systems (after this system is placed) --
  if (ps.useSpawns) queueMicroSpawns(ctx, e, sysName, m, depth);
  if (ps.useChilds && ps.childs.length > 0) queueTrails(ctx, e, sysName, m, depth);
  return system;
}

/** Ring core with `uniform`: angles stepped by the index inside one spawn. */
function ringUniformAngle(ctx: Ctx, g: GraphBuilder, e: RfxEmitter, rot: F): F {
  const core = e.core.params;
  const lo = e.spawnCountMin;
  const hi = e.spawnCountMax;
  const fixed = hi - lo <= 1; // Rnd.integer(lo, hi) has an exclusive max
  // inside a sub-emitter burst input.spawnIndex is the index within that burst
  const n = Math.max(1, Math.ceil((fixed ? lo : (lo + hi - 1) / 2) * ctx.opts.particleFac));
  if (!fixed) {
    ctx.report.add('approximate', 'core.ring.uniform', e.name, `A uniform ring spaces its spawn count evenly; the count varies (${lo}–${hi - 1}), so angles are spaced for ${n}.`);
  }
  // RingEmitterCore.prepare
  let start: number;
  let step: number;
  if (TAU - core.angle < 0.1) {
    step = core.angle / n;
    start = core.angle;
  } else {
    step = n > 1 ? core.angle / (n - 1) : 0;
    start = -core.angle / 2;
  }
  const idx = g.op('input.spawnIndex');
  return g.add2(g.add2(rot, start), g.mul(idx, step));
}

/**
 * Particle `spawn` lists → sub-emitter child systems. RevoltFX starts a whole
 * emitter (or sequence) at the particle; Pylinka bursts the child's particles
 * from the parent slot.
 */
function queueMicroSpawns(ctx: Ctx, e: RfxEmitter, parentSys: string, m: number, depth: number): void {
  const ps = e.particleSettings;
  const src = e.name;
  // RevoltFX fires onHalfway at age ≥ 0.5 s (not half the lifetime): an 'age' event at 0.5
  const lists: [RfxSpawnDef[], SubEvent][] = [
    [ps.spawn.onComplete, 'death'],
    [ps.spawn.onStart, 'birth'],
    [ps.spawn.onHalfway, 'age'],
    [e.useGravity && e.useFloor && e.floorY > 0 ? ps.spawn.onBounce : [], 'bounce'],
  ];
  for (const [list, on] of lists) {
    for (const def of list) {
      if (depth + 1 > ctx.opts.maxDepth) {
        ctx.report.add('unsupported', 'spawn.depth', src, `Sub-emitter spawns nest deeper than maxDepth (${ctx.opts.maxDepth}); deeper levels were dropped.`);
        continue;
      }
      const scale = m * (def.scale || 1);
      if (def.type === 1) {
        const seq = ctx.sequenceById.get(def.id);
        if (seq === undefined) {
          ctx.report.add('warning', 'spawn.sequence', src, `Spawn names sequence ${def.id}, which the bundle does not have.`);
          continue;
        }
        burstSequence(ctx, seq, parentSys, on, scale * mean(seq.scaleMin, seq.scaleMax), depth + 1, src);
      } else {
        const child = refEmitter(ctx, def, src, 'spawn');
        if (child === undefined) continue;
        if (def.adoptRotation && directional(child)) {
          ctx.report.add('approximate', 'spawn.adoptRotation', src, `"${child.name}" should turn with the parent particle; a Pylinka child cannot read the parent's rotation.`);
        }
        burstEmitter(ctx, child, parentSys, on, scale, depth + 1);
      }
    }
  }
}

/**
 * `particleSettings.childs`: emitters that ride along with each particle (a
 * trail). RevoltFX starts each one at the particle's birth and moves it with
 * the particle; Pylinka spawns the child's particles from the live parent,
 * `rate` times a second (an 'alive' sub-emitter), or once at birth for a
 * one-shot child.
 */
function queueTrails(ctx: Ctx, e: RfxEmitter, parentSys: string, m: number, depth: number, guard = 0): void {
  for (const def of e.particleSettings.childs) {
    if (depth + 1 > ctx.opts.maxDepth || guard > 8) {
      ctx.report.add('unsupported', 'spawn.depth', e.name, `Trail emitters nest deeper than maxDepth (${ctx.opts.maxDepth}); deeper levels were dropped.`);
      continue;
    }
    const child = refEmitter(ctx, def, e.name, 'particle.childs');
    if (child === undefined) continue;
    trailEmitter(ctx, child, parentSys, m * (def.scale || 1), depth + 1, def.adoptRotation, e.name, guard);
  }
}

function trailEmitter(ctx: Ctx, child: RfxEmitter, parentSys: string, m: number, depth: number, adopt: boolean, src: string, guard: number): void {
  const fac = ctx.opts.particleFac;
  const countMin = Math.ceil(child.spawnCountMin * fac);
  const countMax = Math.ceil((child.spawnCountMax > child.spawnCountMin ? child.spawnCountMax - 1 : child.spawnCountMin) * fac);
  const oneShot = !child.infinite && child.duration <= 0;
  // ParticleEmitter.update resets its timer on each spawn: whole frames at 60 fps
  const interval = Math.max(1, Math.ceil(mean(child.spawnFrequencyMin, child.spawnFrequencyMax) * FPS - 1e-6)) / FPS;
  if (adopt && directional(child)) {
    ctx.report.add('approximate', 'trail.adoptRotation', src, `Trail "${child.name}" should turn with its particle; a Pylinka child cannot read the parent's rotation.`);
  }
  if (!oneShot && child.spawnFrequencyMin !== child.spawnFrequencyMax) {
    ctx.report.add('approximate', 'trail.interval', src, `Trail "${child.name}" spawns at a random interval in RevoltFX; the conversion uses the mean (${round(interval, 3)} s).`);
  }
  if (!oneShot && !child.infinite) {
    ctx.report.add('approximate', 'trail.duration', src, `Trail "${child.name}" stops after ${round(child.duration)} s in RevoltFX; here it runs until its particle dies.`);
  }
  const sysName = uniqueName(ctx, child.name);
  emitterSystem(
    ctx,
    child,
    sysName,
    {
      scaleMod: m,
      rotation: { value: child.rotation },
      sub: oneShot ? { parent: parentSys, on: 'birth', countMin, countMax } : { parent: parentSys, on: 'alive', countMin, countMax, rate: 1 / interval },
    },
    depth,
  );
  // a child emitter's own childs start with it and follow the same particle
  for (const def of child.childs) {
    const grand = refEmitter(ctx, def, child.name, 'emitter.childs');
    if (grand !== undefined && guard < 8) trailEmitter(ctx, grand, parentSys, m * (def.scale || 1), depth, def.adoptRotation, src, guard + 1);
  }
}

/** One spawned emitter (plus the `childs` it starts) as burst children of `parentSys`. */
function burstEmitter(ctx: Ctx, e: RfxEmitter, parentSys: string, on: SubEvent, m: number, depth: number, guard = 0): void {
  const fac = ctx.opts.particleFac;
  const lo = Math.ceil(e.spawnCountMin * fac);
  const hiExclusive = e.spawnCountMax > e.spawnCountMin ? e.spawnCountMax - 1 : e.spawnCountMax;
  let countMin = lo;
  let countMax = Math.ceil(hiExclusive * fac);
  const oneShot = !e.infinite && e.duration <= 0;
  if (!oneShot) {
    const f = Math.max(mean(e.spawnFrequencyMin, e.spawnFrequencyMax), 1 / FPS);
    const bursts = e.infinite ? 1 : 1 + Math.floor(e.duration / f);
    countMin *= bursts;
    countMax *= bursts;
    ctx.report.add(
      'approximate',
      'spawn.continuous',
      e.name,
      e.infinite
        ? `Spawned on a particle ${on}, this emitter streams forever in RevoltFX; Pylinka bursts once (${countMin}–${countMax}).`
        : `Spawned on a particle ${on}, this emitter streams for ${round(e.duration)} s in RevoltFX; Pylinka bursts its ~${countMax} particles at once.`,
    );
  }
  const sysName = uniqueName(ctx, e.name);
  emitterSystem(ctx, e, sysName, { scaleMod: m, rotation: { value: e.rotation }, sub: { parent: parentSys, on, countMin, countMax, ...(on === 'age' ? { at: 0.5 } : {}) } }, depth);
  for (const def of e.childs) {
    if (guard > 8) break;
    const child = refEmitter(ctx, def, e.name, 'emitter.childs');
    if (child !== undefined) burstEmitter(ctx, child, parentSys, on, m * (def.scale || 1), depth, guard + 1);
  }
}

/** A sequence sprite spawned on a particle event: a one-particle child. */
function spriteBurst(ctx: Ctx, seq: RfxSequence, fx: RfxSequenceEffect, parentSys: string, on: SubEvent, m: number): void {
  const id = String(fx.componentId ?? '');
  const cp = fx.componentParams ?? { animationSpeedMin: 1, animationSpeedMax: 1, anchorX: 0.5, anchorY: 0.5, loop: false };
  const tex = texture(ctx, seq.name, fx.componentType, id, cp.anchorX, cp.anchorY, cp.loop ? mean(cp.animationSpeedMin || 1, cp.animationSpeedMax || 1) : 1, cp.loop);
  const g = spriteGraph(seq, fx, tex, () => 0, m);
  g.add('output.deathBurst', { countMin: 0.501, countMax: 1.499, inheritVelocity: 0, ...(on === 'age' ? { at: 0.5 } : {}) }, { max: '1', on });
  const parent = ctx.systems.find((x) => x.name === parentSys);
  const sysName = uniqueName(ctx, `${seq.name}.${id || 'sprite'}`);
  const id2 = `s${ctx.systems.length + 1}`;
  ctx.systems.push({
    id: id2,
    name: sysName,
    capacity: parent?.capacity ?? 64,
    blendMode: blend(ctx, fx.blendMode, seq.name),
    enabled: true,
    space: 'world',
    emitter: { mode: 'flow', rate: 0 },
    graph: g.graph(),
  });
  ctx.textures[sysName] = tex;
  ctx.lifeMax.set(id2, Math.max(fx.duration, 1e-3));
  if (parent !== undefined) ctx.subEmitters[id2] = parent.id;
}

/** A sequence spawned on a particle event: its emitters and sprites burst at once. */
function burstSequence(ctx: Ctx, seq: RfxSequence, parentSys: string, on: SubEvent, m: number, depth: number, src: string): void {
  for (const fx of seq.effects) {
    if ((fx.delay || 0) > 0 || (seq.delay || 0) > 0) {
      ctx.report.add('approximate', 'spawn.sequence.delay', src, `Sequence "${seq.name}" spawned on a particle ${on} plays its timed elements at once.`);
    }
    if (fx.componentType === 2) {
      const e = ctx.emitterById.get(Number(fx.componentId));
      if (e !== undefined) burstEmitter(ctx, e, parentSys, on, m * mean(fx.scaleMin, fx.scaleMax), depth);
    } else if (fx.componentType === 3) {
      ctx.report.add('unsupported', 'spawn.sequence.trigger', src, `Trigger "${fx.triggerValue}" in sequence "${seq.name}" fires per particle in RevoltFX; the player cannot see GPU particle deaths, so it was dropped.`);
    } else {
      spriteBurst(ctx, seq, fx, parentSys, on, m);
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Longest lifetime chain: a system's life plus the longest chain below it. */
function tail(ctx: Ctx): number {
  const memo = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const [child, parent] of Object.entries(ctx.subEmitters)) {
    children.set(parent, [...(children.get(parent) ?? []), child]);
  }
  const chain = (id: string, guard: number): number => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    let below = 0;
    if (guard < 16) for (const c of children.get(id) ?? []) below = Math.max(below, chain(c, guard + 1));
    const v = (ctx.lifeMax.get(id) ?? 0) + below;
    memo.set(id, v);
    return v;
  };
  let best = 0;
  for (const s of ctx.systems) if (ctx.subEmitters[s.id] === undefined) best = Math.max(best, chain(s.id, 0));
  return best;
}

function refEmitter(ctx: Ctx, def: RfxSpawnDef, src: string, feature: string): RfxEmitter | undefined {
  const e = ctx.emitterById.get(def.id);
  if (e === undefined) ctx.report.add('warning', feature, src, `References emitter ${def.id}, which the bundle does not have.`);
  return e;
}

/** Does this emitter's look depend on its rotation? */
function directional(e: RfxEmitter): boolean {
  const p = e.core.params;
  if (e.core.type === 'box') return true;
  if (!p.radial) return true;
  return p.angle !== 0 && TAU - p.angle > 0.1;
}

/** RevoltFX's spawn clock, with particleFac folded in. */
function spawnClock(ctx: Ctx, e: RfxEmitter): SpawnClock {
  return {
    frequencyMin: e.spawnFrequencyMin,
    frequencyMax: e.spawnFrequencyMax,
    countMin: e.spawnCountMin,
    countMax: e.spawnCountMax,
    particleFac: ctx.opts.particleFac,
    duration: e.duration,
    infinite: e.infinite,
  };
}

/**
 * RevoltFX's spawn clock as project emitter settings (drive: 'project').
 * ParticleEmitter.update fires on its first frame, waits Rnd.float(fMin, fMax),
 * and resets its timer to 0 when it fires, so at 60 fps an interval is rounded
 * up to whole frames (and is never shorter than one).
 */
function projectEmitter(ctx: Ctx, e: RfxEmitter, at: number): EmitterSettings {
  const fac = ctx.opts.particleFac;
  // Rnd.integer(min, max): floor(r·(max − min) + min), max exclusive
  const lo = Math.ceil(e.spawnCountMin * fac);
  const hi = Math.ceil((e.spawnCountMax > e.spawnCountMin ? e.spawnCountMax - 1 : e.spawnCountMin) * fac);
  if (fac !== 1 && !Number.isInteger(fac)) {
    ctx.report.add('approximate', 'emitter.particleFac', e.name, `particleFac ${fac} scales the count range ends, not each random draw.`);
  }
  const frames = (f: number) => Math.max(1, Math.ceil(f * FPS - 1e-6)) / FPS;
  const delay = at > 0 ? { delay: at } : {};
  const burst = { count: lo, ...(hi > lo ? { countMax: hi } : {}), interval: frames(e.spawnFrequencyMin) };
  if (!e.infinite && e.duration <= 0) return { mode: 'once', rate: 0, burst: { ...burst, interval: 1 }, ...delay };
  const intervalMax = frames(e.spawnFrequencyMax);
  return {
    mode: 'burst',
    rate: 0,
    burst: { ...burst, ...(intervalMax > burst.interval ? { intervalMax } : {}), immediate: true },
    ...delay,
    ...(!e.infinite && e.duration > 0 ? { duration: e.duration } : {}),
  };
}

/** Live particle peak: spawns per second × longest life, capped like RevoltFX's maxParticles. */
function estimateCapacity(ctx: Ctx, e: RfxEmitter, m: number): number {
  const fac = ctx.opts.particleFac;
  const perSpawn = Math.ceil(Math.max(e.spawnCountMin, e.spawnCountMax) * fac);
  const life = Math.max(e.particleSettings.durationMin, e.particleSettings.durationMax) * m;
  const oneShot = !e.infinite && e.duration <= 0;
  const interval = Math.max(Math.min(e.spawnFrequencyMin, e.spawnFrequencyMax), 1 / FPS);
  const peak = oneShot ? perSpawn : Math.ceil(perSpawn * (life / interval + 2));
  return Math.max(4, Math.min(e.maxParticles || 1000, peak));
}

function texture(
  ctx: Ctx,
  src: string,
  componentType: number,
  componentId: string,
  anchorX: number,
  anchorY: number,
  speed: number,
  loop: boolean,
): SystemTexture {
  const sheet = ctx.opts.sheet;
  const ax = Number.isFinite(anchorX) ? anchorX : 0.5;
  const ay = Number.isFinite(anchorY) ? anchorY : 0.5;
  const size = componentSize(sheet, componentType, componentId);
  if (size === undefined && sheet !== undefined) {
    ctx.report.add('warning', 'texture.missing', src, `Texture "${componentId}" is not in the spritesheet; assuming ${FALLBACK_SIZE}×${FALLBACK_SIZE} px.`);
  }
  const { w, h } = size ?? { w: FALLBACK_SIZE, h: FALLBACK_SIZE };
  const box = spriteBox(w, h, ax, ay);
  if (componentType === 1) {
    return {
      kind: 'movieclip',
      frames: movieClipFrames(sheet, componentId),
      anchorX: ax,
      anchorY: ay,
      box,
      // pixi AnimatedSprite: animationSpeed frames per 60 Hz tick
      fps: FPS * speed,
      play: loop ? 'loop' : 'hold',
    };
  }
  return { kind: 'sprite', frames: [componentId], anchorX: ax, anchorY: ay, box };
}

function blend(ctx: Ctx, mode: number, src: string): System['blendMode'] {
  if (!ctx.useBlendModes) return 'normal';
  void src;
  return BLEND[mode] ?? 'normal';
}

function noteEase(ctx: Ctx, src: string, what: string, name: string | undefined, fit: FittedEase): void {
  if (fit.error > 0.001) {
    ctx.report.add('approximate', 'ease', src, `${what} "${name ?? 'linear'}" has no Pylinka preset; fitted as a curve (max error ${round(fit.error, 3)}).`, fit.error);
  }
}

function uniqueName(ctx: Ctx, base: string): string {
  const n = (ctx.names.get(base) ?? 0) + 1;
  ctx.names.set(base, n);
  return n === 1 ? base : `${base}#${n}`;
}

/** A knob name (/^[a-zA-Z_][a-zA-Z0-9_]*$/), unique within the project. */
function paramName(ctx: Ctx, sysName: string): string {
  const base = `rotation_${sysName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const taken = new Set(ctx.params.map((p) => p.name));
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  return name;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'effect';
}

function hexColor(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}ff`;
}

function mean(a: number, b: number): number {
  return (a + b) / 2;
}

function round(n: number, digits = 2): number {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
}

