/**
 * @pylinka/core/webgl — a usable WebGL2 particle runtime.
 *
 * Drop a pylinka project onto a canvas and drive it. The simulation runs on the
 * GPU via transform feedback (REQUIREMENTS §13.12); no WebGPU required. This is
 * the pragmatic v1 runtime — it interprets the common node patterns (spawn
 * shape, random velocity/life, gravity, wind, drag, colour/scale over life) into
 * a fixed GPU model. Effects with unrecognised nodes still run (those nodes are
 * ignored).
 *
 * @example
 * ```ts
 * import { createParticles } from '@pylinka/core/webgl';
 * const fx = createParticles(canvas, project);
 * fx.setEmitter(x, y);
 * app.ticker?.add?.(() => fx.update(1 / 60)); // or your own rAF loop
 * fx.setKnob('windPower', 40);
 * ```
 */
import type { PylinkaProject } from '@pylinka/graph';
import { SpawnScheduler } from '../scheduler.js';
import { clampDt } from '../time.js';
import { featuresOf, WebGL2Engine, type AtlasConfig, type MaskConfig } from './engine.js';
import { extractParams, type EngineParams, type KnobValues } from './params.js';

/**
 * Rasterize an emission mask into a point table: one emitter-relative offset
 * per opaque texel. The mask is downsampled so the table stays small (≤ ~36k
 * points); an all-transparent mask yields undefined (falls back to the shape).
 */
function buildMaskTable(o: EmissionMaskOptions | undefined): MaskConfig | undefined {
  if (!o) return undefined;
  const im = o.image as { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number };
  const iw = im.naturalWidth ?? im.width ?? 0;
  const ih = im.naturalHeight ?? im.height ?? 0;
  if (!iw || !ih) return undefined;
  const worldW = o.width;
  const worldH = o.height ?? (worldW * ih) / iw;
  const [ox, oy] = o.offset ?? [0, 0];

  const MAX_SIDE = 192;
  const k = Math.min(1, MAX_SIDE / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * k));
  const h = Math.max(1, Math.round(ih * k));
  const cnv =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  cnv.width = w;
  cnv.height = h;
  const ctx = cnv.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return undefined;
  ctx.drawImage(o.image as CanvasImageSource, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  // resolve the mask channel: 'auto' uses alpha when the image has any
  // transparency, else luminance (so plain black/white textures just work)
  let channel = o.channel ?? 'auto';
  if (channel === 'auto') {
    channel = 'luminance';
    for (let i = 3; i < px.length; i += 4)
      if (px[i]! < 250) {
        channel = 'alpha';
        break;
      }
  }
  const weighted = o.weighted ?? true;

  const pts: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v =
        channel === 'alpha'
          ? px[i + 3]!
          : // luminance gated by alpha so transparent corners of B/W art stay empty
            ((0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!) * px[i + 3]!) / 255;
      // weighted: gray = density (1..4 table entries); stencil: hard 50% cut
      const n = weighted ? (v < 24 ? 0 : Math.max(1, Math.round((v / 255) * 4))) : v > 127 ? 1 : 0;
      for (let k = 0; k < n; k++) {
        pts.push(((x + 0.5) / w - 0.5) * worldW + ox, ((y + 0.5) / h - 0.5) * worldH + oy);
      }
    }
  }
  const count = pts.length / 2;
  return count > 0 ? { points: new Float32Array(pts), count } : undefined;
}

function resolveAtlas(o: AtlasOptions | undefined): AtlasConfig | undefined {
  if (!o) return undefined;
  const im = o.image as { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number };
  const width = o.width ?? im.naturalWidth ?? im.width ?? 0;
  const height = o.height ?? im.naturalHeight ?? im.height ?? 0;
  const pick = o.pick === 'per-spawn' ? 1 : 0;
  return {
    image: o.image,
    width,
    height,
    cols: o.cols,
    rows: o.rows,
    frameW: o.frameW,
    frameH: o.frameH,
    pad: o.pad ?? 0,
    fps: o.fps ?? 12,
    play: o.play === 'once' ? 0 : 1,
    pick,
    row: o.row ?? (pick === 1 ? Math.floor(Math.random() * o.rows) : 0),
  };
}

