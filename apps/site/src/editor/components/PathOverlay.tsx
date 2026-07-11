import { useMemo, useRef } from 'react';
import { createPathDriver } from '@pylinka/core';
import { useEditor } from '../store';

/**
 * SVG overlay on the preview canvas that draws the ACTIVE system's emitter
 * trajectory and, in edit mode, lets you click to add points, drag to move
 * them, and double-click to delete. Coordinates are stored normalized (0..1).
 */
const VB = 100; // svg viewBox units

interface PathOverlayProps {
  editing: boolean;
}

export function PathOverlay({ editing }: PathOverlayProps) {
  const path = useEditor((s) => (s.project.systemPaths ?? {})[s.activeSystemId] ?? null);
  const setPath = useEditor((s) => s.setPath);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragIdx = useRef<number>(-1);

  const points = path?.points ?? [];

  // dense polyline through the spline for display
  const curve = useMemo(() => {
    if (points.length < 2) return '';
    const d = createPathDriver(points, { duration: 1, mode: 'once', closed: path?.closed ?? false });
    const n = Math.max(48, points.length * 16);
    const parts: string[] = [];
    for (let k = 0; k <= n; k++) {
      const [x, y] = d.at(k / n); // a closed driver covers the wrap within one traversal
      parts.push(`${(x * VB).toFixed(2)},${(y * VB).toFixed(2)}`);
    }
    return parts.join(' ');
  }, [JSON.stringify(points), path?.closed]);

  if (!editing && points.length < 2) return null;

  const toNorm = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [
      Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
      Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
    ];
  };

  const commit = (pts: [number, number][]) =>
    setPath({ points: pts, duration: path?.duration ?? 4, mode: path?.mode ?? 'loop', closed: path?.closed ?? false });

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VB} ${VB}`}
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      style={{ pointerEvents: editing ? 'auto' : 'none', cursor: editing ? 'crosshair' : 'default', touchAction: 'none' }}
      onPointerDown={(e) => {
        if (!editing || dragIdx.current >= 0 || e.target !== svgRef.current) return;
        commit([...points, toNorm(e)]);
      }}
      onPointerMove={(e) => {
        if (dragIdx.current < 0) return;
        const pts = points.map((p, i) => (i === dragIdx.current ? toNorm(e) : p)) as [number, number][];
        commit(pts);
      }}
      onPointerUp={(e) => {
        if (dragIdx.current >= 0) {
          dragIdx.current = -1;
          (e.currentTarget as SVGSVGElement).releasePointerCapture?.(e.pointerId);
        }
      }}>
      {curve && (
        <polyline
          points={curve}
          fill="none"
          stroke="#a78bfa"
          strokeOpacity={editing ? 0.9 : 0.45}
          strokeWidth={editing ? 0.6 : 0.4}
          vectorEffect="non-scaling-stroke"
          style={{ strokeWidth: editing ? 2 : 1.4 }}
        />
      )}
      {editing &&
        points.map((p, i) => (
          <circle
            key={i}
            cx={p[0] * VB}
            cy={p[1] * VB}
            r={1.6}
            fill={i === 0 ? '#34d399' : '#a78bfa'}
            stroke="#0a0a0b"
            style={{ cursor: 'grab', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as never }}
            onPointerDown={(e) => {
              e.stopPropagation();
              dragIdx.current = i;
              svgRef.current!.setPointerCapture(e.pointerId);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              commit(points.filter((_, j) => j !== i) as [number, number][]);
            }}
          />
        ))}
    </svg>
  );
}
