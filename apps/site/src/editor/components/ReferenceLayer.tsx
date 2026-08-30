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
import { useReference } from '../reference';

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
        /*
         * Always over the canvas. There is no "behind" any more: the preview's
         * backdrop is drawn INSIDE the canvas, which is opaque, so a reference
         * placed under it would be painted over and simply never seen. Turn the
         * opacity down to read the effect through it.
         */
        zIndex: 3,
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
