import { useEffect, useRef } from 'react';
import type { EditorTexture } from '../types';
import { frameSize } from '../types';
import { peakScale, stateAt, type LifeProp, type Track } from '../lifePreview';

/**
 * A single particle living out its life on a loop, drawn the way the runtime
 * draws it: the emitter's sprite (the current frame of a sequence, advanced by
 * the texture's play mode), multiplied by the tint, faded by alpha, turned by
 * rotation and sized by scale. Scale is shown relative to the largest size the
 * particle reaches, so a 20→48 ramp fills the box at its peak rather than
 * drawing 384px into a 48px thumbnail.
 *
 * Only animates while on screen: a graph can hold a dozen of these.
 */

const images = new Map<string, HTMLImageElement>();
/** One decoded image per source, shared by every preview that draws it. */
export function spriteImage(src: string): HTMLImageElement {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    images.set(src, img);
  }
  return img;
}

/** Which column of the first row a particle shows at age `age` of `life`. */
function frameAt(tex: EditorTexture, t: number, life: number): number {
  const n = Math.max(1, tex.cols);
  if (tex.play === 'once') return Math.min(n - 1, Math.floor(t * n));
  const f = Math.floor(t * life * Math.max(1, tex.fps));
  return tex.play === 'hold' ? Math.min(n - 1, f) : f % n;
}

export function LifePreview({
  tracks,
  tex,
  life,
  width,
  height,
  show,
  className = '',
}: {
  tracks: readonly Track[];
  tex: EditorTexture | null;
  /** seconds one loop takes — the particle's lifetime */
  life: number;
  width: number;
  height: number;
  /** which value to print under the particle (the node's own property) */
  show?: LifeProp;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d')!;
    const scratch = document.createElement('canvas');
    const sctx = scratch.getContext('2d')!;
    const peak = peakScale(tracks, life);
    const img = tex ? spriteImage(tex.src) : null;

    let raf = 0;
    let visible = true;
    let last = -Infinity;
    // one scratch buffer big enough for the particle at its largest, reused
    // every frame (resizing a canvas reallocates it)
    const maxPx = Math.ceil(Math.min(canvas.width, canvas.height) * 0.9) + 1;
    scratch.width = maxPx;
    scratch.height = maxPx;
    const io = new IntersectionObserver(([e]) => {
      visible = e?.isIntersecting ?? true;
      if (visible && !raf) raf = requestAnimationFrame(draw);
    });
    io.observe(canvas);

    function draw(now: number) {
      raf = 0;
      if (!visible) return;
      if (now - last < 32) {
        raf = requestAnimationFrame(draw);
        return;
      }
      last = now;
      // one clock for every preview: they stay in step with each other, and an
      // edit (which re-runs this effect) does not snap the particle back to birth
      const t = ((now / 1000) % life) / life;
      const s = stateAt(tracks, t, life);
      const box = Math.min(canvas!.width, canvas!.height) * 0.9;
      const px = Math.max(1, box * (Math.abs(s.scale) / peak));

      ctx.clearRect(0, 0, canvas!.width, canvas!.height);
      // draw the particle into a scratch square: sprite × tint, alpha kept
      const n = Math.min(maxPx, Math.ceil(px));
      sctx.clearRect(0, 0, maxPx, maxPx);
      const shape = (ink: string) => {
        if (img && tex && img.complete && img.naturalWidth > 0) {
          const { frameW, frameH } = frameSize(tex);
          const cellW = tex.width / Math.max(1, tex.cols);
          const k = n / Math.max(frameW, frameH);
          const dw = frameW * k, dh = frameH * k;
          sctx.drawImage(img, frameAt(tex, t, life) * cellW, 0, frameW, frameH, (n - dw) / 2, (n - dh) / 2, dw, dh);
        } else {
          // the runtime's untextured sprite: a soft disc
          const g = sctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
          g.addColorStop(0, `rgba(${ink},1)`);
          g.addColorStop(1, `rgba(${ink},0)`);
          sctx.fillStyle = g;
          sctx.fillRect(0, 0, n, n);
        }
      };
      shape('255,255,255');
      if (s.color.toLowerCase() !== '#ffffff') {
        sctx.globalCompositeOperation = 'multiply';
        sctx.fillStyle = s.color;
        sctx.fillRect(0, 0, n, n);
        // multiply fills transparent pixels too — cut back to the sprite's shape
        sctx.globalCompositeOperation = 'destination-in';
        shape('0,0,0');
        sctx.globalCompositeOperation = 'source-over';
      }

      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0, s.alpha));
      ctx.translate(canvas!.width / 2, canvas!.height / 2);
      ctx.rotate((s.rotation * Math.PI) / 180);
      ctx.drawImage(scratch, 0, 0, n, n, -n / 2, -n / 2, n, n);
      ctx.restore();

      if (barRef.current) barRef.current.style.width = `${t * 100}%`;
      if (labelRef.current && show) {
        const v = show === 'color' ? s.color : show === 'rotation' ? `${Math.round(s.rotation)}°` : s[show].toFixed(2);
        labelRef.current.textContent = `${show} ${v}`;
      }
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [tracks, tex, life, width, height, show]);

  return (
    <span className={`relative inline-flex flex-col overflow-hidden rounded ${className}`} style={{ width }}>
      <canvas
        ref={canvasRef}
        style={{
          width,
          height,
          background: 'repeating-conic-gradient(#1c1c1f 0% 25%, #232327 0% 50%) 0 0 / 8px 8px',
        }}
      />
      <span className="h-[2px] w-full bg-black/40">
        <span ref={barRef} className="block h-full" style={{ background: 'color-mix(in oklab, var(--color-foreground) 55%, transparent)' }} />
      </span>
      {show && (
        <span className="flex justify-between px-1 font-mono text-[9px] text-muted-foreground">
          <span ref={labelRef} />
          <span>{life.toFixed(1)}s</span>
        </span>
      )}
    </span>
  );
}
