import { useState } from 'react';
import { useEditor } from '../store';
import type { EmitterPathData } from '../types';
import { MaskEditor } from './MaskEditor';

/**
 * "Emitter" tab: where particles are born (painted emission area) and how the
 * emitter moves (trajectory spline drawn on the preview canvas).
 */
interface EmitterPanelProps {
  pathEdit: boolean;
  setPathEdit(v: boolean): void;
}

const DEFAULT_PATH: EmitterPathData = { points: [], duration: 4, mode: 'loop', closed: false };

export function EmitterPanel({ pathEdit, setPathEdit }: EmitterPanelProps) {
  const systemName = useEditor((s) => s.system().name);
  const mask = useEditor((s) => (s.project.systemMasks ?? {})[s.activeSystemId] ?? null);
  const path = useEditor((s) => (s.project.systemPaths ?? {})[s.activeSystemId] ?? null);
  const setMask = useEditor((s) => s.setMask);
  const setPath = useEditor((s) => s.setPath);
  const emitter = useEditor((s) => s.system().emitter);
  const setEmitter = useEditor((s) => s.setEmitter);
  const [maskOpen, setMaskOpen] = useState(false);
  const burst = emitter.burst ?? { count: 120, interval: 1.5 };
  // where this emitter's particles come from: the cursor, or another emitter's
  // particles at the moment they are born or die
  const systems = useEditor((s) => s.project.systems);
  const activeId = useEditor((s) => s.activeSystemId);
  const parentId = useEditor((s) => (s.project.subEmitters ?? {})[s.activeSystemId] ?? '');
  const setSubParent = useEditor((s) => s.setSubParent);
  const setSubTrigger = useEditor((s) => s.setSubTrigger);
  const trigger = useEditor((s) => {
    const sys = s.project.systems.find((x) => x.id === s.activeSystemId);
    return sys?.graph.nodes.find((n) => n.kind === 'output.deathBurst')?.structural?.on === 'birth'
      ? 'birth'
      : 'death';
  });
  const parentChoices = systems.filter((s) => s.id !== activeId);

  const patchPath = (patch: Partial<EmitterPathData>) => setPath({ ...(path ?? DEFAULT_PATH), ...patch });

  return (
    <div className="text-xs">
      {/* ---- where particles come from ---- */}
      {parentChoices.length > 0 && (
        <>
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Born from
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <select
              className="sel sel-wide"
              value={parentId}
              onChange={(e) => setSubParent(activeId, e.target.value || null)}>
              <option value="">the cursor / this emitter</option>
              {parentChoices.map((s) => (
                <option key={s.id} value={s.id}>
                  particles of “{s.name}”
                </option>
              ))}
            </select>
            {parentId !== '' && (
              <select
                className="sel sel-wide"
                value={trigger}
                title="Which moment in the parent particle's life spawns one of these"
                onChange={(e) => setSubTrigger(e.target.value as 'death' | 'birth')}>
                <option value="death">on their deaths</option>
                <option value="birth">on their births</option>
              </select>
            )}
          </div>
        </>
      )}

      {/* ---- spawn (how many & how) ---- */}
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Spawn — “{systemName}”
      </div>
      {/*
        These modes all run BY THEMSELVES. "burst" in particular repeats — it is
        a batch every interval, not a batch when you ask — and calling it that
        next to a preview tool also called Burst made it read as manual, so an
        emitter firing on its own clock looked like the tool misbehaving. The
        labels say when each one fires.
      */}
      <div className="mb-2 flex overflow-hidden rounded-md border border-border">
        {(
          [
            ['flow', 'stream', 'a continuous stream, at a rate you set'],
            ['burst', 'repeating', 'a batch every interval, on its own clock — this one keeps going'],
            ['once', 'once', 'a single batch when the effect starts, then nothing'],
          ] as const
        ).map(([m, label, hint]) => (
          <button
            key={m}
            title={hint}
            onClick={() => setEmitter(m === 'flow' ? { mode: 'flow' } : { mode: m, burst })}
            className={`flex-1 py-1.5 ${emitter.mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>
            {label}
          </button>
        ))}
      </div>
      <p className="mb-3 text-[10px] leading-relaxed text-muted-foreground">
        {emitter.mode === 'flow'
          ? `Emits ${emitter.rate} particles a second for as long as it runs.`
          : emitter.mode === 'burst'
            ? `Emits ${burst.count} particles every ${burst.interval}s, over and over, without being asked. Use “once” if you want to fire it yourself with the preview's Spawn tool.`
            : 'Emits one batch at the start and then stops. Use the preview’s Spawn tool to fire more, wherever you click.'}
      </p>
      {emitter.mode === 'flow' ? (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] text-muted-foreground">rate (particles/s)</span>
            <input className="num" type="number" min={0} value={emitter.rate}
              onChange={(e) => setEmitter({ rate: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] text-muted-foreground">over distance (/px)</span>
            <input className="num" type="number" min={0} step={0.1} value={emitter.rateOverDistance ?? 0}
              onChange={(e) => setEmitter({ rateOverDistance: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        </div>
      ) : (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] text-muted-foreground">count (per burst)</span>
            <input className="num" type="number" min={0} value={burst.count}
              onChange={(e) => setEmitter({ burst: { ...burst, count: Math.max(0, Number(e.target.value) || 0) } })} />
          </label>
          {emitter.mode === 'burst' && (
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] text-muted-foreground">every (seconds)</span>
              <input className="num" type="number" min={0.05} step={0.1} value={burst.interval}
                onChange={(e) => setEmitter({ burst: { ...burst, interval: Math.max(0.05, Number(e.target.value) || 1) } })} />
            </label>
          )}
        </div>
      )}

      {/* ---- trajectory ---- */}
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Trajectory of “{systemName}”
      </div>
      <div className="mb-1 flex items-center gap-2">
        <button
          className={`rounded-md border px-2.5 py-1.5 ${pathEdit ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-accent'}`}
          onClick={() => setPathEdit(!pathEdit)}>
          {pathEdit ? 'Done drawing' : path?.points.length ? 'Edit path' : 'Draw path'}
        </button>
        {path && path.points.length > 0 && (
          <button className="rounded-md border border-border px-2.5 py-1.5 text-muted-foreground hover:bg-accent"
            onClick={() => { setPath(null); setPathEdit(false); }}>
            Clear path
          </button>
        )}
        <span className="text-muted-foreground">
          {pathEdit
            ? 'click the preview to add points · drag to move · double-click to delete'
            : path?.points.length
              ? `${path.points.length} points — emitter follows the spline`
              : 'no path — the emitter sits at the centre, or follows the cursor with the preview\u2019s Follow tool'}
        </span>
      </div>
      {path && path.points.length >= 2 && (
        <div className="mb-3 flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-muted-foreground">
            duration
            <input className="num" style={{ width: 52 }} type="number" min={0.1} step={0.5} value={path.duration}
              onChange={(e) => patchPath({ duration: Math.max(0.1, Number(e.target.value) || 4) })} />
            s
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            mode
            <select className="sel" value={path.mode}
              onChange={(e) => patchPath({ mode: e.target.value as EmitterPathData['mode'] })}>
              <option value="loop">loop</option>
              <option value="pingpong">ping-pong</option>
              <option value="once">once</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            <input type="checkbox" checked={path.closed} onChange={(e) => patchPath({ closed: e.target.checked })} />
            closed loop
          </label>
        </div>
      )}

      {/* ---- emission area ---- */}
      <div className="mb-2 mt-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Emission area
      </div>
      <div className="flex items-center gap-2">
        {mask ? (
          <>
            <img src={mask.src} alt="emission mask"
              className="h-12 w-16 rounded border border-border object-contain"
              style={{ background: 'repeating-conic-gradient(#1c1c1f 0% 25%, #232327 0% 50%) 0 0 / 12px 12px' }} />
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">{Math.round(mask.width)}px wide, centred on the emitter</span>
              <div className="flex gap-2">
                <button className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-accent" onClick={() => setMaskOpen(true)}>
                  Edit…
                </button>
                <button className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-accent" onClick={() => setMask(null)}>
                  Clear
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <button className="rounded-md border border-dashed border-border px-3 py-2 text-muted-foreground hover:bg-accent" onClick={() => setMaskOpen(true)}>
              + Paint area / load image
            </button>
            <span className="text-muted-foreground">particles spawn only inside the painted area</span>
          </>
        )}
      </div>

      {maskOpen && (
        <MaskEditor
          initial={mask}
          onClose={() => setMaskOpen(false)}
          onSave={(m) => { setMask(m); setMaskOpen(false); }}
        />
      )}
    </div>
  );
}
