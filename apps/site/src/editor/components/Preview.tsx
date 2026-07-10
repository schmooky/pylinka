import { useEffect, useRef, useState } from 'react';
import { createParticles, type ParticlesHandle } from '@pylinka/core/webgl';
import { useEditor } from '../store';

export function Preview() {
  const project = useEditor((s) => s.project);
  const rev = useEditor((s) => s.rev);
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

  // init once
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

    try {
      fxRef.current = createParticles(canvas, projRef.current);
    } catch (e) {
      setHud(String(e));
      return;
    }
    const init: Record<string, number> = {};
    for (const p of projRef.current.params) if (p.default.t === 'f32') init[p.name] = p.default.v;
    setKnobs(init);

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

  // live re-apply on graph changes
  useEffect(() => {
    const fx = fxRef.current;
    if (!fx) return;
    if (!fx.apply(project)) {
      // capacity changed → full re-create
      fx.destroy();
      try {
        fxRef.current = createParticles(canvasRef.current!, project);
        for (const [n, v] of Object.entries(knobs)) fxRef.current.setKnob(n, v);
      } catch (e) {
        setHud(String(e));
      }
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
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
        <span className="font-medium">Preview</span>
        <span className="font-mono text-muted-foreground">{hud}</span>
      </div>
      <div className="relative bg-black" style={{ height: 300 }}>
        <canvas ref={canvasRef} className="block h-full w-full" onPointerMove={onMove} onPointerLeave={() => (mouseRef.current = null)} />
      </div>
      <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-xs">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={orbit} onChange={(e) => setOrbit(e.target.checked)} /> orbit</label>
        <button className="rounded-md border border-border px-2 py-1 hover:bg-accent" onClick={() => fxRef.current?.spawnBurst(400)}>Burst</button>
        <span className="text-muted-foreground">move mouse over canvas</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
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
      </div>
    </div>
  );
}
