/**
 * @pylinka/revoltfx/pixi — play a RevoltFX effect through Pylinka in pixi v8.
 *
 * ```ts
 * import { registerPylinka } from '@pylinka/core/pixi';
 * import { createRevoltFxEffect } from '@pylinka/revoltfx/pixi';
 *
 * registerPylinka();
 * await app.init({ ... });
 * const torch = await createRevoltFxEffect(bundle, 'side-torch', {
 *   renderer: app.renderer,
 *   sheet: spritesheetJson,          // the TexturePacker JSON RevoltFX loads
 *   image: 'revoltfx-spritesheet.png',
 *   onTrigger: (v) => v === 'shake' && shakeCamera(),
 * });
 * app.stage.addChild(torch.view);
 * torch.x = 400; torch.y = 300;
 * app.ticker.add((t) => torch.update(t.deltaMS / 1000));
 * ```
 *
 * The converted project carries RevoltFX's timing itself (start delays,
 * durations, random counts and intervals, auto-rotation), so the player only
 * adds what a project cannot: sequence triggers, the effect's position and
 * rotation, and knowing when it is done. With `drive: 'runtime'` it instead
 * runs RevoltFX's spawn clock on the CPU (SpawnClockRunner) and calls
 * `spawnBurst`. Sub-emitters run on the GPU as linked Pylinka systems. One
 * effect object is one playing instance; call `restart()` to play it again.
 */
import { Container } from 'pixi.js';
import { createPylinka, loadImage, type CreateOptions, type PylinkaRuntime, type TextureInput } from '@pylinka/core/pixi';
import { SpawnClockRunner } from './clock.js';
import { convertEffect, type ConvertOptions, type ConvertedEffect, type SystemTexture } from './convert.js';
import { sourceSize } from './frames.js';
import type { FidelityIssue } from './report.js';
import type { RfxBundle, SheetData } from './types.js';
import type { PylinkaProject } from '@pylinka/graph';

export interface RevoltFxEffectOptions
  extends Omit<CreateOptions, 'texture' | 'textures' | 'subEmitters'>,
    Pick<ConvertOptions, 'particleFac' | 'maxDepth' | 'kind' | 'drive'> {
  /** The spritesheet JSON (TexturePacker hash) the bundle's textures live in. */
  sheet: SheetData;
  /** The spritesheet image: a URL or an already-loaded image/canvas/bitmap. */
  image: string | CanvasImageSource;
  /** Containers by RevoltFX `containerId`; systems with an unknown id go into `view`. */
  containers?: Record<string, Container>;
  /** Called when a sequence reaches a trigger element. */
  onTrigger?: (value: string) => void;
  /** Start playing at once (default true), like `getParticleEmitter(...).init(container)`. */
  autoStart?: boolean;
}

export interface RevoltFxEffect {
  /** Holds every system's view; add it to the stage. */
  readonly view: Container;
  /** The conversion behind this effect: project, textures, timeline, issues. */
  readonly converted: ConvertedEffect;
  /** Everything that did not carry over exactly. */
  readonly issues: FidelityIssue[];
  readonly runtime: PylinkaRuntime;
  /** Emitter position, in `view`'s parent space. */
  x: number;
  y: number;
  /** Radians, added to every emitter's own rotation. */
  rotation: number;
  /** All emitters have stopped spawning. */
  readonly exhausted: boolean;
  /** Exhausted, and long enough ago that every particle has died. */
  readonly completed: boolean;
  update(dtSeconds: number): void;
  /** Stop spawning; live particles finish (`stop(true)`). */
  stop(): void;
  /** Play again from the start. Live particles are cleared. */
  restart(): void;
  destroy(): void;
}

