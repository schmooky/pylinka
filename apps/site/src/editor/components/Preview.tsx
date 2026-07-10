import { useEffect, useRef, useState } from 'react';
import { createParticles, type AtlasOptions, type ParticlesHandle } from '@pylinka/core/webgl';
import { useEditor } from '../store';
import { frameSize, type EditorProject } from '../types';
import { Assets } from './Assets';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

async function buildAtlas(proj: EditorProject): Promise<AtlasOptions | undefined> {
  const t = (proj.textures ?? []).find((x) => x.id === proj.activeTextureId);
  if (!t) return undefined;
  const image = await loadImage(t.src);
  const { frameW, frameH } = frameSize(t);
  return { image, width: t.width, height: t.height, cols: t.cols, rows: t.rows, frameW, frameH, pad: t.pad, fps: t.fps, play: t.play, pick: t.pick };
}

export function Preview() {
  const project = useEditor((s) => s.project);
  const rev = useEditor((s) => s.rev);
  const texRev = useEditor((s) => s.texRev);
  const params = useEditor((s) => s.project.params);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<ParticlesHandle | null>(null);
  const projRef = useRef(project);
  projRef.current = project;

  const [orbit, setOrbit] = useState(true);
  const orbitRef = useRef(orbit);
  orbitRef.current = orbit;
  const mouseRef = useRef<[number, number] | null>(null);
  const [hud, setHud] = useState('');
  const [knobs, setKnobs] = useState<Record<string, number>>({});
  const knobsRef = useRef(knobs);
  knobsRef.current = knobs;
  const [tab, setTab] = useState<'knobs' | 'assets'>('knobs');

  // (re)create the particle handle, loading the active texture atlas if any
  const recreate = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    fxRef.current?.destroy();
    fxRef.current = null;
    const proj = projRef.current;
    let atlas: AtlasOptions | undefined;
    try {
      atlas = await buildAtlas(proj);
    } catch {
      /* texture failed to load → soft sprite */
    }
    try {
      fxRef.current = createParticles(canvas, proj, atlas ? { atlas } : {});
      for (const [n, v] of Object.entries(knobsRef.current)) fxRef.current.setKnob(n, v);
    } catch (e) {
      setHud(String(e));
    }
  };

  // init once: size canvas, seed knobs, start the loop, create the handle
  useEffect(() => {
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
    setKnobs(init);
    knobsRef.current = init;
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
      const fx = fxRef.current;
      if (fx) {
        if (mouseRef.current) fx.setEmitter(mouseRef.current[0], mouseRef.current[1]);
        else if (orbitRef.current) {
          const cx = canvas.width / 2, cy = canvas.height / 2;
          const r = Math.min(canvas.width, canvas.height) * 0.28;
          fx.setEmitter(cx + Math.cos(t * 1.8) * r, cy + Math.sin(t * 1.8) * r);
        } else fx.setEmitter(canvas.width / 2, canvas.height / 2);
        fx.update(dt);
        acc += dt; frames++;
        if (acc >= 0.5) { setHud(`${Math.round(frames / acc)} fps · ${fx.aliveCount().toLocaleString()} alive`); acc = 0; frames = 0; }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); fxRef.current?.destroy(); fxRef.current = null; };
  }, []);

  // texture set changed → full re-create (atlas is a construction-time input)
  const firstTex = useRef(true);
  useEffect(() => {
    if (firstTex.current) {
      firstTex.current = false;
      return; // the init effect already created the handle
    }
    void recreate();
  }, [texRev]);

  // graph/value change → live re-apply (or re-create on capacity change)
  useEffect(() => {
    const fx = fxRef.current;
    if (!fx) return;
    if (!fx.apply(project)) void recreate();
  }, [rev]);

  const onMove = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    mouseRef.current = [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
        <span className="font-medium">Preview</span>
        <span className="font-mono text-muted-foreground">{hud}</span>
      </div>
      <div className="relative min-h-[340px] flex-1 bg-black">
        <canvas ref={canvasRef} className="block h-full w-full" onPointerMove={onMove} onPointerLeave={() => (mouseRef.current = null)} />
      </div>
      <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-xs">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={orbit} onChange={(e) => setOrbit(e.target.checked)} /> orbit</label>
        <button className="rounded-md border border-border px-2 py-1 hover:bg-accent" onClick={() => fxRef.current?.spawnBurst(400)}>Burst</button>
        <span className="text-muted-foreground">move mouse over canvas</span>
      </div>
      <div className="flex border-b border-border text-xs">
        {(['knobs', 'assets'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 border-b-2 py-2 capitalize ${tab === k ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {k}
          </button>
        ))}
      </div>
      <div className="max-h-64 shrink-0 overflow-y-auto p-3">
        {tab === 'assets' ? (
          <Assets />
        ) : (
          <>
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Knobs</div>
            {params.length === 0 && <div className="text-xs text-muted-foreground">No knobs. Promote a value or add param.ref nodes.</div>}
            {params.map((p) => {
              const min = p.min ?? 0;
              const max = p.max ?? 1;
              const val = knobs[p.name] ?? (p.default.t === 'f32' ? p.default.v : 0);
              return (
                <div key={p.id} className="mb-2">
                  <div className="mb-1 flex justify-between text-xs">
                    <span>{p.name}</span>
                    <span className="font-mono text-muted-foreground">{val.toFixed(2)}{p.unit ? ' ' + p.unit : ''}</span>
                  </div>
                  <input type="range" className="w-full" min={min} max={max} step={(max - min) / 200 || 0.01} value={val}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setKnobs((k) => ({ ...k, [p.name]: v }));
                      fxRef.current?.setKnob(p.name, v);
                    }} />
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
