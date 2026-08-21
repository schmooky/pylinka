/**
 * Full-size curve editor with a live emitter beside it.
 *
 * Shaping a curve against a 54px thumbnail is guesswork — what an artist wants
 * to know is what the particles do. This pops the pad out into a modal with the
 * effect running next to it, updating *while* you drag rather than after you
 * let go.
 *
 * Why the interpreted WebGL backend, and not the compiled one: an ease lives in
 * `structural.ease`, which is part of the graph's structural hash. On the
 * compiled backends a structural change rebuilds the pipelines and resets the
 * particle pool, so streaming edits into one would blank the effect on every
 * frame of a drag — the destroy-and-respawn flicker, sixty times a second. The
 * interpreted backend samples any non-preset ease into a LUT uniform instead
 * (see EASE_LUT_N in core/webgl/shaders.ts), so a curve edit is a uniform
 * upload: no recompile, no pool reset, no lost particles. `handle.apply()` is
 * the supported live-edit path and does exactly that.
 *
 * The tradeoff is honest and surfaced in the UI: that backend recognises ease
 * on the colour / size / alpha over-life family, so a curve on any other node
 * shapes the exported effect but is not reflected in this preview.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createParticles, type ParticlesHandle } from '@pylinka/core/webgl';
import type { EditorProject } from '../types';
import { useEditor } from '../store';
import { buildAtlas, buildMask, effective } from './Preview';
import { CurveEditor, PresetGrid, easeLabel } from './CurvePicker';

/** Node kinds whose ease the interpreted preview actually maps to a uniform. */
const LIVE_KINDS = new Set([
  'gen.colorOverLife',
  'gen.scaleOverLife',
  'gen.alphaOverLife',
  'gen.numberOverLife',
  'gen.curveOverLife',
]);

export function CurveModal({
  nodeId,
  nodeLabel,
  value,
  onChange,
  onClose,
}: {
  nodeId: string;
  nodeLabel: string;
  value: string;
  onChange(key: string): void;
  onClose(): void;
}) {
  const project = useEditor((s) => s.project);
  const activeSystemId = useEditor((s) => s.activeSystemId);
  // The curve being shown in the preview. Tracks the drag; `value` only catches
  // up on pointer-up, because every commit is a structural write to the store.
  const [live, setLive] = useState(value);
  useEffect(() => setLive(value), [value]);

  const sys = useMemo(
    () => project.systems.find((s) => s.id === activeSystemId) ?? project.systems[0],
    [project, activeSystemId],
  );
  const reflected = useMemo(() => {
    const node = sys?.graph.nodes.find((n) => n.id === nodeId);
    return node ? LIVE_KINDS.has(node.kind) : false;
  }, [sys, nodeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}>
      <div
        className="flex max-h-full gap-4 overflow-auto rounded-xl border p-4 shadow-2xl"
        style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="flex flex-col" style={{ width: 420 }}>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-sm font-medium">{nodeLabel}</span>
            <span className="text-[11px] text-muted-foreground">{easeLabel(value)}</span>
            <button
              className="ml-auto text-muted-foreground hover:text-foreground"
              onClick={onClose}
              title="Close (Esc)">
              ✕
            </button>
          </div>
          <CurveEditor seed={value} onCommit={onChange} onPreview={setLive} width={420} height={330} />
          <div className="mt-3">
            <PresetGrid value={value} onChange={onChange} cols={7} />
          </div>
          <input
            className="num mt-3 w-full text-center"
            value={value}
            spellCheck={false}
            title="Ease key — a preset name, cubic-bezier(x1,y1,x2,y2), or curve(...)"
            onChange={(e) => onChange(e.target.value.trim())}
          />
        </div>

        <div className="flex flex-col" style={{ width: 400 }}>
          <div className="mb-2 flex items-center gap-2 text-[11px]">
            <span className="font-medium">Live preview</span>
            <span className="text-muted-foreground">{sys?.name}</span>
          </div>
          {sys ? (
            <LivePreview project={project} systemId={sys.id} nodeId={nodeId} easeKey={live} />
          ) : (
            <div className="text-[11px] text-muted-foreground">No system to preview.</div>
          )}
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
            {reflected
              ? 'Updates as you drag — the interpreted backend takes a custom curve as a lookup uniform, so nothing is recompiled and no particles are lost.'
              : 'This node’s ease is not reflected here: the interpreted preview maps ease onto the colour, size and alpha over-life nodes. The curve still applies to the exported effect.'}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One system, running on its own canvas, re-applied whenever the ease moves. */
function LivePreview({
  project,
  systemId,
  nodeId,
  easeKey,
}: {
  project: EditorProject;
  systemId: string;
  nodeId: string;
  easeKey: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<ParticlesHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The project with the in-progress curve patched into the edited node. */
  const patched = useMemo((): EditorProject => {
    const eff = effective(project);
    return {
      ...eff,
      systems: eff.systems.map((s) =>
        s.id !== systemId
          ? s
          : {
              ...s,
              graph: {
                ...s.graph,
                nodes: s.graph.nodes.map((n) =>
                  n.id === nodeId ? { ...n, structural: { ...n.structural, ease: easeKey } } : n,
                ),
              },
            },
      ),
    };
  }, [project, systemId, nodeId, easeKey]);

  const patchedRef = useRef(patched);
  patchedRef.current = patched;

  // create once per system; the rAF loop lives for as long as the modal does
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let raf = 0;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = () => {
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
    };
    size();

    void (async () => {
      const proj = patchedRef.current;
      const sys = proj.systems.find((s) => s.id === systemId);
      if (!sys) return;
      let atlas, mask;
      try {
        atlas = await buildAtlas(proj, sys);
        mask = await buildMask(proj, sys);
      } catch {
        /* texture/mask failed to load → soft sprite / analytic shape */
      }
      if (disposed) return;
      try {
        fxRef.current = createParticles(canvas, proj, {
          systemName: sys.name,
          ...(atlas ? { atlas } : {}),
          ...(mask ? { emissionMask: mask } : {}),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }

      let last = performance.now();
      const loop = (now: number) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        const fx = fxRef.current;
        if (fx) {
          fx.setEmitter(canvas.width / 2, canvas.height * 0.62);
          fx.update(dt);
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      fxRef.current?.destroy();
      fxRef.current = null;
    };
  }, [systemId]);

  // stream edits in. apply() is the zero-recompile path: it re-reads params and
  // uploads uniforms, keeping every particle currently in flight.
  useEffect(() => {
    fxRef.current?.apply(patched);
  }, [patched]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="w-full rounded-md bg-black"
        style={{ height: 330 }}
      />
      {error && <div className="mt-1 text-[10px] text-red-400">{error}</div>}
    </>
  );
}