/** Load the image, crop and pad each texture, and build the effect. */
export async function createRevoltFxEffect(
  bundle: RfxBundle,
  name: string,
  opts: RevoltFxEffectOptions,
): Promise<RevoltFxEffect> {
  const converted = convertEffect(bundle, name, {
    sheet: opts.sheet,
    drive: opts.drive ?? 'project',
    ...(opts.particleFac !== undefined ? { particleFac: opts.particleFac } : {}),
    ...(opts.maxDepth !== undefined ? { maxDepth: opts.maxDepth } : {}),
    ...(opts.kind !== undefined ? { kind: opts.kind } : {}),
  });
  const image = typeof opts.image === 'string' ? await loadImage(opts.image) : opts.image;
  const textures: Record<string, TextureInput> = {};
  for (const [system, tex] of Object.entries(converted.textures)) {
    const baked = bakeTexture(image, opts.sheet, tex);
    if (baked !== undefined) textures[system] = baked;
  }
  // everything that is not ours goes to createPylinka
  const create: Record<string, unknown> = { ...opts };
  for (const k of ['sheet', 'image', 'containers', 'onTrigger', 'autoStart', 'particleFac', 'maxDepth', 'kind', 'drive']) delete create[k];
  const runtime = await createPylinka(converted.project, { ...(create as unknown as CreateOptions), textures });
  return new Effect(converted, runtime, opts.containers ?? {}, opts.onTrigger, opts.autoStart !== false);
}

/**
 * Crop one texture out of the sheet into the square canvas the converter's
 * scale assumes (frames.ts): untrimmed size, anchor at the centre, rotated
 * TexturePacker frames turned back upright. A movie clip becomes a strip of
 * such squares, one column per frame.
 */
