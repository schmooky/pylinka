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

  const patchPath = (patch: Partial<EmitterPathData>) => setPath({ ...(path ?? DEFAULT_PATH), ...patch });

  return (
    <div className="text-xs">
      {/* ---- spawn (how many & how) ---- */}
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Spawn — “{systemName}”
      </div>
      <div className="mb-2 flex overflow-hidden rounded-md border border-border">
        {(
          [
            ['flow', 'automatic'],
            ['burst', 'burst'],
            ['once', 'once'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            title={m === 'flow' ? 'continuous stream at a rate' : m === 'burst' ? 'a batch of particles every interval' : 'a single batch at the start'}
            onClick={() => setEmitter(m === 'flow' ? { mode: 'flow' } : { mode: m, burst })}
            className={`flex-1 py-1.5 ${emitter.mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>
            {label}
          </button>
        ))}
      </div>
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
              : 'no path — emitter follows the mouse / orbit'}
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
