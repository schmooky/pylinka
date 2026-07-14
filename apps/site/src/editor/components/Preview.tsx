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
import { frameSize, type EditorProject } from '../types';
import { Assets } from './Assets';
import { Knobs } from './Knobs';
import { EmitterPanel } from './EmitterPanel';
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

  const [orbit, setOrbit] = useState(true);
  const orbitRef = useRef(orbit);
  orbitRef.current = orbit;
  const mouseRef = useRef<[number, number] | null>(null);
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
  const [knobs, setKnobs] = useState<Record<string, number>>({});
  const knobsRef = useRef(knobs);
  knobsRef.current = knobs;
  const [tab, setTab] = useState<'knobs' | 'emitter' | 'assets'>('knobs');
  const [pathEdit, setPathEdit] = useState(false);

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

    const byId = new Map<string, ParticlesHandle>();
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
            ...(subParent ? { subParent } : {}),
          });
          byId.set(sys.id, wh);
          h = wh;
        } else {
          // compiled path: the whole graph runs as generated GPU code. Masks
          // and sub-emitter wiring are still interpreted-only extras; animated
          // atlases (frame-over-life + per-particle row) are now supported.
          h = await createCompiledParticles(canvas, effective(proj), {
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
            onRecompile: flashRecompile,
          });
        }
        h.autoClear = i === 0;
        for (const [n, v] of Object.entries(knobsRef.current)) h.setKnob(n, v);
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
    const seeded = Object.keys(knobsRef.current).length > 0 ? knobsRef.current : init;
    setKnobs(seeded);
    knobsRef.current = seeded;
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
          fx.update(dt);
        }
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
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    mouseRef.current = [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
  };

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
      <div className="relative min-h-[340px] flex-1 bg-black">
        <canvas key={backend} ref={canvasRef} className="block h-full w-full" onPointerMove={onMove} onPointerLeave={() => (mouseRef.current = null)} />
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
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={orbit} onChange={(e) => setOrbit(e.target.checked)} /> orbit</label>
        <button className="rounded-md border border-border px-2 py-1 hover:bg-accent" onClick={() => fxRef.current.forEach((h) => h.spawnBurst(400))}>Burst</button>
        <span className="text-muted-foreground">
          {backend === 'webgl'
            ? 'move mouse over canvas'
            : 'compiled graph · masks/sub-emitters are interpreted-only'}
        </span>
      </div>
      <div className="flex border-b border-border text-xs">
        {(['knobs', 'emitter', 'assets'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 border-b-2 py-2 capitalize ${tab === k ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {k}
          </button>
        ))}
      </div>
      <div className="max-h-[42vh] shrink-0 overflow-y-auto p-3">
        {tab === 'assets' ? (
          <Assets />
        ) : tab === 'emitter' ? (
          <EmitterPanel pathEdit={pathEdit} setPathEdit={setPathEdit} />
        ) : (
          <Knobs values={knobs} onSet={(name, v) => {
            setKnobs((k) => ({ ...k, [name]: v }));
            fxRef.current.forEach((h) => h.setKnob(name, v));
          }} />
        )}
      </div>
    </div>
  );
}
