import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Node, ParamDef, System } from '@pylinka/graph';
import type { EditorTexture } from '../types';
import { frameSize } from '../types';
import { destinationOf, Sampler, rng, sampleOutput, seedOf, simulate, type Path, type Vec } from '../sampling';
import type { BodyPreview } from '../nodeSize';
import { spriteImage } from './LifePreview';

/**
 * Previews for the nodes that are not "over life": where particles are born,
 * what a random node hands out, the spray a velocity leaves with, and the arcs
 * the forces bend them into. Each one is drawn from a seeded sample of a dozen
 * particles (sampling.ts), so it holds still until the graph changes, and
 * hovering it opens a bigger copy beside the node.
 */

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, t: number) => void;

/** What a node shows, computed once per graph change. */
export type PreviewData =
  | { kind: 'spawn'; pts: Vec[]; caption: string }
  | { kind: 'spray'; pts: Vec[]; velocity: boolean; caption: string }
  | { kind: 'dist'; values: number[]; lo: number; hi: number; as: 'life' | 'scale' | 'rotation' | 'alpha' | 'value'; radians: boolean; caption: string }
  | { kind: 'noise'; frame: boolean; speed: number; caption: string }
  | { kind: 'motion'; paths: Path[]; ghost?: Path[]; caption: string };

const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toString() : Number(v.toFixed(2)).toString());

