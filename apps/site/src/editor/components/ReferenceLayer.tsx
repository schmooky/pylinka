/**
 * Scene reference: the artwork the effect actually has to sit on. An effect
 * authored against a black preview is a guess — the scale reads wrong, the
 * colours fight the background, and the first time anyone finds out is in the
 * game. This drops the real screenshot under (or over) the particles.
 *
 * The image lives in the project's asset library, so the same background is one
 * click away in every effect authored for that screen. It is EDITOR-ONLY: the
 * runtime never sees it, and a pure pylinka consumer ignores the extra JSON.
 */
import { useRef } from 'react';
import { useEditor } from '../store';
import { addReferenceFile, useReference } from '../reference';

const EMPTY: never[] = [];

/**
 * The image itself, laid over the preview area under the SAME view transform as
 * the canvas — so panning and zooming the preview keeps the effect registered
 * against the artwork instead of sliding off it.
 *
 * `draggable` is on only while the reference panel is open: the rest of the time
 * the layer is inert, so it never steals a pan or a click-to-spawn.
 */
export function ReferenceLayer({
  view,
  draggable,
}: {
  view: { z: number; x: number; y: number };
  draggable: boolean;
}) {
  const ref = useReference();
  const images = useEditor((s) => s.project.references) ?? EMPTY;
  const setReference = useEditor((s) => s.setReference);
  const img = ref.id ? images.find((r) => r.id === ref.id) : undefined;
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  if (!img || !ref.visible || ref.opacity <= 0) return null;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
        transformOrigin: 'center',
        // behind the canvas by default; in front when checking what the effect
        // has to stay readable through
        zIndex: ref.front ? 3 : 0,
        pointerEvents: 'none',
      }}>
      <img
        src={img.src}
        alt=""
        draggable={false}
        className="absolute left-1/2 top-1/2 max-h-full max-w-full object-contain"
        style={{
          // the drag delta is measured in SCREEN px, so divide by the view zoom
          transform: `translate(-50%, -50%) translate(${ref.offset[0]}px, ${ref.offset[1]}px) scale(${ref.scale})`,
          opacity: ref.opacity,
          pointerEvents: draggable ? 'auto' : 'none',
          cursor: draggable ? 'move' : 'default',
        }}
        onPointerDown={(e) => {
          if (!draggable) return;
          e.stopPropagation();
          drag.current = { px: e.clientX, py: e.clientY, ox: ref.offset[0], oy: ref.offset[1] };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          e.stopPropagation();
          setReference({
            offset: [
              drag.current.ox + (e.clientX - drag.current.px) / view.z,
              drag.current.oy + (e.clientY - drag.current.py) / view.z,
            ],
          });
        }}
        onPointerUp={(e) => {
          drag.current = null;
          (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        }}
      />
    </div>
  );
}

/** Floating controls for the reference — opened from the preview's tool palette. */
export function ReferencePanel({ onClose }: { onClose(): void }) {
  const ref = useReference();
  const images = useEditor((s) => s.project.references) ?? EMPTY;
  const setReference = useEditor((s) => s.setReference);
  const removeReference = useEditor((s) => s.removeReference);
  const setAssetsOpen = useEditor((s) => s.setAssetsOpen);

  return (
    <div
      className="absolute left-12 top-2 z-30 w-64 rounded-lg border p-2.5 text-[11px] shadow-xl"
      style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-foreground)' }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold">Scene reference</span>
        <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <select
        className="sel mb-2 w-full"
        value={ref.id ?? ''}
        onChange={(e) => setReference({ id: e.target.value || null })}
        aria-label="Reference image">
        <option value="">— none —</option>
        {images.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} · {r.width}×{r.height}
          </option>
        ))}
      </select>

      <div className="mb-2 flex gap-1.5">
        <label
          className="flex-1 cursor-pointer rounded-md border border-dashed py-1 text-center text-muted-foreground hover:bg-black/20"
          style={{ borderColor: 'var(--color-border)' }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = [...(e.dataTransfer.files ?? [])].find((x) => x.type.startsWith('image/'));
            if (f) void addReferenceFile(f);
          }}>
          + Add image
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && void addReferenceFile(e.target.files[0])}
          />
        </label>
        <button
          className="rounded-md border px-2 py-1 text-muted-foreground hover:bg-black/20 hover:text-foreground"
          style={{ borderColor: 'var(--color-border)' }}
          title="Manage the reference library in Assets"
          onClick={() => setAssetsOpen(true)}>
          Assets…
        </button>
      </div>

      {ref.id !== null && (
        <>
          <Slider
            label="opacity"
            value={ref.opacity}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(opacity) => setReference({ opacity })}
          />
          <Slider
            label="scale"
            value={ref.scale}
            min={0.1}
            max={4}
            step={0.01}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(scale) => setReference({ scale })}
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Toggle on={ref.visible} onClick={() => setReference({ visible: !ref.visible })}>
              {ref.visible ? '👁 shown' : '👁 hidden'}
            </Toggle>
            <Toggle on={ref.front} onClick={() => setReference({ front: !ref.front })}>
              {ref.front ? 'in front' : 'behind'}
            </Toggle>
            <button
              className="rounded-md border px-2 py-1 text-muted-foreground hover:bg-black/20 hover:text-foreground"
              style={{ borderColor: 'var(--color-border)' }}
              onClick={() => setReference({ offset: [0, 0], scale: 1 })}>
              Reset fit
            </button>
            <button
              className="rounded-md border px-2 py-1 text-muted-foreground hover:bg-black/20 hover:text-destructive"
              style={{ borderColor: 'var(--color-border)' }}
              title="Remove this image from the project"
              onClick={() => ref.id && removeReference(ref.id)}>
              Delete
            </button>
          </div>
          <p className="mt-2 leading-relaxed text-muted-foreground">
            Drag the image to position it. While this panel is open the reference takes the pointer —
            close it to go back to panning and spawning.
          </p>
        </>
      )}
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-2 py-1 ${on ? 'text-foreground' : 'text-muted-foreground'} hover:bg-black/20`}
      style={{ borderColor: on ? 'var(--color-foreground)' : 'var(--color-border)' }}>
      {children}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format(v: number): string;
  onChange(v: number): void;
}) {
  return (
    <label className="mt-1.5 flex items-center gap-2">
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      <input
        type="range"
        className="min-w-0 flex-1"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="w-10 shrink-0 text-right font-mono text-muted-foreground">{format(value)}</span>
    </label>
  );
}
