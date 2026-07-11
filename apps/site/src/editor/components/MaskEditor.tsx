import { useEffect, useRef, useState } from 'react';
import type { EmissionMaskData } from '../types';

/**
 * Paint-an-emission-area modal. White (opaque) pixels = spawn positions.
 * Draw with a soft round brush, erase, or stamp an uploaded image's alpha
 * (falling back to luminance for fully opaque images) as the starting mask.
 */
const W = 384;
const H = 288;

interface MaskEditorProps {
  initial: EmissionMaskData | null;
  onSave(mask: EmissionMaskData): void;
  onClose(): void;
}

export function MaskEditor({ initial, onSave, onClose }: MaskEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [brush, setBrush] = useState(28);
  const [erase, setErase] = useState(false);
  const [worldW, setWorldW] = useState(initial?.width ?? 320);
  const painting = useRef(false);
  const last = useRef<[number, number] | null>(null);

  useEffect(() => {
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    if (initial) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, W, H);
      img.src = initial.src;
    }
  }, []);

  // stamp dabs from the previous point to (x, y) so fast strokes stay solid
  const stroke = (x: number, y: number) => {
    const from = last.current ?? [x, y];
    const dist = Math.hypot(x - from[0], y - from[1]);
    const step = Math.max(brush / 4, 2);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) dab(from[0] + ((x - from[0]) * i) / n, from[1] + ((y - from[1]) * i) / n);
    last.current = [x, y];
  };

  const dab = (x: number, y: number) => {
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    const g = ctx.createRadialGradient(x, y, brush * 0.15, x, y, brush / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  };

  const toLocal = (e: React.PointerEvent): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };

  const stampImage = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // fit-contain into the paint canvas
      const k = Math.min(W / img.naturalWidth, H / img.naturalHeight);
      const dw = img.naturalWidth * k;
      const dh = img.naturalHeight * k;
      const dx = (W - dw) / 2;
      const dy = (H - dh) / 2;
      // read the image once to decide: alpha mask, or luminance for opaque images
      const tmp = document.createElement('canvas');
      tmp.width = Math.max(1, Math.round(dw));
      tmp.height = Math.max(1, Math.round(dh));
      const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
      tctx.drawImage(img, 0, 0, tmp.width, tmp.height);
      const px = tctx.getImageData(0, 0, tmp.width, tmp.height);
      const d = px.data;
      let hasAlpha = false;
      for (let i = 3; i < d.length; i += 4) if (d[i]! < 250) { hasAlpha = true; break; }
      for (let i = 0; i < d.length; i += 4) {
        const a = hasAlpha ? d[i + 3]! : Math.round(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!);
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = a;
      }
      tctx.putImageData(px, 0, 0);
      const ctx = canvasRef.current!.getContext('2d')!;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(tmp, dx, dy, dw, dh);
    };
    img.src = url;
  };

  const save = () => {
    onSave({
      src: canvasRef.current!.toDataURL('image/png'),
      width: Math.max(16, worldW),
      offset: initial?.offset ?? [0, 0],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[440px] rounded-lg border border-border bg-card p-3 text-xs shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <span className="font-medium">Emission area</span>
          <span className="text-muted-foreground">paint where particles are born</span>
        </div>

        <div
          className="relative overflow-hidden rounded-md border border-border"
          style={{
            background:
              'repeating-conic-gradient(#1c1c1f 0% 25%, #232327 0% 50%) 0 0 / 16px 16px',
          }}>
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className="block w-full cursor-crosshair touch-none"
            onPointerDown={(e) => {
              painting.current = true;
              last.current = null;
              e.currentTarget.setPointerCapture(e.pointerId);
              const [x, y] = toLocal(e);
              stroke(x, y);
            }}
            onPointerMove={(e) => {
              if (!painting.current) return;
              const [x, y] = toLocal(e);
              stroke(x, y);
            }}
            onPointerUp={() => {
              painting.current = false;
              last.current = null;
            }}
          />
        </div>

        <div className="mt-2 flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-border">
            {([[false, 'Paint'], [true, 'Erase']] as const).map(([v, label]) => (
              <button key={label} onClick={() => setErase(v)}
                className={`px-2.5 py-1 ${erase === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>
                {label}
              </button>
            ))}
          </div>
          <label className="flex flex-1 items-center gap-1.5 text-muted-foreground">
            brush
            <input type="range" min={6} max={90} value={brush} onChange={(e) => setBrush(Number(e.target.value))} className="min-w-0 flex-1" />
          </label>
          <button className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-accent"
            onClick={() => canvasRef.current!.getContext('2d')!.clearRect(0, 0, W, H)}>
            Clear
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <label className="cursor-pointer rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-accent">
            Load image…
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => e.target.files?.[0] && stampImage(e.target.files[0])} />
          </label>
          <span className="text-muted-foreground">uses the image's alpha (or brightness) as the area</span>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-muted-foreground">
            world width
            <input className="num" style={{ width: 64 }} type="number" min={16} value={worldW}
              onChange={(e) => setWorldW(Number(e.target.value) || 320)} />
            px
          </label>
          <div className="flex gap-2">
            <button className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-accent" onClick={onClose}>
              Cancel
            </button>
            <button className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground" onClick={save}>
              Save area
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
