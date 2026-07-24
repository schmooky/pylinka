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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

async function buildAtlas(proj: EditorProject, sys: System): Promise<AtlasOptions | undefined> {
  const texId = (proj.systemTextures ?? {})[sys.id];
  const t = texId ? (proj.textures ?? []).find((x) => x.id === texId) : undefined;
  if (!t) return undefined;
  const image = await loadImage(t.src);
  const { frameW, frameH } = frameSize(t);
  return { image, width: t.width, height: t.height, cols: t.cols, rows: t.rows, frameW, frameH, pad: t.pad, fps: t.fps, play: t.play, pick: t.pick };
}

async function buildMask(proj: EditorProject, sys: System): Promise<EmissionMaskOptions | undefined> {
  const m = (proj.systemMasks ?? {})[sys.id];
  if (!m) return undefined;
  const image = await loadImage(m.src);
  return { image, width: m.width, offset: m.offset };
}

/** The project the SIM sees: muted nodes (and their edges) stripped out. */
function effective(proj: EditorProject): EditorProject {
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

export function Preview() {
  const project = useEditor((s) => s.project);
  const rev = useEditor((s) => s.rev);
  const texRev = useEditor((s) => s.texRev);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<AnyHandle[]>([]);
  const fxSysRef = useRef<string[]>([]);
  const driversRef = useRef<Map<string, { key: string; drv: PathDriver }>>(new Map());
  const projRef = useRef(project);
  projRef.current = project;

  // off by default: a still emitter shows the graph you authored, not a motion
  // the preview added. Trajectory splines still run regardless.
  const [orbit, setOrbit] = useState(false);
  const orbitRef = useRef(orbit);
  orbitRef.current = orbit;
  // cursor-follow is a toggle now (was always-on while hovering) — parked at the
  // canvas centre when off, so an effect sits still and you can actually watch it.
  const [follow, setFollow] = useState(false);
  const followRef = useRef(follow);
  followRef.current = follow;
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
  const [spawnClick, setSpawnClick] = useState(false);
  const spawnClickRef = useRef(spawnClick);
  spawnClickRef.current = spawnClick;
  const spawnReq = useRef<{ x: number; y: number } | null>(null);
  const [hud, setHud] = useState('');
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
        h.autoClear = i === 0;
        for (const [n, v] of Object.entries(usePreview.getState().knobs)) h.setKnob(n, v);
        handles.push(h);
        sysIds.push(sys.id);
      } catch (e) {
        setHud(String(e));
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
    // let the left-panel Knobs tab push live values into the running handles
    usePreview.getState().setApply((name, v) => fxRef.current.forEach((h) => h.setKnob(name, v)));
    setHud('');
    void recreate();

    let raf = 0;
    let last = performance.now();
    let t = 0;
    let acc = 0;
    let frames = 0;
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;
      const handles = fxRef.current;
      if (handles.length) {
        let ex: number, ey: number;
        if (mouseRef.current) [ex, ey] = mouseRef.current;
        else if (orbitRef.current) {
          const r = Math.min(canvas.width, canvas.height) * 0.28;
          ex = canvas.width / 2 + Math.cos(t * 1.8) * r;
          ey = canvas.height / 2 + Math.sin(t * 1.8) * r;
        } else { ex = canvas.width / 2; ey = canvas.height / 2; }
        let alive = 0;
        for (let i = 0; i < handles.length; i++) {
          const fx = handles[i]!;
          // a system with a trajectory spline follows it; others follow mouse/orbit
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
            fx.setEmitter(ex, ey);
          }
          // click-to-spawn: fire a one-shot burst on the active emitter, at the
          // clicked point, this frame (the emitter snaps back next frame).
          if (sysId === activeSysRef.current && spawnReq.current) {
            fx.setEmitter(spawnReq.current.x, spawnReq.current.y);
            fx.spawnBurst(burstCountRef.current);
          }
          fx.update(dt);
        }
        spawnReq.current = null;
        acc += dt; frames++;
        if (acc >= 0.5) {
          for (const fx of handles) alive += fx.aliveCount();
          setHud(`${Math.round(frames / acc)} fps · ${alive.toLocaleString()} alive`);
          acc = 0; frames = 0;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
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
      setHud(String(e));
      void recreate();
    }
  }, [rev]);

  const onMove = (e: React.PointerEvent) => {
    if (panRef.current) {
      setView((v) => ({ ...v, x: panRef.current!.vx + (e.clientX - panRef.current!.cx), y: panRef.current!.vy + (e.clientY - panRef.current!.cy) }));
      return;
    }
    if (!followRef.current) return; // emitter parked unless "follow" is on
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    // map client → canvas pixels via the rect, so it's correct under CSS zoom
    mouseRef.current = [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };
  // spawn `burstCount` on the active emitter at its current position (the button)
  const spawnActive = () => {
    const i = fxSysRef.current.indexOf(activeSysRef.current);
    const h = i >= 0 ? fxRef.current[i] : undefined;
    if (h) h.spawnBurst(burstCountRef.current);
    else fxRef.current.forEach((x) => x.spawnBurst(burstCountRef.current));
  };
  const onPanDown = (e: React.PointerEvent) => {
    if (spawnClickRef.current) {
      // click-to-spawn: record the point in canvas pixels for the loop to fire
      const c = canvasRef.current!;
      const r = c.getBoundingClientRect();
      spawnReq.current = { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
      return;
    }
    if (followRef.current) return; // when following, drag/hover drives the emitter
    panRef.current = { cx: e.clientX, cy: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPanUp = (e: React.PointerEvent) => {
    panRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };
  const onWheel = (e: React.WheelEvent) => {
    setView((v) => ({ ...v, z: Math.min(8, Math.max(0.25, v.z * (e.deltaY < 0 ? 1.12 : 0.893))) }));
  };
  const fitView = () => setView({ z: 1, x: 0, y: 0 });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
        <span className="font-medium">Preview</span>
        <select
          value={backend}
          onChange={(e) => setBackend(e.target.value as BackendChoice)}
          className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground"
          title="Simulation backend — compiled backends run the graph as generated GPU code"
        >
          {(Object.keys(BACKEND_LABEL) as BackendChoice[]).map((k) => (
            <option key={k} value={k}>{BACKEND_LABEL[k]}</option>
          ))}
        </select>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-muted-foreground">{hud}</span>
      </div>
      <div
        className="relative min-h-[340px] flex-1 overflow-hidden bg-black"
        style={{ cursor: spawnClick ? 'crosshair' : view.z !== 1 || view.x !== 0 || view.y !== 0 ? 'grab' : 'default' }}
        onPointerDown={onPanDown}
        onPointerMove={onMove}
        onPointerUp={onPanUp}
        onPointerLeave={() => { mouseRef.current = null; panRef.current = null; }}
        onWheel={onWheel}>
        <canvas
          key={backend}
          ref={canvasRef}
          className="block h-full w-full"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: 'center' }}
        />
        <PathOverlay editing={pathEdit} />
        {pathEdit && (
          <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/70 px-2 py-1 text-[10px] text-[#c4b5fd]">
            drawing path — click to add · drag to move · double-click to delete
          </div>
        )}
        {recompiled !== '' && (
          <div className="pointer-events-none absolute right-2 top-2 rounded-md bg-black/70 px-2 py-1 text-[10px] text-amber-300">
            {recompiled}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-xs">
        <label className="flex items-center gap-1.5" title="Emitter follows the cursor while hovering the preview (off = parked at centre)">
          <input type="checkbox" checked={follow} onChange={(e) => { setFollow(e.target.checked); if (!e.target.checked) mouseRef.current = null; }} /> follow
        </label>
        <label className="flex items-center gap-1.5" title="Move the emitter on a circle — a quick trail test"><input type="checkbox" checked={orbit} onChange={(e) => setOrbit(e.target.checked)} /> orbit</label>
        <span className="mx-1 h-4 w-px bg-border" />
        <input
          type="number" min={1} value={burstCount}
          onChange={(e) => setBurstCount(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
          className="num" style={{ width: 52 }}
          title="Particles per manual burst" />
        <button
          className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Spawn a burst on the active emitter now — the runtime API is handle.spawnBurst(n)"
          onClick={spawnActive}>
          Burst ▸
        </button>
        <label className="flex items-center gap-1.5" title="Click anywhere in the preview to spawn a burst there, on the active emitter">
          <input type="checkbox" checked={spawnClick} onChange={(e) => setSpawnClick(e.target.checked)} /> click-spawn
        </label>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {spawnClick ? 'click to spawn on the active emitter' : follow ? 'following cursor' : orbit ? 'orbiting' : 'parked at centre'}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{Math.round(view.z * 100)}%</span>
        <button
          className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          title="Fit — reset zoom & pan (scroll to zoom, drag to pan)"
          disabled={view.z === 1 && view.x === 0 && view.y === 0}
          onClick={fitView}>
          ⛶ Fit
        </button>
      </div>
    </div>
  );
}
