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
import { fadeWindow, fitDrag, heldRamp, mapEase, type FittedEase } from './ease.js';
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
const BURST_MAX_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

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
    default: { t: 'f32', v: e.rotation },
    unit: 'rad',
    group: 'rotation',
  });

  const clock = spawnClock(ctx, e);
  const emitter = ctx.opts.drive === 'runtime' ? ({ mode: 'flow', rate: 0 } as const) : projectEmitter(ctx, e, clock);
  emitterSystem(ctx, e, sysName, { scaleMod, rotation: { param: paramId }, sub: undefined, emitter }, 0);

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
  if (e.autoRotation !== 0 && ctx.opts.drive === 'project') {
    ctx.report.add('approximate', 'emitter.autoRotation', e.name, 'autoRotation needs the player; the plain project keeps the start rotation.');
  }

  // MAPPING: emitter `childs` start with this emitter, at its position.
  for (const def of e.childs) {
    const child = refEmitter(ctx, def, e.name, 'emitter.childs');
    if (child === undefined) continue;
    topEmitter(ctx, child, scaleMod * (def.scale || 1), at, def.adoptRotation ? index : undefined, index, depth + 1);
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
  const S = tex.box.side / BASE_PX;

  const g = new GraphBuilder();
  // init
  g.add('output.spawnPosition', { pos: [0, 0] });
  g.add('output.initLife', { life: Math.max(fx.duration, 1e-3) });
  g.add('output.initRotation', { rot: g.add2(g.knob(paramId), g.range(fx.rotationMin, fx.rotationMax)) }, { unit: 'radians' });
  // update: scale = rnd(element) × rnd(sequence) × texture side
  const scale = g.mul(g.mul(g.range(fx.scaleMin, fx.scaleMax), g.range(seq.scaleMin, seq.scaleMax)), S);
  g.add('output.writeScale', { scale });
  if (fx.tint !== 0xffffff) g.add('output.writeColor', { color: hexColor(fx.tint) });
  const alpha = g.range(fx.alphaMin, fx.alphaMax);
  if (alpha !== 1) g.add('output.writeAlpha', { alpha });

  ctx.lifeMax.set(`s${ctx.systems.length + 1}`, Math.max(fx.duration, 1e-3));
  ctx.systems.push({
    id: `s${ctx.systems.length + 1}`,
    name: sysName,
    capacity: 4,
    blendMode: blend(ctx, fx.blendMode, seq.name),
    enabled: true,
    space: 'world',
    emitter: ctx.opts.drive === 'runtime' ? { mode: 'flow', rate: 0 } : { mode: 'once', rate: 0, burst: { count: 1, interval: 1 } },
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
  if (ctx.opts.drive === 'project' && at > 0) {
    ctx.report.add('approximate', 'sequence.delay', seq.name, `Element "${id}" starts at ${round(at)} s; without the player it starts at once.`);
  }
}

interface SubLink {
  parent: string;
  on: 'death' | 'birth';
  /** inclusive integer count range per parent event */
  countMin: number;
  countMax: number;
}

interface EmitterRole {
  scaleMod: number;
  /** a knob (top level) or a fixed angle (sub-emitter) */
  rotation: { param: string } | { value: number };
  sub: SubLink | undefined;
  /** the System.emitter to write (sub-emitters never fire on their own) */
  emitter?: EmitterSettings;
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
  const rotOf = lazy<F>(() => ('param' in rotation ? g.knob(rotation.param) : rotation.value));
  const emitDir = lazy<V>(() => g.vec(g.cos(rotOf()), g.sin(rotOf())));
  let pos: V = [0, 0];
  let dir: (() => V) = emitDir;
  /** birth sprite rotation (radians) */
  let birthRot: () => F = rotOf;
  /** true when the birth rotation is per-particle and the update pass cannot rebuild it */
  let birthRotVaries = false;

  switch (e.core.type) {
    case 'box': {
      // BoxEmitterCore: offset in an axis-aligned box, rotated by the emitter
      const local = g.vec(g.range((-core.width * m) / 2, (core.width * m) / 2), g.range((-core.height * m) / 2, (core.height * m) / 2));
      pos = g.rotate(local, rotOf());
      if (core.radial) {
        const p = pos;
        dir = lazy(() => g.normalize(p));
        report.add('approximate', 'core.box.radial', src, 'A radial box core rotates each sprite to its own heading (atan2); Pylinka has no atan2, so sprites keep the emitter rotation.');
      }
      break;
    }
    case 'ring':
    case 'circle':
    default: {
      const theta = lazy<F>(() => {
        if (e.core.type === 'ring' && core.uniform) return ringUniformAngle(ctx, g, e, rotOf(), role);
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
        birthRotVaries = true;
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

  let dragC = 0;
  if (ps.useMotion) {
    if (gravityMode) {
      // moveSpeed is px per frame
      const speed = g.range(ps.moveSpeedMin * m * FPS, ps.moveSpeedMax * m * FPS);
      if (speed !== 0) g.add('output.initVelocity', { vel: g.scale(dir(), speed) });
    } else {
      // Particle.init: Rnd.integer(dMin, dMax) * 0.8 * scaleMod, then * 0.8 again
      const distance = g.mul(g.range(ps.distanceMin, ps.distanceMax), 0.64 * m);
      const fit = fitDrag(ps.distanceEase);
      dragC = fit.c;
      if (fit.error > 0.002) {
        report.add(
          'approximate',
          'particle.distanceEase',
          src,
          `Distance tween "${ps.distanceEase}" becomes velocity + drag (c = ${round(fit.c)}); the particle still travels the full distance, off the eased path by at most ${pct(fit.error)} of it.`,
          fit.error,
        );
      }
      // v0 = D·c / (life·(1 − e^−c)); c = 0 is the linear D / life
      const k = dragC === 0 ? 1 : dragC / (1 - Math.exp(-dragC));
      const speed = g.div(g.mul(distance, k), life);
      if (speed !== 0) g.add('output.initVelocity', { vel: g.scale(dir(), speed) });
    }
  }

  // ---- update ---------------------------------------------------------------
  if (gravityMode) {
    if (e.gravity !== 0) g.add('output.addForce', { force: g.op('field.gravity', { g: [0, e.gravity * FPS * FPS] }, undefined, 'force') });
    if (e.useFloor && e.floorY > 0) {
      if (ps.stopOnBounce) {
        g.add('output.killIfOutOfRect', { min: [-1e6, -1e6], max: [1e6, e.floorY] });
        report.add('approximate', 'particle.stopOnBounce', src, 'stopOnBounce kills particles that cross floorY, one frame later than RevoltFX.');
      } else {
        g.add('output.collidePlane', {
          point: [0, e.floorY],
          normal: [0, -1],
          restitution: g.range(ps.bounceFacMin * m, ps.bounceFacMax * m),
          friction: g.range(ps.frictionMin * m, ps.frictionMax * m),
        });
      }
      if (ps.useSpawns && ps.spawn.onBounce.length > 0) {
        report.add('unsupported', 'spawn.onBounce', src, 'Spawning on a floor bounce has no Pylinka event; those spawns were dropped.');
      }
    }
  } else if (ps.useMotion && dragC !== 0) {
    g.add('output.drag', { drag: g.div(dragC, g.op('input.life')) });
  }

  if (useAlign) {
    report.add('unsupported', 'particle.align', src, 'align (rotate to the velocity heading) needs atan2; sprites keep their launch rotation.');
  }

  const spinning = ps.useRotation && !(ps.rotationSpeedMin === 0 && ps.rotationSpeedMax === 0);
  if (spinning && !useAlign) {
    // rotationSpeed is radians per frame
    let rate = g.range(ps.rotationSpeedMin * m * FPS, ps.rotationSpeedMax * m * FPS);
    if (ps.randomRotationDirection) {
      // sign = sin(x) / |sin(x)|, x uniform → ±1 with even odds
      const s = g.sin(g.range(0, TAU));
      rate = g.mul(rate, g.div(s, g.abs(s)));
    }
    let base: F;
    if (randomStart) {
      base = g.range(0, TAU);
    } else if (birthRotVaries) {
      base = g.range(0, TAU);
      report.add('approximate', 'particle.rotation', src, 'Spin starts from each particle\'s spawn direction in RevoltFX; the update pass cannot read that angle, so spin starts from a random one.');
    } else {
      base = 'param' in rotation ? g.knob(rotation.param) : rotation.value;
      if (e.autoRotation !== 0) {
        report.add('approximate', 'particle.rotation', src, 'Spinning particles follow the live emitter rotation instead of the one they were born with (autoRotation).');
      }
    }
    const spin = g.op('gen.spin', { rate }, { unit: 'radians' });
    g.add('output.writeRotation', { rot: g.add2(base, spin) }, { unit: 'radians' });
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
  let scale: F = 1;
  if (ps.useScale) {
    let s0: F;
    let s1: F;
    let easeName = ps.scaleEase;
    if (ps.uniformScale) {
      s0 = g.range(ps.scaleStartMin * m, ps.scaleStartMax * m);
      s1 = g.range(ps.scaleEndMin, ps.scaleEndMax);
    } else {
      // writeScale is a scalar: use the mean of the X and Y tweens
      s0 = g.mul(g.add2(g.range(ps.scaleXStartMin * m, ps.scaleXStartMax * m), g.range(ps.scaleYStartMin * m, ps.scaleYStartMax * m)), 0.5);
      s1 = g.mul(g.add2(g.range(ps.scaleXEndMin, ps.scaleXEndMax), g.range(ps.scaleYEndMin, ps.scaleYEndMax)), 0.5);
      easeName = ps.scaleXEase;
      const same =
        ps.scaleXStartMin === ps.scaleYStartMin &&
        ps.scaleXStartMax === ps.scaleYStartMax &&
        ps.scaleXEndMin === ps.scaleYEndMin &&
        ps.scaleXEndMax === ps.scaleYEndMax &&
        ps.scaleXEase === ps.scaleYEase;
      if (!same) {
        report.add('unsupported', 'particle.nonUniformScale', src, 'Separate X/Y scale needs a vec2 scale output; the conversion scales both axes by the mean of the X and Y tweens.');
      }
    }
    // Particle.init: end = start + (end − start) · scaleMod
    if (m !== 1) s1 = g.mix(s0, s1, m);
    if (ps.scaleIn) {
      const ramp = heldRamp(easeName, ps.scaleInDurationFac);
      const win = fadeWindow(ps.scaleInEase, ps.scaleInDurationFac);
      noteEase(ctx, src, 'scaleEase (with scaleIn)', easeName, ramp);
      noteEase(ctx, src, 'scaleInEase', ps.scaleInEase, win);
      const t = () => g.op('gen.numberOverLife', { from: 0, to: 1 }, { ease: ramp.key });
      const w = g.op('gen.numberOverLife', { from: 0, to: 1 }, { ease: win.key });
      scale = g.mul(g.mix(s0, s1, t), w);
    } else if (typeof s0 === 'number' && typeof s1 === 'number' && s0 === s1) {
      scale = s0;
    } else {
      const ease = mapEase(easeName);
      noteEase(ctx, src, 'scaleEase', easeName, ease);
      scale = g.op('gen.numberOverLife', { from: s0, to: s1 }, { ease: ease.key });
    }
  }
  g.add('output.writeScale', { scale: g.mul(scale, S) });

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
  if (ps.useChilds && ps.childs.length > 0) {
    report.add('unsupported', 'particle.childs', src, `Per-particle child emitters (${ps.childs.length}, e.g. trails) need continuous emission from a live particle; they were dropped.`);
  }

  // ---- sub-emitter link -----------------------------------------------------
  if (role.sub !== undefined) {
    const max = BURST_MAX_OPTIONS.find((o) => o >= role.sub!.countMax) ?? 64;
    if (role.sub.countMax > 64) {
      report.add('approximate', 'spawn.count', src, `Spawns up to ${role.sub.countMax} particles per parent event; Pylinka caps a burst at 64.`);
    }
    // round(mix(a − ½, b + ½, r)) is uniform over the integers a..b
    g.add(
      'output.deathBurst',
      { countMin: role.sub.countMin - 0.499, countMax: Math.min(role.sub.countMax, 64) + 0.499, inheritVelocity: 0 },
      { max: String(max), on: role.sub.on },
    );
  }

  let capacity = estimateCapacity(ctx, e, m);
  const parent = role.sub !== undefined ? ctx.systems.find((s) => s.name === role.sub!.parent) : undefined;
  if (role.sub !== undefined) {
    // the engines size a child pool as parent capacity × burst max
    const max = BURST_MAX_OPTIONS.find((o) => o >= role.sub!.countMax) ?? 64;
    capacity = Math.max(1, (parent?.capacity ?? 64) * max);
  }
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

  // ---- particle spawns → child systems (after this system is placed) ---------
  if (ps.useSpawns) {
    queueMicroSpawns(ctx, e, sysName, m, depth);
  }
  return system;
}

/** Ring core with `uniform`: angles stepped by the index inside one spawn. */
function ringUniformAngle(ctx: Ctx, g: GraphBuilder, e: RfxEmitter, rot: F, role: EmitterRole): F {
  const core = e.core.params;
  const lo = e.spawnCountMin;
  const hi = e.spawnCountMax;
  const fixed = hi - lo <= 1; // Rnd.integer(lo, hi) has an exclusive max
  const n = role.sub !== undefined ? Math.max(1, Math.ceil(lo * ctx.opts.particleFac)) : Math.max(1, Math.ceil((fixed ? lo : (lo + hi - 1) / 2) * ctx.opts.particleFac));
  if (role.sub !== undefined) {
    ctx.report.add('approximate', 'core.ring.uniform', e.name, 'A uniform ring inside a sub-emitter burst gets no per-burst index in Pylinka; angles are random instead.');
    return g.add2(rot, g.range(-core.angle / 2, core.angle / 2));
  }
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
  if (ps.spawn.onHalfway.length > 0) {
    ctx.report.add('unsupported', 'spawn.onHalfway', src, 'onHalfway spawns (RevoltFX fires them at age ≥ 0.5 s) have no Pylinka event; they were dropped.');
  }
  const lists: [RfxSpawnDef[], 'death' | 'birth'][] = [
    [ps.spawn.onComplete, 'death'],
    [ps.spawn.onStart, 'birth'],
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

/** One spawned emitter (plus the `childs` it starts) as burst children of `parentSys`. */
function burstEmitter(ctx: Ctx, e: RfxEmitter, parentSys: string, on: 'death' | 'birth', m: number, depth: number, guard = 0): void {
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
  emitterSystem(ctx, e, sysName, { scaleMod: m, rotation: { value: e.rotation }, sub: { parent: parentSys, on, countMin, countMax } }, depth);
  for (const def of e.childs) {
    if (guard > 8) break;
    const child = refEmitter(ctx, def, e.name, 'emitter.childs');
    if (child !== undefined) burstEmitter(ctx, child, parentSys, on, m * (def.scale || 1), depth, guard + 1);
  }
}

/** A sequence spawned on a particle event: its emitters and sprites burst at once. */
function burstSequence(ctx: Ctx, seq: RfxSequence, parentSys: string, on: 'death' | 'birth', m: number, depth: number, src: string): void {
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
      ctx.report.add('unsupported', 'spawn.sequence.sprite', src, `Sprite "${String(fx.componentId)}" in sequence "${seq.name}" spawned on a particle ${on} was dropped.`);
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

/** The plain-project stand-in for the spawn clock (drive: 'project'). */
function projectEmitter(ctx: Ctx, e: RfxEmitter, clock: SpawnClock): EmitterSettings {
  const count = Math.max(1, Math.round(meanCount(clock) * clock.particleFac));
  if (!e.infinite && e.duration <= 0) return { mode: 'once', rate: 0, burst: { count, interval: 1 } };
  // ParticleEmitter.update spawns at most once per frame
  const interval = Math.max(mean(clock.frequencyMin, clock.frequencyMax), 1 / FPS);
  if (clock.countMax - clock.countMin > 1 || clock.frequencyMin !== clock.frequencyMax) {
    ctx.report.add('approximate', 'emitter.spawnClock', e.name, `Random spawn count/interval becomes ${count} every ${round(interval)} s without the player.`);
  }
  if (!e.infinite) {
    ctx.report.add('approximate', 'emitter.duration', e.name, `Emits for ${round(e.duration)} s in RevoltFX; without the player the project emits forever.`);
  }
  return { mode: 'burst', rate: 0, burst: { count, interval } };
}

function meanCount(c: SpawnClock): number {
  // Rnd.integer(min, max): floor(r·(max − min) + min), max exclusive
  return c.countMax > c.countMin ? (c.countMin + c.countMax - 1) / 2 : c.countMin;
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
  const name = BLEND[mode] ?? 'normal';
  if (name === 'multiply') {
    ctx.report.add('unsupported', 'particle.blendMode', src, 'Multiply blending is not available; drawn with normal blending.');
    return 'normal';
  }
  return name;
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

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}
