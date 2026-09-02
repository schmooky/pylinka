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
import { hashGraph, type PylinkaProject } from '@pylinka/graph';
import { SpawnScheduler } from '../scheduler.js';
import { clampDt } from '../time.js';
import { featuresOf, WebGL2Engine, type AtlasConfig, type MaskConfig } from './engine.js';
import { extractParams, type EngineParams, type KnobValues } from './params.js';
import { playCode, type AtlasPlay } from '../atlas.js';
import { pickSystem } from '../system.js';
import { systemsInBuildOrder } from '../project.js';

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
    play: playCode(o.play),
    pick,
    row: o.row ?? (pick === 1 ? Math.floor(Math.random() * o.rows) : 0),
  };
}

export interface ParticlesHandle {
  /** Step the simulation and render one frame. Call once per rAF tick. */
  update(dtSeconds: number): void;
  /**
   * Move where new particles are born (world/canvas pixels).
   *
   * `teleport` moves the emitter WITHOUT counting the distance travelled. That
   * distance is what `rateOverDistance` turns into spawns — the feature that
   * lays a trail behind a dragged emitter — so jumping the emitter somewhere
   * for one frame otherwise fires a spawn proportional to how far it jumped,
   * and another one when it jumps back. Teleport when the move is a cut rather
   * than a motion: placing a one-off burst, or repositioning between shots.
   */
  setEmitter(x: number, y: number, teleport?: boolean): void;
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
  /**
   * How much world the canvas shows, live.
   *
   * `1` maps one world unit to one canvas PIXEL, so on a 2x-density display an
   * effect authored at 100px covers 50 CSS px — pass `1 / devicePixelRatio` to
   * make world units device-independent. Values above 1 show more world in the
   * same canvas (zoom out), below 1 less (zoom in), and because it changes what
   * the renderer draws rather than how a finished image is stretched, zooming
   * this way stays sharp at any level. Emitter coordinates are still canvas
   * pixels; they are converted for you.
   */
  zoom: number;
  /**
   * Slide the view without moving the effect, in world units.
   *
   * Panning by transforming the canvas ELEMENT moves finished pixels: the
   * drawn area slides away from the viewport and leaves an empty margin, and
   * it cannot be combined with a rendered zoom. This shifts the window the
   * renderer draws through instead. `[0, 0]` is the default.
   */
  viewOffset: [number, number];
  /** Whether the canvas should be cleared each frame (default true). */
  autoClear: boolean;
  /**
   * What `autoClear` clears to, as straight (non-premultiplied) `[r,g,b,a]` in
   * 0..1. Defaults to fully transparent.
   *
   * This matters more than it looks. The canvas is premultiplied, so a light
   * blend mode can only add to pixels that are IN this framebuffer — over a
   * transparent clear there is nothing to add to, and the page behind the
   * canvas is out of reach. Clearing to the colour the effect will really play
   * on is what makes `add` and `screen` show what they will actually do.
   */
  clearColor: [number, number, number, number];
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
  /** see `AtlasPlay` — 'loop' (default), 'once' (stretched over life), 'hold'. */
  play?: AtlasPlay;
  /** 'per-particle' (default) random sequence per particle; 'per-spawn' fixed. */
  pick?: 'per-particle' | 'per-spawn';
  /** which row when pick === 'per-spawn' (default random). */
  row?: number;
}

export { extractParams, parseColor, type EngineParams, type KnobValues } from './params.js';
export { WebGL2Engine } from './engine.js';
export { INTERPRETED_KINDS, isInterpreted, unsupportedNodes } from './support.js';

/** Handle → engine, so a sub-emitter can reach its parent's GPU buffers. */
const engineOf = new WeakMap<ParticlesHandle, WebGL2Engine>();

/**
 * Run a project.
 *
 * With no `systemName`, this builds EVERY enabled system and wires the
 * sub-emitter links the project declares — the thing an artist already set up
 * when they chose what a system is born from. It used to build one system and
 * leave the links to the caller, which meant a project that worked in the
 * editor came back from a file as a set of unrelated effects unless the game
 * happened to know it had to sort the systems and hand each child its parent.
 * Nothing about that was discoverable, and it is not the caller's problem: the
 * document says how the systems relate.
 *
 * Name a system to get just that one, the way this always behaved.
 */
/**
 * One handle over several systems.
 *
 * Fan-out with two exceptions that matter. `spawnBurst` reaches only the roots:
 * a sub-emitter's particles come from its parent's, so bursting it directly
 * means nothing. And `autoClear` belongs to the first handle alone — every
 * other one has to composite onto what is already in the buffer, which is the
 * bookkeeping every caller was getting wrong when they wired this by hand.
 */
function combine(handles: ParticlesHandle[], children: Set<ParticlesHandle>): ParticlesHandle {
  const first = handles[0]!;
  const roots = handles.filter((h) => !children.has(h));
  return {
    update(dt) {
      // build order is step order: a child reads the parent's state from the
      // frame it is in, so the parent has to move first
      for (const h of handles) h.update(dt);
    },
    setEmitter(x, y, teleport) {
      for (const h of handles) h.setEmitter(x, y, teleport);
    },
    spawnBurst(count) {
      for (const h of roots) h.spawnBurst(count);
    },
    setKnob(name, x, y) {
      for (const h of handles) h.setKnob(name, x, y);
    },
    apply(next) {
      let ok = true;
      for (const h of handles) if (!h.apply(next)) ok = false;
      return ok;
    },
    get autoClear() {
      return first.autoClear;
    },
    set autoClear(v: boolean) {
      first.autoClear = v;
    },
    get clearColor() {
      return first.clearColor;
    },
    set clearColor(v: [number, number, number, number]) {
      first.clearColor = v;
    },
    get zoom() {
      return first.zoom;
    },
    set zoom(v: number) {
      for (const h of handles) h.zoom = v;
    },
    get viewOffset(): [number, number] {
      return first.viewOffset;
    },
    set viewOffset(v: [number, number]) {
      for (const h of handles) h.viewOffset = v;
    },
    aliveCount() {
      let n = 0;
      for (const h of handles) n += h.aliveCount();
      return n;
    },
    get contextLost() {
      return handles.some((h) => h.contextLost);
    },
    destroy() {
      for (const h of handles) h.destroy();
    },
  };
}