export function bakeTexture(image: CanvasImageSource, sheet: SheetData, tex: SystemTexture): TextureInput | undefined {
  const frames = tex.frames.filter((f) => sheet.frames[f] !== undefined);
  if (frames.length === 0) return undefined;
  const side = tex.box.side;
  const canvas = makeCanvas(side * frames.length, side);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (ctx === null) return undefined;
  frames.forEach((name, i) => {
    const f = sheet.frames[name]!;
    const src = sourceSize(f);
    // a clip's frames share one box: centre each frame's source rect in it
    const ox = i * side + tex.box.offsetX + (tex.box.width - src.w) / 2;
    const oy = tex.box.offsetY + (tex.box.height - src.h) / 2;
    const dx = ox + (f.spriteSourceSize?.x ?? 0);
    const dy = oy + (f.spriteSourceSize?.y ?? 0);
    const { x, y, w, h } = f.frame;
    if (f.rotated) {
      // TexturePacker stores the frame turned 90° clockwise, h wide and w tall
      ctx.save();
      ctx.translate(dx, dy + h);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(image, x, y, h, w, 0, 0, h, w);
      ctx.restore();
    } else {
      ctx.drawImage(image, x, y, w, h, dx, dy, w, h);
    }
  });
  if (tex.kind === 'movieclip') {
    return {
      image: canvas,
      cols: frames.length,
      rows: 1,
      frameW: side,
      frameH: side,
      fps: tex.fps ?? 60,
      play: tex.play ?? 'hold',
      pick: 'per-spawn',
      row: 0,
    };
  }
  return { image: canvas };
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

interface TrackState {
  runner: SpawnClockRunner;
  started: boolean;
  /** accumulated autoRotation, radians */
  spin: number;
}

class Effect implements RevoltFxEffect {
  readonly view = new Container();
  readonly issues: FidelityIssue[];
  x = 0;
  y = 0;
  rotation = 0;
  private elapsed = 0;
  private playing = false;
  private exhaustedAt: number | undefined;
  private readonly tracks: TrackState[];
  private readonly fired: boolean[];
  private readonly rotations: number[];
  /** knob name per track (undefined: no rotation knob) */
  private readonly knobs: (string | undefined)[];
  /** true: the CPU clock spawns (drive 'runtime'); false: the project's emitters do */
  private readonly driven: boolean;
  /** the project with every emitter silenced, for stop() in project mode */
  private readonly silenced: PylinkaProject;
  private stopped = false;

  constructor(
    readonly converted: ConvertedEffect,
    readonly runtime: PylinkaRuntime,
    containers: Record<string, Container>,
    private readonly onTrigger: ((value: string) => void) | undefined,
    autoStart: boolean,
  ) {
    this.issues = converted.issues;
    const { emits, triggers } = converted.timeline;
    // a runtime-driven conversion writes rate-0 flow emitters for its tracks
    this.driven = emits.length > 0 && emits.every((t) => {
      const sys = converted.project.systems.find((x) => x.name === t.system);
      return sys !== undefined && sys.emitter.mode === 'flow' && sys.emitter.rate === 0;
    });
    this.silenced = {
      ...converted.project,
      systems: converted.project.systems.map((x) => ({ ...x, emitter: { mode: 'flow', rate: 0 } })),
    };
    this.tracks = emits.map((t) => ({ runner: new SpawnClockRunner(t.clock), started: false, spin: 0 }));
    this.fired = triggers.map(() => false);
    this.rotations = emits.map(() => 0);
    const paramName = new Map(converted.project.params.map((p) => [p.id, p.name]));
    this.knobs = emits.map((t) => (t.rotationParam !== undefined ? paramName.get(t.rotationParam) : undefined));
    const containerOf = new Map(emits.filter((t) => t.containerId).map((t) => [t.system, t.containerId!]));
    for (const system of converted.project.systems) {
      const handle = runtime.systems[system.name];
      if (handle === undefined) continue;
      const target = containers[containerOf.get(system.name) ?? ''] ?? this.view;
      target.addChild(handle.view);
    }
    if (autoStart) this.playing = true;
  }

  get exhausted(): boolean {
    if (!this.fired.every(Boolean)) return false;
    if (this.stopped) return true;
    if (this.driven) return this.tracks.every((t) => t.started && t.runner.exhausted);
    // project mode: each track ends at its start (one-shot) or start + duration
    return this.converted.timeline.emits.every((t) => {
      const c = t.clock;
      if (c.infinite) return false;
      return this.elapsed >= t.at + (c.duration > 0 ? c.duration : 0) + 1e-6;
    });
  }

  get completed(): boolean {
    return this.exhaustedAt !== undefined && this.elapsed - this.exhaustedAt > this.converted.timeline.tail;
  }

  update(dt: number): void {
    if (this.playing) this.tick(dt);
    for (const handle of Object.values(this.runtime.systems)) handle.setEmitterPosition(this.x, this.y);
    this.runtime.update(dt);
  }

  private tick(dt: number): void {
    this.elapsed += dt;
    const { emits, triggers } = this.converted.timeline;
    triggers.forEach((t, i) => {
      if (!this.fired[i] && this.elapsed >= t.at) {
        this.fired[i] = true;
        this.onTrigger?.(t.value);
      }
    });
    emits.forEach((track, i) => {
      const st = this.tracks[i]!;
      if (!st.started) {
        if (this.elapsed < track.at) return;
        st.started = true;
      }
      // an emitter child stops when the emitter that started it does
      if (track.parent !== undefined && this.tracks[track.parent]!.runner.exhausted) st.runner.stop();
      // project mode turns autoRotation in the graph (input.time); runtime mode turns the knob
      if (this.driven && !st.runner.exhausted) st.spin += track.autoRotation * dt;
      // ParticleEmitter.rotation: own + (parent's, when adopted) — the effect's own for a root
      const base =
        track.adoptRotationOf !== undefined ? this.rotations[track.adoptRotationOf]! : track.parent === undefined ? this.rotation : 0;
      const rot = track.rotation + base + st.spin;
      this.rotations[i] = rot;
      const knob = this.knobs[i];
      if (knob !== undefined) this.runtime.params.set(knob, rot);
      if (!this.driven) return;
      const n = st.runner.step(dt);
      if (n > 0) this.runtime.systems[track.system]?.spawnBurst(n);
    });
    if (this.exhaustedAt === undefined && this.exhausted) this.exhaustedAt = this.elapsed;
  }

  stop(): void {
    for (const t of this.tracks) {
      t.started = true;
      t.runner.stop();
    }
    this.fired.fill(true);
    if (!this.driven && !this.stopped) {
      for (const h of Object.values(this.runtime.systems)) h.apply(this.silenced);
    }
    this.stopped = true;
    this.exhaustedAt ??= this.elapsed;
  }

  restart(): void {
    this.elapsed = 0;
    this.exhaustedAt = undefined;
    for (const t of this.tracks) {
      t.runner.reset();
      t.started = false;
      t.spin = 0;
    }
    this.fired.fill(false);
    if (this.stopped && !this.driven) {
      for (const h of Object.values(this.runtime.systems)) h.apply(this.converted.project);
    }
    this.stopped = false;
    for (const h of Object.values(this.runtime.systems)) h.restart();
    this.playing = true;
  }

  destroy(): void {
    this.runtime.destroy();
    this.view.destroy({ children: true });
  }
}
