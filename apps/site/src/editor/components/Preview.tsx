import { useEffect, useRef, useState } from 'react';
/*
 * Real icons, from lucide.
 *
 * The bar was glyphs — ⤧ ⌖ ✳ ❚❚ ⇥ ↻ — picked for looking vaguely like the
 * thing they do. They render at whatever weight and baseline each platform's
 * font decides, next to each other, at 11px. An icon set draws at one weight
 * on one grid and means the same thing everywhere.
 */
import {
  Crosshair,
  Hand,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  StepForward,
} from 'lucide-react';
import {
  createParticles,
  type AtlasOptions,
  type EmissionMaskOptions,
  type ParticlesHandle,
} from '@pylinka/core/webgl';
import { createCompiledParticles, type CompiledParticlesHandle } from '@pylinka/core/gpu';
import { createPathDriver, systemsInBuildOrder, type PathDriver } from '@pylinka/core';
import type { System } from '@pylinka/graph';
import { useEditor } from '../store';
import { usePreview, type BackendChoice } from '../previewStore';
import { frameSize, type EditorProject } from '../types';
import { PathOverlay } from './PathOverlay';
import { ReferenceLayer } from './ReferenceLayer';
import { usePreviewBackground, useReference } from '../reference';
import { createBackdrop } from '../backdrop';
import { createPixiStage, type PixiStage } from '../pixiStage';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

export async function buildAtlas(proj: EditorProject, sys: System): Promise<AtlasOptions | undefined> {
  const texId = (proj.systemTextures ?? {})[sys.id];
  const t = texId ? (proj.textures ?? []).find((x) => x.id === texId) : undefined;
  if (!t) return undefined;
  const image = await loadImage(t.src);
  const { frameW, frameH } = frameSize(t);
  return { image, width: t.width, height: t.height, cols: t.cols, rows: t.rows, frameW, frameH, pad: t.pad, fps: t.fps, play: t.play, pick: t.pick };
}

export async function buildMask(proj: EditorProject, sys: System): Promise<EmissionMaskOptions | undefined> {
  const m = (proj.systemMasks ?? {})[sys.id];
  if (!m) return undefined;
  const image = await loadImage(m.src);
  return { image, width: m.width, offset: m.offset };
}

/** The project the SIM sees: muted nodes (and their edges) stripped out. */
export function effective(proj: EditorProject): EditorProject {
  const off = new Set(proj.disabledNodes ?? []);
  if (off.size === 0) return proj;
  return {
    ...proj,
    systems: proj.systems.map((s) => ({
      ...s,
      graph: {
        nodes: s.graph.nodes.filter((n) => !off.has(n.id)),
        edges: s.graph.edges.filter((e) => !off.has(e.from.nodeId) && !off.has(e.to.nodeId)),
      },
    })),
  };
}

/** Both engines expose the same driving surface — this is the slice we use. */
type AnyHandle = ParticlesHandle | CompiledParticlesHandle;

const BACKEND_LABEL: Record<BackendChoice, string> = {
  webgl: 'WebGL · interpreted',
  webgpu: 'WebGPU · compiled',
  webgl2: 'WebGL2 · compiled',
};

/** The single active pointer tool for the preview. Scroll always zooms; Fit resets. */
type Tool = 'pan' | 'follow' | 'spawn';
/*
 * `spawn` is called "Spawn", not "Burst". It used to be, and the bar right next
 * to it has a "Burst now" BUTTON that fires immediately — two controls two
 * places apart, both reading "Burst", one arming a click and one going off on
 * its own. Selecting a tool must never be the thing that fires it.
 */
const TOOLS: { id: Tool; Icon: typeof Hand; label: string; hint: string }[] = [
  { id: 'pan', Icon: Hand, label: 'Pan', hint: 'drag to move the view · scroll to zoom' },
  { id: 'follow', Icon: Crosshair, label: 'Follow', hint: 'the emitter tracks your cursor' },
  { id: 'spawn', Icon: Sparkles, label: 'Spawn', hint: 'click the preview for one burst there — the emitter itself does not move' },
];

/**
 * Playback speeds, fast to slow.
 *
 * Above 1 to skim a long ambient loop, below it to see the shape of a burst
 * that is over in a fifth of a second.
 */
const SPEEDS = [1.5, 1.25, 1, 0.75, 0.5, 0.25, 0.1];