export function createParticles(
  target: HTMLCanvasElement | WebGL2RenderingContext,
  project: PylinkaProject,
  opts: ParticlesOptions = {},
): ParticlesHandle {
  if (opts.systemName === undefined && opts.subParent === undefined) {
    const { systems, links } = systemsInBuildOrder(project);
    if (systems.length > 1 || links.size > 0) {
      const byId = new Map<string, ParticlesHandle>();
      const built: ParticlesHandle[] = [];
      for (const sys of systems) {
        const parentId = links.get(sys.id);
        const parent = parentId !== undefined ? byId.get(parentId) : undefined;
        const h = createParticles(target, project, {
          ...opts,
          systemName: sys.name,
          ...(parent !== undefined ? { subParent: parent } : {}),
        });
        // one clear for the frame, done by the first: the rest composite on top
        h.autoClear = built.length === 0;
        byId.set(sys.id, h);
        built.push(h);
      }
      return combine(built, new Set([...links.keys()].map((id) => byId.get(id)!)));
    }
  }
  const gl =
    target instanceof WebGL2RenderingContext
      ? target
      : target.getContext('webgl2', { premultipliedAlpha: true, alpha: true });
  if (!gl) throw new Error('WebGL2 is not available on this target.');

  const system = pickSystem(project, opts.systemName);
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
  const systemId = system.id;
  const maxDt = opts.maxDt ?? 0.05;

  const canvas = gl.canvas as HTMLCanvasElement;
  let zoom = opts.zoom ?? 1;
  // what the graph looked like last time: a change here means a structural
  // edit, not a value one
  let graphHash = hashGraph(system.graph);
  let viewX = 0;
  let viewY = 0;
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
    clearColor: [0, 0, 0, 0],
    update(dtSeconds: number) {
      const dt = clampDt(dtSeconds, maxDt);
      const dist = Math.hypot(ex - px, ey - py);
      const spawnCount = scheduler.tick(dt, dist);
      engine.step(dt, spawnCount, [ex, ey], wind, params);

      gl.viewport(0, 0, canvas.width, canvas.height);
      if (this.autoClear) {
        const [cr, cg, cb, ca] = this.clearColor;
        // premultiplied target: scale by alpha, or an opaque-looking clear
        // colour arrives washed out
        gl.clearColor(cr * ca, cg * ca, cb * ca, ca);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      engine.render(canvas.width * zoom, canvas.height * zoom, params, viewX, viewY);

      px = ex;
      py = ey;
    },
    setEmitter(x: number, y: number, teleport = false) {
      // canvas pixels -> world, through the SAME mapping the renderer draws
      // with: without the view offset, panning would drag the emitter along
      // with the window instead of moving the window over it
      ex = x * zoom + viewX;
      ey = y * zoom + viewY;
      if (teleport) {
        px = ex;
        py = ey;
      }
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
      // by ID first: renaming an emitter must not rebind this handle to another
      const sys = pickSystem(next, systemName, systemId);
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
      /*
       * A STRUCTURAL edit starts from now, not from whatever is still in the
       * air.
       *
       * Uniforms are read per frame, so a changed value reaches the next spawn
       * immediately — that part always worked. Particles already alive do not
       * re-read anything, though: delete the node that shaped the spawn area
       * and everything currently on screen keeps the old shape until it dies,
       * which with a two-second lifetime is indistinguishable from the
       * deletion not having taken. The next unrelated edit that happens to
       * force a rebuild then snaps it, so it looks like the fix was that edit.
       *
       * The compiled backends already clear on a structural change, because a
       * changed graph means a changed kernel and the old state is not theirs
       * to keep. This makes the interpreted one behave the same way. VALUE
       * edits still leave the pool alone: you are tuning a running effect, and
       * wiping it on every keystroke would make tuning impossible.
       */
      const nextHash = hashGraph(sys.graph);
      if (nextHash !== graphHash) {
        graphHash = nextHash;
        engine.resetPool();
        scheduler.reset();
      }
      curSystem = sys;
      curParams = next.params;
      Object.assign(params, np);
      // Retarget rather than replace — a new scheduler would reset the spawn
      // accumulators on every live edit and stall the emitter mid-drag.
      scheduler.setEmitter(sys.emitter);
      recomputeWind();
      return true;
    },
    get viewOffset(): [number, number] {
      return [viewX, viewY];
    },
    set viewOffset(v: [number, number]) {
      if (Number.isFinite(v[0]) && Number.isFinite(v[1])) {
        viewX = v[0];
        viewY = v[1];
      }
    },
    get zoom() {
      return zoom;
    },
    set zoom(z: number) {
      // a zoom of 0 divides the world by nothing; ignore it rather than blanking
      if (Number.isFinite(z) && z > 0) zoom = z;
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
