import { useEffect, useRef, useState } from 'react';
import {
  createParticles,
  type AtlasOptions,
  type EmissionMaskOptions,
  type ParticlesHandle,
} from '@pylinka/core/webgl';
import { createCompiledParticles, type CompiledParticlesHandle } from '@pylinka/core/gpu';
import { createPathDriver, type PathDriver } from '@pylinka/core';
import type { System } from '@pylinka/graph';
import { useEditor } from '../store';
import { usePreview } from '../previewStore';
import { frameSize, type EditorProject } from '../types';
import { PathOverlay } from './PathOverlay';
import { ReferenceLayer } from './ReferenceLayer';
import { usePreviewBackground } from '../reference';
import { createBackdrop } from '../backdrop';

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

type BackendChoice = 'webgl' | 'webgpu' | 'webgl2';
const BACKEND_KEY = 'pylinka.editor.backend';
const BACKEND_LABEL: Record<BackendChoice, string> = {
  webgl: 'WebGL · interpreted',
  webgpu: 'WebGPU · compiled',
  webgl2: 'WebGL2 · compiled',
};

function initialBackend(): BackendChoice {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem(BACKEND_KEY) : null;
  return v === 'webgpu' || v === 'webgl2' ? v : 'webgl';
}

/** The single active pointer tool for the preview. Scroll always zooms; Fit resets. */
type Tool = 'pan' | 'follow' | 'spawn';
/*
 * `spawn` is called "Spawn", not "Burst". It used to be, and the bar right next
 * to it has a "Burst now" BUTTON that fires immediately — two controls two
 * places apart, both reading "Burst", one arming a click and one going off on
 * its own. Selecting a tool must never be the thing that fires it.
 */