export interface ParticlesHandle {
  /** Step the simulation and render one frame. Call once per rAF tick. */
  update(dtSeconds: number): void;
  /** Move where new particles are born (world/canvas pixels). */
  setEmitter(x: number, y: number): void;
  /** Emit an extra burst next frame. */
  spawnBurst(count: number): void;
  /**
   * Set a named knob live (e.g. 'windPower'). Pass a second component for a
   * vec2 knob — that's how a cursor or a moving object drives `field.obstacle`
   * / `output.collide*` positions: `fx.setKnob('cursor', x, y)`.
   */
  setKnob(name: string, x: number, y?: number): void;
  /**
   * Re-read an edited project into the running effect with no restart (the
   * uniform-driven live-edit path for editors). Returns false if a change needs
   * a full re-create (only pool capacity does) — recreate via createParticles.
   */
  apply(project: PylinkaProject): boolean;
  /** Whether the canvas should be cleared each frame (default true). */
  autoClear: boolean;
  /** Alive particle count. Synchronous GPU readback — for debug/stats, not per-frame. */
  aliveCount(): number;
  /**
   * True while the WebGL context is gone (backgrounded tab, GPU reset, driver
   * hiccup). `update()` is a no-op meanwhile and resumes on its own once the
   * browser restores the context; particle state does not survive, so the pool
   * refills from the emitter.
   */
  readonly contextLost: boolean;
  destroy(): void;
}

export interface ParticlesOptions {
  /** Which system to run (defaults to the first enabled system). */
  systemName?: string;
  /** dt clamp in seconds (default 0.05). */
  maxDt?: number;
  /**
   * View zoom-out factor (default 1). Renders a larger world region into the
   * canvas, so effects authored for a full-size game view fit inside small
   * thumbnails. Emitter/mouse coordinates stay in canvas pixels.
   */
  zoom?: number;
  /** Particle sprite size multiplier (default 1) — keeps thumbnails legible. */
  sizeScale?: number;
  /**
   * Render particles as an animated atlas sequence (e.g. a spinning coin). The
   * atlas is a uniform grid: each ROW is a sequence, each COLUMN a frame. A
   * random row is picked per particle (or fixed), the column advances with age.
   */
  atlas?: AtlasOptions;
  /**
   * Make this a SUB-EMITTER of another running effect: its particles spawn on
   * the death of the parent's particles (at the death position). The parent
   * handle must share the same canvas/context and be updated before this one.
   * The child mirrors the parent 1:1 and inherits the parent's pool capacity.
   */
  subParent?: ParticlesHandle;
  /**
   * Emit only inside a painted/image area: opaque texels of `image` become
   * spawn positions (replaces the graph's analytic spawn shape). The mask is
   * centred on the emitter and moves with it. Ignored for sub-emitters.
   */
  emissionMask?: EmissionMaskOptions;
  /** Called when the GL context is lost. Recovery is automatic; this is for UI. */
  onContextLost?: () => void;
  /** Called after the context came back and the effect was rebuilt. */
  onContextRestored?: () => void;
}

export interface EmissionMaskOptions {
  /** mask image — see `channel` for which pixels emit */
  image: TexImageSource;
  /** world width the mask maps to (px); height defaults to the aspect ratio */
  width: number;
  height?: number;
  /** offset of the mask centre from the emitter (px, default [0, 0]) */
  offset?: [number, number];
  /**
   * Which channel is the mask. 'alpha': transparent = empty, opaque = emit.
   * 'luminance': black = empty, white = emit (for opaque B/W textures).
   * 'auto' (default): alpha when the image has transparency, else luminance.
   */
  channel?: 'alpha' | 'luminance' | 'auto';
  /**
   * Treat gray/semi-transparent texels as spawn DENSITY (default true):
   * white/opaque areas emit up to 4× more often than faint ones. false = hard
   * stencil at the 50% threshold.
   */
  weighted?: boolean;
}

export interface AtlasOptions {
  /** A loaded image / bitmap / canvas. */
  image: TexImageSource;
  cols: number;
  rows: number;
  frameW: number;
  frameH: number;
  pad?: number;
  /** atlas pixel size (derived from the image if omitted). */
  width?: number;
  height?: number;
  /** frames/second when looping (default 12). */
  fps?: number;
  /** 'loop' (default) spins forever; 'once' plays across the particle's life. */
  play?: 'loop' | 'once';
  /** 'per-particle' (default) random sequence per particle; 'per-spawn' fixed. */
  pick?: 'per-particle' | 'per-spawn';
  /** which row when pick === 'per-spawn' (default random). */
  row?: number;
}

export { extractParams, parseColor, type EngineParams, type KnobValues } from './params.js';
export { WebGL2Engine } from './engine.js';

/** Handle → engine, so a sub-emitter can reach its parent's GPU buffers. */
const engineOf = new WeakMap<ParticlesHandle, WebGL2Engine>();

