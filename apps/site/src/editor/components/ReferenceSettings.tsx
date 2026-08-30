/**
 * Scene-reference controls, in Settings rather than floating over the preview.
 *
 * These used to live in a popover anchored to the preview's tool palette, which
 * meant the reference could only be adjusted from one place and the popover had
 * to steal the pointer to allow dragging. It is configuration, so it sits with
 * the rest of the configuration; the image itself is still dragged directly on
 * the preview whenever Settings is open.
 */
import { useEditor } from '../store';
import { addReferenceFile, usePreviewBackground, useReference } from '../reference';

const EMPTY: never[] = [];

/**
 * The backdrop the effect is judged against.
 *
 * This is not decoration. A transparent canvas over solid black is the worst
 * case for a light blend mode: additive means "add to what is behind", and
 * adding to black is indistinguishable from covering it — which is how `add`
 * managed to look broken for so long. A checkerboard says "transparent" the way
 * every art tool does, and a solid colour checks the effect against the tone it
 * will actually play on.
 */
export function BackgroundSettings() {
  const bg = usePreviewBackground();
  const set = useEditor((s) => s.setPreviewBackground);

  return (
    <div className="flex flex-col gap-3 text-xs">
      <label className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-muted-foreground">checker</span>
        <input
          type="color"
          className="h-6 w-12 cursor-pointer rounded border border-border bg-transparent"
          value={bg.a}
          onChange={(e) => set({ a: e.target.value })}
        />
        <input
          type="color"
          className="h-6 w-12 cursor-pointer rounded border border-border bg-transparent"
          value={bg.b}
          onChange={(e) => set({ b: e.target.value })}
        />
        <span className="font-mono text-[10px] text-muted-foreground">
          {bg.a} {bg.b}
        </span>
      </label>
      <label className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-muted-foreground">square</span>
        <input
          className="num"
          type="number"
          min={2}
          max={128}
          value={bg.size}
          onChange={(e) => set({ size: Math.min(128, Math.max(2, Number(e.target.value) || 16)) })}
        />
        <span className="text-[10px] text-muted-foreground">px — set both colours the same for a flat backdrop</span>
      </label>
      <p className="leading-relaxed text-muted-foreground">
        Drawn INTO the canvas, not behind it. A light blend mode adds to the pixels in the same
        buffer, so this is what <code>add</code> and <code>screen</code> are actually adding to —
        behind the canvas it would look like a backdrop while those modes carried on as if it were
        black. Avoid pure black for the same reason. Editor-only: the runtime draws on whatever your
        game puts behind it.
      </p>
    </div>
  );
}

export function ReferenceSettings() {
  const ref = useReference();
  const images = useEditor((s) => s.project.references) ?? EMPTY;
  const setReference = useEditor((s) => s.setReference);
  const removeReference = useEditor((s) => s.removeReference);
  const setAssetsOpen = useEditor((s) => s.setAssetsOpen);

  return (
    <div className="flex flex-col gap-3 text-xs">
      <label className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-muted-foreground">image</span>
        <select
          className="sel sel-wide"
          value={ref.id ?? ''}
          onChange={(e) => setReference({ id: e.target.value || null })}>
          <option value="">— none —</option>
          {images.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {r.width}×{r.height}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <label
          className="flex-1 cursor-pointer rounded-md border border-dashed border-border py-2 text-center text-muted-foreground hover:bg-accent hover:text-foreground"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = [...(e.dataTransfer.files ?? [])].find((x) => x.type.startsWith('image/'));
            if (f) void addReferenceFile(f);
          }}>
          + Add reference image
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && void addReferenceFile(e.target.files[0])}
          />
        </label>
        <button
          className="rounded-md border border-border px-3 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setAssetsOpen(true)}>
          Manage…
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
          <div className="flex flex-wrap items-center gap-1.5">
            <Toggle on={ref.visible} onClick={() => setReference({ visible: !ref.visible })}>
              {ref.visible ? 'shown' : 'hidden'}
            </Toggle>
            <button
              className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setReference({ offset: [0, 0], scale: 1 })}>
              Reset fit
            </button>
            <button
              className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:text-destructive"
              onClick={() => ref.id && removeReference(ref.id)}>
              Delete image
            </button>
          </div>
          <p className="leading-relaxed text-muted-foreground">
            Drag the image on the preview to position it — it takes the pointer while Settings is
            open, and goes inert again when you close this.
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