const TOOLS: { id: Tool; icon: string; label: string; hint: string }[] = [
  { id: 'pan', icon: '⤧', label: 'Pan', hint: 'drag to move the view · scroll to zoom' },
  { id: 'follow', icon: '⌖', label: 'Follow', hint: 'the emitter tracks your cursor' },
  { id: 'spawn', icon: '✳', label: 'Spawn', hint: 'click the preview for one burst there — the emitter itself does not move' },
];

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
  // preview view transform — a pure CSS zoom/pan of the canvas (no engine cost).
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const panRef = useRef<{ cx: number; cy: number; vx: number; vy: number } | null>(null);
  // interactive spawn tester — spawn a burst on the ACTIVE emitter on demand
  // (the runtime API a dev calls: handle.spawnBurst(n)). Optionally at a click.
  const activeSystemId = useEditor((s) => s.activeSystemId);
  const activeSysRef = useRef(activeSystemId);
  activeSysRef.current = activeSystemId;
  const [burstCount, setBurstCount] = useState(100);
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
  const backdropRef = useRef<ReturnType<typeof createBackdrop> | null>(null);
  const [backend, setBackend] = useState<BackendChoice>(initialBackend);
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
  const pathEdit = usePreview((s) => s.pathEdit);

  // (re)create one particle handle per ENABLED system, PARENTS FIRST so a
  // sub-emitter can wire to its parent's live handle. Only the first handle
  // clears; the rest composite on top. Each carries its own atlas texture.
  const recreate = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    for (const h of fxRef.current) h.destroy();
    fxRef.current = [];
    const proj = projRef.current;
    const enabled = proj.systems.filter((s) => s.enabled);
    const enabledIds = new Set(enabled.map((s) => s.id));
    const links = proj.subEmitters ?? {};
    // effective parent = the declared parent, only if it's also enabled
    const parentOf = (id: string): string | undefined => {
      const p = links[id];
      return p && enabledIds.has(p) ? p : undefined;
    };
    // topological order: a system comes after its parent
    const ordered: typeof enabled = [];
    const placed = new Set<string>();
    let guard = enabled.length + 1;
    while (ordered.length < enabled.length && guard-- > 0) {
      for (const s of enabled) {
        if (placed.has(s.id)) continue;
        const par = parentOf(s.id);
        if (!par || placed.has(par)) { ordered.push(s); placed.add(s.id); }
      }
    }
    for (const s of enabled) if (!placed.has(s.id)) ordered.push(s); // cycle fallback

    const byId = new Map<string, AnyHandle>();
    const handles: AnyHandle[] = [];
    const sysIds: string[] = [];
    const chosen = backendRef.current;
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
    fxRef.current = handles;
    fxSysRef.current = sysIds;
  };

  // init: size canvas, seed knobs, start the loop, create the handles.
  // Re-runs when the backend changes — the <canvas> is keyed by backend so a
  // FRESH element comes up (a canvas can only ever hold one context type:
  // webgl2 and webgpu can't share an element).
  useEffect(() => {
    localStorage.setItem(BACKEND_KEY, backend);
    const canvas = canvasRef.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = () => {
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(canvas);

    const init: Record<string, number> = {};
    for (const p of projRef.current.params) if (p.default.t === 'f32') init[p.name] = p.default.v;
    const cur = usePreview.getState().knobs;
    setKnobsStore(Object.keys(cur).length > 0 ? cur : init);
    // let a knob node on the canvas push live values into the running handles
    usePreview.getState().setApply((name, v) => fxRef.current.forEach((h) => h.setKnob(name, v)));
    setError('');
    void recreate();

    let raf = 0;
    let last = performance.now();
    let t = 0;

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;
      // backdrop first: it clears, and the particles add to what it left
      const gl = canvas.getContext('webgl2');
      if (gl) {
        if (!backdropRef.current) backdropRef.current = createBackdrop(gl);
        gl.viewport(0, 0, canvas.width, canvas.height);
        backdropRef.current.draw(bgRef.current);
      }
      const handles = fxRef.current;
      if (handles.length) {
        let ex: number, ey: number;
        if (toolRef.current === 'follow' && mouseRef.current) [ex, ey] = mouseRef.current;
        else { ex = canvas.width / 2; ey = canvas.height / 2; }
        const alive = 0;
        for (let i = 0; i < handles.length; i++) {
          const fx = handles[i]!;
          // a system with a trajectory spline follows it; the rest sit at the
          // centre, or follow the cursor
          const sysId = fxSysRef.current[i];
          const path = sysId ? (projRef.current.systemPaths ?? {})[sysId] : null;
          if (path && path.points.length >= 2) {
            const key = JSON.stringify(path) + canvas.width + 'x' + canvas.height;
            let entry = driversRef.current.get(sysId!);
            if (!entry || entry.key !== key) {
              const pts = path.points.map(
                (p) => [p[0] * canvas.width, p[1] * canvas.height] as [number, number],
              );
              entry = {
                key,
                drv: createPathDriver(pts, { duration: path.duration, mode: path.mode, closed: path.closed }),
              };
              driversRef.current.set(sysId!, entry);
            }
            const [px2, py2] = entry.drv.at(t);
            fx.setEmitter(px2, py2);
          } else {
            // Spawn cuts the emitter around rather than moving it: without
            // teleport, `rateOverDistance` reads every jump as travel and fires
            // a spawn proportional to it — one at the click, another when it
            // snaps back, both far larger than the burst you asked for.
            fx.setEmitter(ex, ey, toolRef.current === 'spawn');
          }
          /*
           * A click is ONE burst at that point, and nothing else moves. Making
           * the emitter stay where you clicked seemed friendlier and was wrong:
           * the emitter's own continuous emission followed the cursor around
           * and never went back, so every click permanently relocated the
           * effect. The tool tests a burst; it does not re-place the emitter.
           */
          if (sysId === activeSysRef.current && spawnReq.current) {
            fx.setEmitter(spawnReq.current.x, spawnReq.current.y, true);
            fx.spawnBurst(burstCountRef.current);
          }
          fx.update(dt);
        }
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
      ro.disconnect();
      backdropRef.current?.destroy();
      backdropRef.current = null;
      for (const h of fxRef.current) h.destroy();
      fxRef.current = [];
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
    if (!handles.length) {
      if (project.systems.some((s) => s.enabled)) void recreate();
      return;
    }
    const eff = effective(project);
    try {
      if (!handles.every((fx) => fx.apply(eff))) void recreate();
    } catch (e) {
      setError(String(e));
      void recreate();
    }
  }, [rev]);

  // client coords → canvas pixels (correct under the CSS zoom transform)
  const canvasPx = (e: { clientX: number; clientY: number }): [number, number] => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };
  const onMove = (e: React.PointerEvent) => {
    if (panRef.current) {
      setView((v) => ({ ...v, x: panRef.current!.vx + (e.clientX - panRef.current!.cx), y: panRef.current!.vy + (e.clientY - panRef.current!.cy) }));
      return;
    }
    if (toolRef.current === 'follow') mouseRef.current = canvasPx(e);
  };
  const onPanDown = (e: React.PointerEvent) => {
    if (toolRef.current === 'spawn') {
      const [x, y] = canvasPx(e); // one burst here, consumed by the next frame
      spawnReq.current = { x, y };
      return;
    }
    if (toolRef.current !== 'pan') return; // follow doesn't drag the view
    panRef.current = { cx: e.clientX, cy: e.clientY, vx: view.x, vy: view.y };
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
        const k = nz / v.z;
        return { z: nz, x: cx * (1 - k) + v.x * k, y: cy * (1 - k) + v.y * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const fitView = () => setView({ z: 1, x: 0, y: 0 });

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
        <ReferenceLayer view={view} draggable={refOpen} />
        <canvas
          key={backend}
          ref={canvasRef}
          className="relative z-[1] block h-full w-full"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: 'center' }}
        />
        <PathOverlay editing={pathEdit} />
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
            <span aria-hidden className="text-[13px] leading-none">{tl.icon}</span>
            <span>{tl.label}</span>
          </button>
        ))}
        <button
          onClick={fitView}
          disabled={view.z === 1 && view.x === 0 && view.y === 0}
          title={`Fit — reset zoom & pan · ${Math.round(view.z * 100)}%`}
          aria-label="Fit"
          className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-muted-foreground hover:bg-accent/60 disabled:opacity-30 disabled:hover:bg-transparent">
          <span aria-hidden className="text-[13px] leading-none">⛶</span>
          <span>Fit</span>
        </button>

        <span className="mx-1 h-4 w-px bg-border" />

        <input
          type="number"
          min={1}
          value={burstCount}
          onChange={(e) => setBurstCount(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
          className="num"
          style={{ width: 52 }}
          title="Particles per click with the Spawn tool"
        />
        <select
          value={backend}
          onChange={(e) => setBackend(e.target.value as BackendChoice)}
          className="sel ml-auto"
          title="Simulation backend — compiled backends run the graph as generated GPU code">
          {(Object.keys(BACKEND_LABEL) as BackendChoice[]).map((k) => (
            <option key={k} value={k}>
              {BACKEND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