export function Preview() {
  const project = useEditor((s) => s.project);
  const rev = useEditor((s) => s.rev);
  const texRev = useEditor((s) => s.texRev);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<AnyHandle[]>([]);
  const fxSysRef = useRef<string[]>([]);
  const driversRef = useRef<Map<string, { key: string; drv: PathDriver }>>(new Map());
  const projRef = useRef(project);
  projRef.current = project;

  // off by default: a still emitter shows the graph you authored, not a motion
  // the preview added. Trajectory splines still run regardless.
  // ONE active pointer tool at a time (small toolbar): pan the view · make the
  // emitter follow the cursor · click to spawn a burst at that point.
  const [tool, setTool] = useState<Tool>('pan');
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const mouseRef = useRef<[number, number] | null>(null);
  /**
   * The view, as the world point under the middle of the canvas plus a zoom.
   *
   * It used to be a CSS transform on the canvas element, which is the wrong
   * place for both halves: zooming magnified a finished image, and panning sild
   * the drawn area out of its own viewport and left an empty margin. Both go to
   * the renderer now — `zoom` picks how much world the canvas shows, and
   * `viewOffset` slides the window it shows it through — so the canvas element
   * itself is never transformed. Storing the CENTRE rather than an offset is
   * what makes zoom-about-a-point a two-line calculation.
   */
  const [view, setView] = useState({ z: 1, cx: 0, cy: 0 });
  /** a drag in progress: where the pointer went down (screen) and where the view was (world) */
  const panRef = useRef<{ sx: number; sy: number; wx: number; wy: number } | null>(null);
  // interactive spawn tester — spawn a burst on the ACTIVE emitter on demand
  // (the runtime API a dev calls: handle.spawnBurst(n)). Optionally at a click.
  const activeSystemId = useEditor((s) => s.activeSystemId);
  const activeSysRef = useRef(activeSystemId);
  activeSysRef.current = activeSystemId;
  const [burstCount, setBurstCount] = useState(100);
  /*
   * Transport. VFX work is timing work, and every effect here ran at exactly
   * one speed with no way to hold a frame — a 0.4s burst could only be watched
   * as a blur. A `once` emitter was worse than that: it fires when it is built
   * and there was no way to see it again short of switching tabs and back.
   */
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const stepRef = useRef(false);
  const [speed, setSpeed] = useState(1);
  /*
   * What is actually running, in the corner.
   *
   * Which renderer, how many particles are alive, and the frame rate — three
   * facts that decided every performance question in this session and were
   * nowhere on screen. Sampled twice a second, because the alive count is a
   * synchronous GPU readback on the interpreted path: per frame it would be
   * the most expensive thing in the loop.
   */
  const [stats, setStats] = useState({ fps: 0, alive: 0 });
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const burstCountRef = useRef(burstCount);
  burstCountRef.current = burstCount;
  const spawnReq = useRef<{ x: number; y: number } | null>(null);
  /**
   * Errors only. The fps / alive readout that used to live up here is gone for
   * now, but a failed engine create still has to say so — silently rendering
   * nothing is the worst version of that.
   */
  const [error, setError] = useState('');
  // scene reference: open panel = the image takes the pointer so it can be
  // dragged into place; closed = inert, and pan/spawn behave as before
  /**
   * The reference is draggable exactly while its controls are on screen —
   * Settings, open on Preview. Any other time it is inert, so it never steals a
   * pan or a spawn click.
   */
  const refOpen = useEditor((s) => s.configOpen && s.configSection === 'preview');
  const bg = usePreviewBackground();
  const bgRef = useRef(bg);
  bgRef.current = bg;
  useEffect(() => {
    stageRef.current?.setBackdrop(bg);
  }, [bg]);
  const backdropRef = useRef<ReturnType<typeof createBackdrop> | null>(null);
  /*
   * The scene reference, drawn INSIDE the canvas.
   *
   * As a DOM layer it could only be wholly behind the canvas — invisible,
   * because the backdrop above it is opaque — or wholly in front, painting over
   * the effect it exists to be judged against. In the framebuffer there is a
   * middle: backdrop, reference, particles, which is the order a game draws in.
   */
  const refSettings = useReference();
  const refImages = useEditor((s) => s.project.references);
  const refSrc = refSettings.id ? (refImages ?? []).find((r) => r.id === refSettings.id)?.src : undefined;
  const refImgRef = useRef<HTMLImageElement | null>(null);
  const refCfgRef = useRef(refSettings);
  refCfgRef.current = refSettings;
  useEffect(() => {
    if (refSrc === undefined) {
      refImgRef.current = null;
      return;
    }
    let live = true;
    void loadImage(refSrc)
      .then((im) => {
        if (live) refImgRef.current = im;
      })
      .catch(() => {
        refImgRef.current = null;
      });
    return () => {
      live = false;
    };
  }, [refSrc]);
  const dprRef = useRef(1);
  const viewRef = useRef({ z: 1, cx: 0, cy: 0 });
  /** the pixi path, when a compiled backend is running; null on the raw one */
  const stageRef = useRef<PixiStage | null>(null);
  /** bumped by every recreate; an older run that finishes later throws its work away */
  const genRef = useRef(0);
  /** the loop is registered once; the converter it calls changes with the view */
  const worldPxRef = useRef<(x: number, y: number) => [number, number]>(() => [0, 0]);

  /**
   * Push the view onto the running handles.
   *
   * `zoom` is world units per canvas PIXEL. The buffer holds `dpr` device
   * pixels per CSS pixel, so `1 / (dpr * z)` makes one world unit one CSS
   * pixel at zoom 1 — which also fixes a sizing bug that had nothing to do
   * with the view: world units used to be DEVICE pixels, so an effect authored
   * at 100px covered 100 CSS px on a 1x display and 50 on a Retina one.
   *
   * `viewOffset` is the top-left of the visible window, in world units. The
   * canvas shows `size / z` world units, centred on the view.
   */
  const applyView = () => {
    const c = canvasRef.current;
    if (!c) return;
    const { z, cx, cy } = viewRef.current;
    // the pixi path carries the view on its world Container
    if (stageRef.current !== null) {
      stageRef.current.setView(z, cx, cy);
      return;
    }
    const zoom = 1 / (dprRef.current * z);
    const halfW = c.clientWidth / (2 * z);
    const halfH = c.clientHeight / (2 * z);
    for (const h of fxRef.current) {
      h.zoom = zoom;
      h.viewOffset = [cx - halfW, cy - halfH];
    }
  };
  /*
   * The choice lives in the preview store because three things read it: the
   * loop, which builds the right kind of stage; the graph, which marks the
   * nodes the interpreted backend ignores; and Settings, which is where it is
   * now CHOSEN — its label was the widest thing in the tool bar and pushed the
   * rest off the end.
   */
  const backend = usePreview((s) => s.backend);
  const backendRef = useRef(backend);
  backendRef.current = backend;
  const [recompiled, setRecompiled] = useState('');
  const recompTimer = useRef<number>(0);
  const flashRecompile = (info: { ms: number; reason: string }) => {
    setRecompiled(`recompiled (${info.reason}) in ${info.ms.toFixed(1)} ms`);
    window.clearTimeout(recompTimer.current);
    recompTimer.current = window.setTimeout(() => setRecompiled(''), 1800);
  };
  // knobs + pathEdit live in the preview store so the left-panel Knobs/Emitter
  // tabs can drive them; Preview owns the handles and registers the apply hook.
  const setKnobsStore = usePreview((s) => s.setKnobs);
  // the active emitter's spawn settings, so the toolbar can edit the rate
  const activeEmitter = useEditor((s) => (s.project.systems.find((x) => x.id === s.activeSystemId) ?? s.project.systems[0]!).emitter);
  const setEmitterSettings = useEditor((s) => s.setEmitter);
  const pathEdit = usePreview((s) => s.pathEdit);

  // (re)create one particle handle per ENABLED system, PARENTS FIRST so a
  // sub-emitter can wire to its parent's live handle. Only the first handle
  // clears; the rest composite on top. Each carries its own atlas texture.
  const recreate = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    /*
     * Only the newest build may land.
     *
     * This is async — it loads atlases and masks, and on the pixi path it
     * builds a whole Application — and it is called from several places, one
     * of which is every graph edit that cannot be applied live. Two overlapping
     * runs would BOTH finish, and only the later assignment is remembered: the
     * earlier set is never destroyed, so its GPU buffers stay allocated and —
     * on the pixi path — a second renderer keeps drawing into the same canvas.
     * A leak and a flicker at once.
     */
    const gen = ++genRef.current;
    const stale = () => gen !== genRef.current;
    for (const h of fxRef.current) h.destroy();
    fxRef.current = [];
    stageRef.current?.destroy();
    stageRef.current = null;
    const proj = projRef.current;

    /*
     * Compiled backends run inside a pixi renderer, the way a game runs them —
     * which is also what makes the view a Container transform rather than a
     * CSS one. The interpreted backend cannot join them: pixi owns the canvas
     * context and a canvas has exactly one.
     */
    if (backendRef.current !== 'webgl') {
      const textures: Record<string, never> = {};
      const masks: Record<string, never> = {};
      for (const sys of proj.systems) {
        if (!sys.enabled) continue;
        try {
          const atlas = await buildAtlas(proj, sys);
          if (atlas) (textures as Record<string, unknown>)[sys.name] = atlas;
          const mask = await buildMask(proj, sys);
          if (mask) (masks as Record<string, unknown>)[sys.name] = mask;
        } catch {
          /* texture/mask failed to load → soft sprite / analytic shape */
        }
      }
      if (stale()) return;
      try {
        const built = await createPixiStage({
          canvas,
          project: effective(proj),
          backend: backendRef.current,
          textures,
          masks,
          backdrop: bgRef.current,
        });
        // a newer build (or an unmount) started while this one was loading
        if (stale()) {
          built.destroy();
          return;
        }
        stageRef.current = built;
        stageRef.current.resize(canvas.clientWidth, canvas.clientHeight, dprRef.current);
        fxSysRef.current = stageRef.current.order;
        for (const [n, v] of Object.entries(usePreview.getState().knobs)) {
          for (const view of stageRef.current.views.values()) view.params.set(n, v);
        }
        applyView();
      } catch (e) {
        setError(String(e));
      }
      return;
    }
    // the same ordering a consumer gets from core, rather than a second copy
    // of it that can drift: parents first, links filtered to enabled systems
    const { systems: ordered, links: linkMap } = systemsInBuildOrder(proj);
    const parentOf = (id: string): string | undefined => linkMap.get(id);

    const byId = new Map<string, AnyHandle>();
    const handles: AnyHandle[] = [];
    const sysIds: string[] = [];
    const chosen = backendRef.current;
    /** abandon a superseded build, taking whatever it managed to create with it */
    const abandon = () => {
      for (const h of handles) h.destroy();
      handles.length = 0;
    };
    for (let i = 0; i < ordered.length; i++) {
      const sys = ordered[i]!;
      let atlas: AtlasOptions | undefined;
      let emissionMask: EmissionMaskOptions | undefined;
      try {
        atlas = await buildAtlas(proj, sys);
        emissionMask = await buildMask(proj, sys);
      } catch {
        /* texture/mask failed to load → soft sprite / analytic shape */
      }
      if (stale()) return abandon();
      const parId = parentOf(sys.id);
      const subParent = parId ? byId.get(parId) : undefined;
      try {
        let h: AnyHandle;
        if (chosen === 'webgl') {
          const wh = createParticles(canvas, effective(proj), {
            systemName: sys.name,
            ...(atlas ? { atlas } : {}),
            ...(emissionMask ? { emissionMask } : {}),
            ...(subParent ? { subParent: subParent as ParticlesHandle } : {}),
          });
          byId.set(sys.id, wh);
          h = wh;
          applyView();
        } else {
          // compiled path: the whole graph runs as generated GPU code —
          // animated atlases, emission masks, and sub-emitters all supported.
          const ch = await createCompiledParticles(canvas, effective(proj), {
            systemName: sys.name,
            backend: chosen,
            ...(atlas
              ? {
                  atlas: {
                    image: atlas.image,
                    cols: atlas.cols,
                    rows: atlas.rows,
                    frameW: atlas.frameW,
                    frameH: atlas.frameH,
                    pad: atlas.pad,
                    fps: atlas.fps,
                    play: atlas.play,
                    pick: atlas.pick,
                  },
                }
              : {}),
            ...(emissionMask ? { emissionMask } : {}),
            ...(subParent ? { subParent: subParent as CompiledParticlesHandle } : {}),
            onRecompile: flashRecompile,
          });
          byId.set(sys.id, ch);
          applyView();
          h = ch;
        }
        // the backdrop pass owns the clear — see backdrop.ts for why it has to
        // be inside the framebuffer rather than a layer behind the canvas
        h.autoClear = false;
        for (const [n, v] of Object.entries(usePreview.getState().knobs)) h.setKnob(n, v);
        handles.push(h);
        sysIds.push(sys.id);
      } catch (e) {
        setError(String(e));
      }
    }
    if (stale()) return abandon();
    fxRef.current = handles;
    fxSysRef.current = sysIds;
  };

  // init: size canvas, seed knobs, start the loop, create the handles.
  // Re-runs when the backend changes — the <canvas> is keyed by backend so a
  // FRESH element comes up (a canvas can only ever hold one context type:
  // webgl2 and webgpu can't share an element).
  useEffect(() => {
    const canvas = canvasRef.current!;
    const size = () => {
      // re-read the ratio every time: dragging the window to a display of a
      // different density changes it, and a stale one renders soft
      dprRef.current = Math.min(window.devicePixelRatio || 1, 2);
      // the pixi path owns its own canvas sizing (pixi writes canvas.width from
      // the CSS size and the resolution it was given)
      if (stageRef.current !== null) {
        stageRef.current.resize(canvas.clientWidth, canvas.clientHeight, dprRef.current);
      } else {
        const w = Math.floor(canvas.clientWidth * dprRef.current);
        const h = Math.floor(canvas.clientHeight * dprRef.current);
        if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
          canvas.width = w;
          canvas.height = h;
        }
      }
      // the visible window is measured from the canvas box, so a resize is a
      // view change too
      applyView();
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    // ResizeObserver does not fire when only the DENSITY changes
    const dprWatch = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprWatch.addEventListener('change', size);

    const init: Record<string, number> = {};
    for (const p of projRef.current.params) if (p.default.t === 'f32') init[p.name] = p.default.v;
    const cur = usePreview.getState().knobs;
    setKnobsStore(Object.keys(cur).length > 0 ? cur : init);
    // let a knob node on the canvas push live values into the running handles
    usePreview.getState().setApply((name, v) => {
      const stage = stageRef.current;
      if (stage !== null) for (const view of stage.views.values()) view.params.set(name, v);
      else fxRef.current.forEach((h) => h.setKnob(name, v));
    });
    setError('');
    void recreate();

    let raf = 0;
    let last = performance.now();
    let t = 0;

    let frames = 0;
    let statAt = performance.now();
    const loop = (now: number) => {
      const real = Math.min((now - last) / 1000, 0.05);
      last = now;
      /*
       * Paused advances time by ZERO rather than skipping the frame.
       *
       * Skipping it froze the picture, which is what pause means — but it also
       * froze the VIEW, so panning and zooming a held frame did nothing, and
       * looking closely at a moment is most of the reason to hold one. Drawing
       * with dt 0 renders the same particles wherever the view now points.
       */
      frames++;
      if (now - statAt >= 500) {
        const fps = (frames * 1000) / (now - statAt);
        frames = 0;
        statAt = now;
        let alive = 0;
        const st = stageRef.current;
        if (st !== null) for (const v of st.views.values()) alive += v.stats.aliveCount;
        else for (const h of fxRef.current) alive += h.aliveCount();
        setStats({ fps, alive });
      }
      const stepOnce = stepRef.current;
      stepRef.current = false;
      // a step is one frame at a fixed 60th, whatever the wall clock says
      const dt = stepOnce ? 1 / 60 : pausedRef.current ? 0 : real * speedRef.current;
      t += dt;
      const stage = stageRef.current;
      /*
       * A canvas gets exactly ONE context, ever, and asking for a second kind
       * returns null forever after.
       *
       * This used to run whenever `stage` was null — which includes the gap
       * before an async createPixiStage has resolved. One tick in that window
       * took a webgl2 context on the canvas, and pixi's later getContext
       * ('webgpu') came back null: `Cannot read properties of null (reading
       * 'configure')`, from deep inside the renderer, on a canvas that looks
       * perfectly fine. So the test is which backend was CHOSEN, not whether
       * its stage happens to exist yet.
       *
       * The raw path draws its backdrop into the framebuffer before the
       * particles; the pixi stage owns its own, a tiling sprite under the
       * world container.
       */
      if (backendRef.current === 'webgl') {
        const gl = canvas.getContext('webgl2');
        if (gl) {
          if (!backdropRef.current) backdropRef.current = createBackdrop(gl);
          gl.viewport(0, 0, canvas.width, canvas.height);
          backdropRef.current.draw(bgRef.current);
          const rimg = refImgRef.current;
          const rcfg = refCfgRef.current;
          if (rimg && rcfg.visible && rcfg.opacity > 0) {
            const v = viewRef.current;
            // contain-fit into the canvas box, then the reference's own scale
            const box = Math.min(canvas.clientWidth / rimg.width, canvas.clientHeight / rimg.height);
            const w = rimg.width * box * rcfg.scale;
            const h = rimg.height * box * rcfg.scale;
            backdropRef.current.drawImage(
              { image: rimg, center: [rcfg.offset[0], rcfg.offset[1]], size: [w, h], opacity: rcfg.opacity },
              {
                zoom: 1 / (dprRef.current * v.z),
                offset: [v.cx - canvas.clientWidth / (2 * v.z), v.cy - canvas.clientHeight / (2 * v.z)],
                wPx: canvas.width,
                hPx: canvas.height,
              },
            );
          }
        }
      }
      const handles = fxRef.current;
      if (handles.length || stage !== null) {
        // WORLD coordinates from here down; each driver converts at its edge
        let ex: number, ey: number;
        if (toolRef.current === 'follow' && mouseRef.current) [ex, ey] = mouseRef.current;
        else [ex, ey] = [0, 0]; // the world origin, wherever the view is
        const alive = 0;
        /*
         * One driving surface over both paths. A raw handle takes CANVAS pixels
         * and maps them back through its own zoom and view offset; a pixi view
         * takes its container's local space, which IS world. Converting here
         * keeps the loop in one coordinate system.
         */
        const driven: { sysId: string | undefined; place(x: number, y: number, cut?: boolean): void; burst(n: number): void }[] =
          stage !== null
            ? stage.order.map((id) => {
                const v = stage.views.get(id)!;
                return {
                  sysId: id,
                  place: (x, y) => v.setEmitterPosition(x, y),
                  burst: (n) => v.spawnBurst(n),
                };
              })
            : handles.map((fx, i) => ({
                sysId: fxSysRef.current[i],
                place: (x, y, cut) => {
                  const [px2, py2] = worldPxRef.current(x, y);
                  fx.setEmitter(px2, py2, cut);
                },
                burst: (n) => fx.spawnBurst(n),
              }));
        for (let i = 0; i < driven.length; i++) {
          const fx = driven[i]!;
          // a system with a trajectory spline follows it; the rest sit at the
          // centre, or follow the cursor
          const sysId = fx.sysId;
          const path = sysId ? (projRef.current.systemPaths ?? {})[sysId] : null;
          if (path && path.points.length >= 2) {
            const v = viewRef.current;
            void v;
            const key = `${JSON.stringify(path)}|${canvas.clientWidth}x${canvas.clientHeight}`;
            let entry = driversRef.current.get(sysId!);
            if (!entry || entry.key !== key) {
              // normalised 0..1 across the canvas at zoom 1, in WORLD units —
              // the trajectory belongs to the effect, so it must not move when
              // the view does
              const pts = path.points.map(
                (p) =>
                  [(p[0] - 0.5) * canvas.clientWidth, (p[1] - 0.5) * canvas.clientHeight] as [
                    number,
                    number,
                  ],
              );
              entry = {
                key,
                drv: createPathDriver(pts, { duration: path.duration, mode: path.mode, closed: path.closed }),
              };
              driversRef.current.set(sysId!, entry);
            }
            const [px2, py2] = entry.drv.at(t);
            fx.place(px2, py2);
          } else {
            // Spawn cuts the emitter around rather than moving it: without
            // teleport, `rateOverDistance` reads every jump as travel and fires
            // a spawn proportional to it — one at the click, another when it
            // snaps back, both far larger than the burst you asked for.
            fx.place(ex, ey, toolRef.current === 'spawn');
          }
          /*
           * A click is ONE burst at that point, and nothing else moves. Making
           * the emitter stay where you clicked seemed friendlier and was wrong:
           * the emitter's own continuous emission followed the cursor around
           * and never went back, so every click permanently relocated the
           * effect. The tool tests a burst; it does not re-place the emitter.
           */
          if (sysId === activeSysRef.current && spawnReq.current) {
            fx.place(spawnReq.current.x, spawnReq.current.y, true);
            fx.burst(burstCountRef.current);
          }
        }
        // the pixi path keeps its reference in the scene graph rather than
        // redrawing it, so it only needs the numbers when they change
        if (stage !== null) {
          const rimg = refImgRef.current;
          const rcfg = refCfgRef.current;
          if (rimg && rcfg.visible && rcfg.opacity > 0) {
            const box = Math.min(canvas.clientWidth / rimg.width, canvas.clientHeight / rimg.height);
            stage.setReference({
              image: rimg,
              center: [rcfg.offset[0], rcfg.offset[1]],
              size: [rimg.width * box * rcfg.scale, rimg.height * box * rcfg.scale],
              opacity: rcfg.opacity,
            });
          } else {
            stage.setReference(null);
          }
        }
        // stepping is per-path: raw handles each step and draw themselves, in
        // creation order so a sub-emitter follows its parent; the pixi stage
        // steps every system and draws the frame once
        if (stage !== null) stage.frame(dt);
        else for (const h of handles) h.update(dt);
        spawnReq.current = null;
        // the fps / alive readout is gone for now, so nothing reads these back
        // from the GPU each half-second — aliveCount() is a synchronous stall
        void alive;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      dprWatch.removeEventListener('change', size);
      ro.disconnect();
      backdropRef.current?.destroy();
      backdropRef.current = null;
      for (const h of fxRef.current) h.destroy();
      fxRef.current = [];
      stageRef.current?.destroy();
      stageRef.current = null;
      // anything still loading belongs to a preview that no longer exists
      genRef.current++;
      // and the store must not keep a closure over destroyed handles
      usePreview.getState().setApply(() => {});
    };
  }, [backend]);

  // texture/system set changed → full re-create (atlas + system count are construction-time inputs)
  const firstTex = useRef(true);
  useEffect(() => {
    if (firstTex.current) { firstTex.current = false; return; }
    void recreate();
  }, [texRev]);


  // graph/value change → live re-apply to each handle (or re-create on capacity
  // change / after a failed create, so an invalid edit can be edited back out)
  useEffect(() => {
    const handles = fxRef.current;
    const stage = stageRef.current;
    /*
     * Nothing built yet? Build it. The pixi path keeps its systems in the
     * stage rather than in `fxRef`, so testing only the handles meant every
     * value edit on a compiled backend rebuilt the entire renderer instead of
     * applying — a pixi Application, a GPU context and every pipeline, per
     * slider tick.
     */
    if (!handles.length && stage === null) {
      if (project.systems.some((s) => s.enabled)) void recreate();
      return;
    }
    const eff = effective(project);
    try {
      if (stage !== null) {
        if (!stage.apply(eff)) void recreate();
        return;
      }
      if (!handles.every((fx) => fx.apply(eff))) void recreate();
    } catch (e) {
      setError(String(e));
      void recreate();
    }
  }, [rev]);

  // the view is a render parameter now, so a change is a write to the handles
  useEffect(() => {
    viewRef.current = view;
    applyView();
  }, [view]);

  /**
   * Pointer → WORLD.
   *
   * Everything the tools do — placing a burst, following the cursor — is in
   * world units, and each path converts at its own boundary: the pixi stage
   * takes them as they are (they are its container's local space), the raw
   * handles take canvas pixels and map them back through zoom and offset.
   */
  const screenToWorld = (e: { clientX: number; clientY: number }): [number, number] => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const { z, cx, cy } = viewRef.current;
    return [cx + (e.clientX - r.left - r.width / 2) / z, cy + (e.clientY - r.top - r.height / 2) / z];
  };

  /** WORLD → canvas pixels, the inverse of what a raw handle's setEmitter does. */
  const worldPx = (wx: number, wy: number): [number, number] => {
    const c = canvasRef.current!;
    const { z, cx, cy } = viewRef.current;
    const zoom = 1 / (dprRef.current * z);
    return [(wx - (cx - c.clientWidth / (2 * z))) / zoom, (wy - (cy - c.clientHeight / (2 * z))) / zoom];
  };
  worldPxRef.current = worldPx;

  const onMove = (e: React.PointerEvent) => {
    if (panRef.current) {
      // a drag of one CSS pixel moves the world by 1/z, in the opposite
      // direction: dragging right brings what is left of the view into it
      const p = panRef.current;
      setView((v) => ({
        ...v,
        cx: p.wx - (e.clientX - p.sx) / v.z,
        cy: p.wy - (e.clientY - p.sy) / v.z,
      }));
      return;
    }
    if (toolRef.current === 'follow') mouseRef.current = screenToWorld(e);
  };
  const onPanDown = (e: React.PointerEvent) => {
    if (toolRef.current === 'spawn') {
      const [x, y] = screenToWorld(e); // one burst here, consumed by the next frame
      spawnReq.current = { x, y };
      return;
    }
    if (toolRef.current !== 'pan') return; // follow doesn't drag the view
    panRef.current = { sx: e.clientX, sy: e.clientY, wx: view.cx, wy: view.cy };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPanUp = (e: React.PointerEvent) => {
    panRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };
  // Scroll AND macOS trackpad pinch both zoom the preview, anchored to the
  // cursor so the point under it stays put. This needs a native, non-passive
  // listener: React's onWheel is passive so it can't preventDefault — and a
  // pinch (a wheel event with ctrlKey) would otherwise zoom the whole page.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - (r.left + r.width / 2);
      const cy = e.clientY - (r.top + r.height / 2);
      // pinch sends small continuous deltas; the wheel sends larger steps —
      // an exponential factor feels right for both.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      setView((v) => {
        const nz = Math.min(8, Math.max(0.25, v.z * factor));
        // hold the world point under the cursor still: it sits `cx / z` world
        // units from the centre before, and has to sit there after
        return { z: nz, cx: v.cx + cx / v.z - cx / nz, cy: v.cy + cy / v.z - cy / nz };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const fitView = () => setView({ z: 1, cx: 0, cy: 0 });

  /**
   * The same view as a CSS transform, for the DOM layers over the canvas.
   *
   * A layer that draws world point `w` at its own CSS offset `w` needs
   * `scale(z)` about the centre plus a translation that puts `view.cx` there.
   */
  const cssView = {
    z: view.z,
    x: -view.cx * view.z,
    y: -view.cy * view.z,
  };

  return (
    <div className="flex h-full flex-col">
      <div
        ref={wrapRef}
        className="relative min-h-[340px] flex-1 overflow-hidden bg-background"
        style={{ cursor: tool === 'spawn' ? 'crosshair' : tool === 'pan' ? 'grab' : 'default' }}
        onPointerDown={onPanDown}
        onPointerMove={onMove}
        onPointerUp={onPanUp}
        onPointerLeave={() => { mouseRef.current = null; panRef.current = null; }}>
        {/*
          Stacking inside the preview, bottom to top: reference behind (z 0),
          the canvas (z 1), reference in front (z 3), then every interactive
          overlay at z 10. The canvas has to be a positioned, z-indexed element
          so the behind-reference can sit under it — but that also lifts it over
          any sibling left on the default z, and a painted-over control is a
          dead control however late it comes in the DOM: the click lands on the
          canvas and the preview pans instead. So the overlays name their layer
          explicitly rather than relying on document order.
        */}
        {/*
          The reference image is a DOM element, so it does move with a CSS
          transform — it is the one layer that has to, and the numbers come
          from the same view the renderer got, so the two stay registered.
        */}
        <ReferenceLayer view={cssView} draggable={refOpen} />
        <canvas
          key={backend}
          ref={canvasRef}
          className="relative z-[1] block h-full w-full"
          /*
            No transform. Pan and zoom are render parameters on the handles
            (`viewOffset` and `zoom`), so the canvas always covers its own box
            at exactly its own resolution — a transformed canvas either
            magnifies a finished image or slides its drawn area out of view.
          */
        />
        <PathOverlay editing={pathEdit} view={cssView} />
        {pathEdit && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-black/70 px-2 py-1 text-[10px] text-foreground">
            drawing path — click to add · drag to move · double-click to delete
          </div>
        )}
        {error !== '' && (
          <div className="absolute inset-x-2 top-2 z-10 rounded-md border border-destructive/40 bg-black/80 px-2 py-1.5 text-[10px] text-destructive">
            {error}
          </div>
        )}
        {/*
          Three lines, top right, over the canvas: which renderer is running,
          how many particles are alive, and the frame rate. Bright enough to
          read against any backdrop, small enough to ignore.
        */}
        <div
          className="pointer-events-none absolute right-2 top-2 z-10 text-right font-mono text-[10px] leading-[1.35]"
          style={{ color: 'color-mix(in oklab, var(--color-foreground) 85%, transparent)', textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
          <div>{BACKEND_LABEL[backend]}</div>
          <div>{stats.alive.toLocaleString()} particles</div>
          <div>{Math.round(stats.fps)} fps</div>
        </div>
        {recompiled !== '' && (
          <div className="pointer-events-none absolute right-2 top-2 z-10 rounded-md bg-black/70 px-2 py-1 text-[10px] text-amber-300">
            {recompiled}
          </div>
        )}
      </div>
      {/*
        Tools sit under the canvas rather than floating over it: they were
        covering the very thing they act on, and a bar has room for labels.
      */}
      <div data-tour="preview-tools" className="flex items-center gap-1 border-t border-border px-2 py-1 text-[11px]">
        {TOOLS.map((tl) => (
          <button
            key={tl.id}
            onClick={() => {
              setTool(tl.id);
              if (tl.id !== 'follow') mouseRef.current = null;
            }}
            title={`${tl.label} — ${tl.hint}`}
            aria-label={tl.label}
            className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 ${
              tool === tl.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
            }`}>
            <tl.Icon aria-hidden size={13} strokeWidth={2} />
            <span>{tl.label}</span>
          </button>
        ))}
        {/*
          Transport, in the bar that already exists rather than a panel of its
          own: hold a frame, step one, replay from the start, or slow the whole
          thing down. A `once` emitter needs the replay to be watchable at all.
        */}
        <button
          onClick={() => setPaused((v) => !v)}
          title={paused ? 'Play' : 'Pause — hold the frame'}
          aria-label={paused ? 'Play' : 'Pause'}
          className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 ${
            paused ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
          }`}>
          {paused ? <Play aria-hidden size={13} strokeWidth={2} /> : <Pause aria-hidden size={13} strokeWidth={2} />}
        </button>
        <button
          onClick={() => {
            stepRef.current = true;
            setPaused(true);
          }}
          title="Step one frame (1/60s)"
          aria-label="Step one frame"
          className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-muted-foreground hover:bg-accent/60">
          <StepForward aria-hidden size={13} strokeWidth={2} />
        </button>
        <button
          onClick={() => void recreate()}
          title="Replay from the start — the only way to see a “once” emitter again"
          aria-label="Replay"
          className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-muted-foreground hover:bg-accent/60">
          <RotateCcw aria-hidden size={13} strokeWidth={2} />
        </button>
        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="sel"
          title="Playback speed — slow a burst down to see its shape">
          {SPEEDS.map((v) => (
            <option key={v} value={v}>
              x{v}
            </option>
          ))}
        </select>

        <span className="mx-1 h-4 w-px bg-border" />

        <button
          onClick={fitView}
          disabled={view.z === 1 && view.cx === 0 && view.cy === 0}
          title={`Fit — reset zoom & pan · ${Math.round(view.z * 100)}%`}
          aria-label="Fit"
          className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-muted-foreground hover:bg-accent/60 disabled:opacity-30 disabled:hover:bg-transparent">
          <Maximize2 aria-hidden size={13} strokeWidth={2} />
          <span>Fit</span>
        </button>

        <span className="mx-1 h-4 w-px bg-border" />

        <label className="flex items-center gap-1 text-muted-foreground" title="Particles per click with the Spawn tool">
          burst
          <input
            type="number"
            min={1}
            value={burstCount}
            onChange={(e) => setBurstCount(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
            className="num"
            style={{ width: 52 }}
          />
        </label>
        {/*
          Emission rate, next to the tools rather than three clicks deep in
          Settings. It is the number you reach for most while watching the
          effect, and every trip to a modal is a trip with your eyes off the
          thing you are tuning. Same store field either way — this is a second
          door onto it, not a second copy.
        */}
        {activeEmitter.mode === 'flow' ? (
          <label className="flex items-center gap-1 text-muted-foreground" title="Particles per second from this emitter">
            rate
            <input
              type="number"
              min={0}
              step={10}
              value={activeEmitter.rate}
              onChange={(e) => setEmitterSettings({ rate: Math.max(0, Number(e.target.value) || 0) })}
              className="num"
              style={{ width: 62 }}
            />
            /s
          </label>
        ) : (
          <label className="flex items-center gap-1 text-muted-foreground" title="Particles per burst from this emitter">
            count
            <input
              type="number"
              min={1}
              value={activeEmitter.burst?.count ?? 100}
              onChange={(e) =>
                setEmitterSettings({
                  burst: {
                    count: Math.max(1, Math.floor(Number(e.target.value)) || 1),
                    interval: activeEmitter.burst?.interval ?? 1.5,
                  },
                })
              }
              className="num"
              style={{ width: 62 }}
            />
          </label>
        )}

      </div>
    </div>
  );
}