export function previewData(
  kind: BodyPreview,
  node: Node,
  system: System,
  params: readonly ParamDef[],
  disabled: readonly string[],
): PreviewData | undefined {
  const graph: System = disabled.length
    ? { ...system, graph: { ...system.graph, nodes: system.graph.nodes.filter((n) => !disabled.includes(n.id)) } }
    : system;
  const approxNote = (a: string[]) => (a.length ? ` · approx (${a.map((k) => k.split('.')[1]).join(', ')} not shown)` : '');

  switch (kind) {
    case 'spawn': {
      const pts = sampleOutput(graph, params, node.id, 'pos', 90) as Vec[];
      const s = new Sampler(graph, params, 1);
      s.particle(0, 1);
      const n = (p: string) => s.input(node.id, p) as number;
      const v = (p: string) => s.input(node.id, p) as Vec;
      const caption =
        node.kind === 'shape.circle'
          ? `on a circle, r ${fmt(n('radius'))}px`
          : node.kind === 'shape.torus'
            ? `in a ring, ${fmt(n('innerRadius'))}–${fmt(n('outerRadius'))}px`
            : node.kind === 'shape.rectangle'
              ? `inside ${fmt(v('size')[0])}×${fmt(v('size')[1])}px`
              : node.kind === 'shape.burstRing'
                ? `evenly round a ring, r ${fmt(n('radius'))}px`
                : node.kind === 'shape.polygonalChain'
                  ? 'along a line'
                  : `at ${fmt(v('offset')[0])}, ${fmt(v('offset')[1])} from the emitter`;
      return { kind: 'spawn', pts, caption };
    }
    case 'spray': {
      const pts = sampleOutput(graph, params, node.id, 'out', 28) as Vec[];
      const dest = destinationOf(graph, node.id);
      const velocity = dest?.kind === 'output.initVelocity' || dest?.kind === 'output.setVelocity';
      const speeds = pts.map((p) => Math.hypot(p[0], p[1]));
      const caption = velocity
        ? `leaves at ${fmt(Math.min(...speeds))}–${fmt(Math.max(...speeds))} px/s`
        : `x ${fmt(Math.min(...pts.map((p) => p[0])))}…${fmt(Math.max(...pts.map((p) => p[0])))} · y ${fmt(Math.min(...pts.map((p) => p[1])))}…${fmt(Math.max(...pts.map((p) => p[1])))}`;
      return { kind: 'spray', pts, velocity, caption };
    }
    case 'dist': {
      const values = sampleOutput(graph, params, node.id, 'out', 14) as number[];
      const s = new Sampler(graph, params, 1);
      s.particle(0, 1);
      const lo = node.kind === 'gen.randomRange' ? (s.input(node.id, 'min') as number) : 0;
      const hi = node.kind === 'gen.randomRange' ? (s.input(node.id, 'max') as number) : 1;
      const dest = destinationOf(graph, node.id);
      const as =
        dest?.kind === 'output.initLife'
          ? 'life'
          : dest?.kind === 'output.writeScale'
            ? 'scale'
            : dest?.kind === 'output.initRotation' || dest?.kind === 'output.writeRotation'
              ? 'rotation'
              : dest?.kind === 'output.writeAlpha'
                ? 'alpha'
                : 'value';
      const radians = dest?.structural?.unit === 'radians';
      const [a, b] = [Math.min(lo, hi), Math.max(lo, hi)];
      const caption =
        as === 'life'
          ? `each particle lives ${fmt(a)}–${fmt(b)}s`
          : as === 'scale'
            ? `sizes ${fmt(a)}–${fmt(b)}×`
            : as === 'rotation'
              ? `angles ${fmt(a)}–${fmt(b)}${radians ? ' rad' : '°'}`
              : as === 'alpha'
                ? `opacity ${fmt(a * 100)}–${fmt(b * 100)}%`
                : `one value per particle, ${fmt(a)}…${fmt(b)}`;
      return { kind: 'dist', values, lo: a, hi: b, as, radians, caption };
    }
    case 'noise': {
      const s = new Sampler(graph, params, 1);
      s.particle(0, 1);
      const speed = node.kind === 'gen.noise' ? (s.input(node.id, 'speed') as number) : 60;
      return {
        kind: 'noise',
        frame: node.kind === 'gen.frameRandom',
        speed,
        caption: node.kind === 'gen.frameRandom' ? 'a new value every frame, −1…1' : 'changes with position and time, −1…1',
      };
    }
    case 'motion': {
      const { paths, approx } = simulate(graph, params);
      const life = paths.reduce((a, p) => a + p.life, 0) / Math.max(1, paths.length);
      return { kind: 'motion', paths, caption: `${paths.length} particles · ${fmt(life)}s life${approxNote(approx)}` };
    }
    case 'force': {
      const { paths, approx } = simulate(graph, params);
      const ghost = simulate(graph, params, { exclude: new Set([node.id]) }).paths;
      return { kind: 'motion', paths, ghost, caption: `dashed: without this force${approxNote(approx)}` };
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------

/** Fit world points (and the emitter at the origin) into a w×h box. */
function fitter(points: Vec[], w: number, h: number, pad: number, minSpan: number) {
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 - x0 < minSpan) {
    const c = (x0 + x1) / 2;
    x0 = c - minSpan / 2;
    x1 = c + minSpan / 2;
  }
  if (y1 - y0 < minSpan) {
    const c = (y0 + y1) / 2;
    y0 = c - minSpan / 2;
    y1 = c + minSpan / 2;
  }
  const s = Math.min((w - 2 * pad) / (x1 - x0), (h - 2 * pad) / (y1 - y0));
  const ox = (w - (x1 - x0) * s) / 2 - x0 * s;
  const oy = (h - (y1 - y0) * s) / 2 - y0 * s;
  return { x: (v: number) => ox + v * s, y: (v: number) => oy + v * s, s };
}

const ink = (a: number) => `rgba(236, 236, 240, ${a})`;
const ACCENT = (a: number) => `rgba(255, 196, 92, ${a})`;

function emitterMark(ctx: CanvasRenderingContext2D, x: number, y: number, dpr: number) {
  ctx.strokeStyle = ink(0.55);
  ctx.lineWidth = dpr;
  ctx.beginPath();
  ctx.arc(x, y, 3.5 * dpr, 0, Math.PI * 2);
  ctx.moveTo(x - 6 * dpr, y);
  ctx.lineTo(x + 6 * dpr, y);
  ctx.moveTo(x, y - 6 * dpr);
  ctx.lineTo(x, y + 6 * dpr);
  ctx.stroke();
}

/** The emitter's sprite (first cell of a sheet), or the untextured soft dot. */
function sprite(ctx: CanvasRenderingContext2D, tex: EditorTexture | null, x: number, y: number, size: number, rot: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(x, y);
  ctx.rotate(rot);
  const img = tex ? spriteImage(tex.src) : null;
  if (img && tex && img.complete && img.naturalWidth > 0) {
    const { frameW, frameH } = frameSize(tex);
    const k = size / Math.max(frameW, frameH);
    ctx.drawImage(img, 0, 0, frameW, frameH, (-frameW * k) / 2, (-frameH * k) / 2, frameW * k, frameH * k);
  } else {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-size / 2, -size / 2, size, size);
  }
  ctx.restore();
}

function drawerFor(d: PreviewData, tex: EditorTexture | null): Draw {
  switch (d.kind) {
    case 'spawn':
      return (ctx, w, h, dpr, t) => {
        const f = fitter(d.pts, w, h, 8 * dpr, 40);
        d.pts.forEach(([x, y], i) => {
          const a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 2.4 + i * 1.7));
          ctx.fillStyle = ACCENT(a);
          ctx.beginPath();
          ctx.arc(f.x(x), f.y(y), 1.6 * dpr, 0, Math.PI * 2);
          ctx.fill();
        });
        emitterMark(ctx, f.x(0), f.y(0), dpr);
      };
    case 'spray':
      return (ctx, w, h, dpr, t) => {
        const f = fitter(d.pts, w, h, 8 * dpr, 20);
        const ox = f.x(0), oy = f.y(0);
        d.pts.forEach(([x, y], i) => {
          const ex = f.x(x), ey = f.y(y);
          if (d.velocity) {
            ctx.strokeStyle = ink(0.35);
            ctx.lineWidth = dpr;
            ctx.beginPath();
            ctx.moveTo(ox, oy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            // a particle riding each arrow outward
            const p = (t * 0.8 + i / d.pts.length) % 1;
            ctx.fillStyle = ACCENT(1 - p * 0.7);
            ctx.beginPath();
            ctx.arc(ox + (ex - ox) * p, oy + (ey - oy) * p, 1.8 * dpr, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = ACCENT(0.8);
            ctx.beginPath();
            ctx.arc(ex, ey, 1.8 * dpr, 0, Math.PI * 2);
            ctx.fill();
          }
        });
        emitterMark(ctx, ox, oy, dpr);
      };
    case 'dist':
      return (ctx, w, h, dpr, t) => {
        const pad = 6 * dpr;
        const span = d.hi - d.lo || 1;
        if (d.as === 'life') {
          // one bar per particle, as long as it lives; the playhead shows them
          // dying at different moments
          const max = Math.max(d.hi, 1e-3);
          const T = (t % (max * 1.15)) / max;
          const rowH = (h - 2 * pad) / d.values.length;
          d.values.forEach((v, i) => {
            const len = (v / max) * (w - 2 * pad);
            const alive = T * max < v;
            ctx.fillStyle = alive ? ACCENT(0.85) : ink(0.14);
            ctx.fillRect(pad, pad + i * rowH + rowH * 0.2, Math.max(1, len), Math.max(1, rowH * 0.6));
          });
          const px = pad + Math.min(1, T) * (w - 2 * pad);
          ctx.strokeStyle = ink(0.7);
          ctx.lineWidth = dpr;
          ctx.beginPath();
          ctx.moveTo(px, pad * 0.5);
          ctx.lineTo(px, h - pad * 0.5);
          ctx.stroke();
          return;
        }
        if (d.as === 'value') {
          const y = h / 2;
          ctx.strokeStyle = ink(0.25);
          ctx.lineWidth = dpr;
          ctx.beginPath();
          ctx.moveTo(pad, y);
          ctx.lineTo(w - pad, y);
          ctx.stroke();
          d.values.forEach((v, i) => {
            const x = pad + ((v - d.lo) / span) * (w - 2 * pad);
            const jy = y + Math.sin(i * 12.9898) * (h * 0.22);
            ctx.fillStyle = ACCENT(0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 2 + i)));
            ctx.beginPath();
            ctx.arc(x, jy, 2 * dpr, 0, Math.PI * 2);
            ctx.fill();
          });
          return;
        }
        // scale / rotation / alpha: the sprite itself, a few samples side by side
        const vals = d.values.slice(0, 7).sort((a, b) => a - b);
        const slot = (w - 2 * pad) / vals.length;
        const box = Math.min(slot, h - 2 * pad);
        const vmax = Math.max(...vals.map(Math.abs), 1e-6);
        vals.forEach((v, i) => {
          const cx = pad + slot * (i + 0.5);
          const cy = h / 2;
          if (d.as === 'scale') sprite(ctx, tex, cx, cy, Math.max(2, (Math.abs(v) / vmax) * box * 0.95), 0, 1);
          else if (d.as === 'rotation') sprite(ctx, tex, cx, cy, box * 0.85, d.radians ? v : (v * Math.PI) / 180, 1);
          else sprite(ctx, tex, cx, cy, box * 0.85, 0, v);
        });
      };
    case 'noise':
      return (ctx, w, h, dpr, t) => {
        const pad = 6 * dpr;
        const n = 60;
        ctx.strokeStyle = ink(0.2);
        ctx.lineWidth = dpr;
        ctx.beginPath();
        ctx.moveTo(pad, h / 2);
        ctx.lineTo(w - pad, h / 2);
        ctx.stroke();
        ctx.strokeStyle = ACCENT(0.85);
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const frame = Math.floor(t * 60) - (n - 1 - i);
          let v: number;
          if (d.frame) v = rng(seedOf(String(frame)))() * 2 - 1;
          else {
            const x = Math.sin((frame / 60) * d.speed) * 43758.5453;
            v = (x - Math.floor(x)) * 2 - 1;
          }
          const px = pad + (i / (n - 1)) * (w - 2 * pad);
          const py = h / 2 - v * (h / 2 - pad);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      };
    case 'motion': {
      // the arcs do not move: draw them once per size into a layer, and only
      // the particles riding them each frame
      let layer: HTMLCanvasElement | null = null;
      let layerKey = '';
      return (ctx, w, h, dpr, t) => {
        const all: Vec[] = [];
        for (const p of d.paths) all.push(...p.pts);
        for (const p of d.ghost ?? []) all.push(...p.pts);
        const f = fitter(all, w, h, 7 * dpr, 30);
        if (!layer || layerKey !== `${w}x${h}`) {
          layer = document.createElement('canvas');
          layer.width = w;
          layer.height = h;
          layerKey = `${w}x${h}`;
          const lc = layer.getContext('2d')!;
          const line = (pts: Vec[], style: string, dash: number[]) => {
            lc.strokeStyle = style;
            lc.setLineDash(dash);
            lc.beginPath();
            pts.forEach(([x, y], i) => (i === 0 ? lc.moveTo(f.x(x), f.y(y)) : lc.lineTo(f.x(x), f.y(y))));
            lc.stroke();
          };
          lc.lineWidth = dpr;
          for (const p of d.ghost ?? []) line(p.pts, ink(0.4), [3 * dpr, 3 * dpr]);
          for (const p of d.paths) line(p.pts, ACCENT(0.35), []);
          emitterMark(lc, f.x(0), f.y(0), dpr);
        }
        ctx.drawImage(layer, 0, 0);
        d.paths.forEach((p, i) => {
          const phase = ((t / p.life) + i / d.paths.length) % 1;
          const at = phase * (p.pts.length - 1);
          const k = Math.floor(at);
          const a = p.pts[k]!, b = p.pts[Math.min(k + 1, p.pts.length - 1)]!;
          const fr = at - k;
          const x = a[0] + (b[0] - a[0]) * fr, y = a[1] + (b[1] - a[1]) * fr;
          if (tex) sprite(ctx, tex, f.x(x), f.y(y), 9 * dpr, 0, 1 - phase * 0.5);
          else {
            ctx.fillStyle = ACCENT(1 - phase * 0.6);
            ctx.beginPath();
            ctx.arc(f.x(x), f.y(y), 2.2 * dpr, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      };
    }
  }
}

/** A canvas that redraws every frame while it is on screen. */
function CanvasPreview({ draw, width, height }: { draw: Draw; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => {
      visible = e?.isIntersecting ?? true;
      if (visible && !raf) raf = requestAnimationFrame(frame);
    });
    io.observe(canvas);
    let last = -Infinity;
    function frame(now: number) {
      raf = 0;
      if (!visible) return;
      // a thumbnail does not need 60 fps; half the work for the same read
      if (now - last < 32) {
        raf = requestAnimationFrame(frame);
        return;
      }
      last = now;
      ctx.clearRect(0, 0, canvas!.width, canvas!.height);
      draw(ctx, canvas!.width, canvas!.height, dpr, now / 1000);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [draw, width, height]);
  return (
    <canvas
      ref={ref}
      className="block rounded"
      style={{ width, height, background: 'color-mix(in oklab, var(--color-background) 70%, black)' }}
    />
  );
}

/**
 * A node's preview: small under the ports, and a bigger copy beside the node
 * while the pointer is on it.
 */
export function NodePreview({ data, tex, width }: { data: PreviewData; tex: EditorTexture | null; width: number }) {
  const draw = useMemo(() => drawerFor(data, tex), [data, tex]);
  const [big, setBig] = useState<{ x: number; y: number } | null>(null);
  const host = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={host}
      className="nodrag mb-1 mt-1"
      onPointerEnter={() => {
        const r = host.current?.closest('.react-flow__node')?.getBoundingClientRect();
        if (r) setBig({ x: r.right + 12, y: Math.max(8, Math.min(r.top, window.innerHeight - 240)) });
      }}
      onPointerLeave={() => setBig(null)}>
      <CanvasPreview draw={draw} width={width} height={data.kind === 'motion' ? 92 : 44} />
      <div className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={data.caption}>
        {data.caption}
      </div>
      {big &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[9990] rounded-lg border p-2 shadow-2xl"
            style={{ left: big.x, top: big.y, background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
            <CanvasPreview draw={draw} width={320} height={200} />
            <div className="mt-1 max-w-[320px] font-mono text-[10px] text-muted-foreground">{data.caption}</div>
          </div>,
          document.body,
        )}
    </div>
  );
}