export function createParticles(
  target: HTMLCanvasElement | WebGL2RenderingContext,
  project: PylinkaProject,
  opts: ParticlesOptions = {},
): ParticlesHandle {
  const gl =
    target instanceof WebGL2RenderingContext
      ? target
      : target.getContext('webgl2', { premultipliedAlpha: true, alpha: true });
  if (!gl) throw new Error('WebGL2 is not available on this target.');

  const system =
    project.systems.find((s) => s.name === opts.systemName) ??
    project.systems.find((s) => s.enabled) ??
    project.systems[0];
  if (!system) throw new Error('Project has no systems.');

  // knob values seeded from ParamDef defaults (by name)
  const knobValues: KnobValues = {};
  for (const p of project.params) {
    if (p.default.t === 'f32') knobValues[p.name] = p.default.v;
    else if (p.default.t === 'vec2') knobValues[p.name] = [p.default.v[0], p.default.v[1]];
  }

  const params: EngineParams = extractParams(system, project.params, knobValues);
  const parentEngine = opts.subParent ? engineOf.get(opts.subParent) : undefined;
  if (opts.subParent && !parentEngine) throw new Error('subParent handle is not a live pylinka effect.');
  const engine = new WebGL2Engine(
    gl, params, opts.sizeScale ?? 1, resolveAtlas(opts.atlas),
    parentEngine ? { parent: parentEngine } : undefined,
    buildMaskTable(opts.emissionMask),
    {
      ...(opts.onContextLost ? { onContextLost: opts.onContextLost } : {}),
      onContextRestored: () => {
        // the pool came back empty, so the spawn schedule restarts with it
        scheduler = new SpawnScheduler(curSystem.emitter, params.capacity);
        opts.onContextRestored?.();
      },
    },
  );
  let scheduler = new SpawnScheduler(system.emitter, params.capacity);
  // last-applied graph, so setKnob can re-interpret every knob-bound port live
  let curSystem = system;
  let curParams = project.params;
  const systemName = system.name;
  const maxDt = opts.maxDt ?? 0.05;

  const canvas = gl.canvas as HTMLCanvasElement;
  const zoom = opts.zoom ?? 1;
  let ex = (canvas.width * zoom) / 2;
  let ey = (canvas.height * zoom) / 2;
  let px = ex;
  let py = ey;
  const wind: [number, number] = [0, 0];
  const recomputeWind = () => {
    wind[0] = Math.cos(params.windDir) * params.windPower;
    wind[1] = Math.sin(params.windDir) * params.windPower;
  };
  recomputeWind();

  const handle: ParticlesHandle = {
    autoClear: true,
    update(dtSeconds: number) {
      const dt = clampDt(dtSeconds, maxDt);
      const dist = Math.hypot(ex - px, ey - py);
      const spawnCount = scheduler.tick(dt, dist);
      engine.step(dt, spawnCount, [ex, ey], wind, params);

      gl.viewport(0, 0, canvas.width, canvas.height);
      if (this.autoClear) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      engine.render(canvas.width * zoom, canvas.height * zoom, params);

      px = ex;
      py = ey;
    },
    setEmitter(x: number, y: number) {
      ex = x * zoom;
      ey = y * zoom;
    },
    spawnBurst(count: number) {
      scheduler.spawnBurst(count);
    },
    setKnob(name: string, x: number, y?: number) {
      knobValues[name] = y === undefined ? x : [x, y];
      Object.assign(params, extractParams(curSystem, curParams, knobValues));
      recomputeWind();
    },
    apply(next: PylinkaProject): boolean {
      const sys =
        next.systems.find((s) => s.name === systemName) ??
        next.systems.find((s) => s.enabled) ??
        next.systems[0];
      if (!sys) return false;
      for (const pd of next.params) {
        if (pd.name in knobValues) continue;
        if (pd.default.t === 'f32') knobValues[pd.name] = pd.default.v;
        else if (pd.default.t === 'vec2') knobValues[pd.name] = [pd.default.v[0], pd.default.v[1]];
      }
      const np = extractParams(sys, next.params, knobValues);
      if (np.capacity !== params.capacity) return false; // needs a full re-create
      // adding/removing the first obstacle or collider changes which shader
      // blocks are linked, so the program has to be rebuilt
      const was = featuresOf(params);
      const now = featuresOf(np);
      if (was.obstacles !== now.obstacles || was.colliders !== now.colliders) return false;
      curSystem = sys;
      curParams = next.params;
      Object.assign(params, np);
      scheduler = new SpawnScheduler(sys.emitter, params.capacity);
      recomputeWind();
      return true;
    },
    aliveCount() {
      return engine.aliveCount();
    },
    get contextLost() {
      return engine.contextLost;
    },
    destroy() {
      engineOf.delete(handle);
      engine.destroy();
    },
  };
  engineOf.set(handle, engine);
  return handle;
}
