import { useEffect, useMemo, useState } from 'react';
import type { System } from '@pylinka/graph';
import { useEditor } from '../store';
import { lifeSeconds, particleTracks, type Track } from '../lifePreview';
import type { EditorTexture } from '../types';
import { frameSize } from '../types';

/**
 * What one particle of an emitter looks like — the image, not the whole sheet.
 *
 * A texture in the library is often a sprite sheet: a grid where each row is a
 * sequence and each column a frame. Showing the whole sheet next to an emitter
 * says "these twenty-eight coins" when the emitter draws one coin at a time, so
 * this crops to a single cell and, when `animate` is on, plays the first row at
 * the texture's own fps — the way a particle would.
 *
 * Built from CSS background positioning rather than a canvas so a strip of
 * these (one per emitter tab) costs nothing but the one decoded image.
 */
export function ParticleThumb({
  tex,
  size,
  animate = false,
  className = '',
  title,
}: {
  tex: EditorTexture | null | undefined;
  size: number;
  animate?: boolean;
  className?: string;
  title?: string;
}) {
  const cols = Math.max(1, tex?.cols ?? 1);
  const frames = cols;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    if (!animate || !tex || frames <= 1) return;
    const fps = Math.max(1, tex.fps || 12);
    const t = setInterval(() => setFrame((f) => (f + 1) % frames), 1000 / fps);
    return () => clearInterval(t);
  }, [animate, tex, frames]);

  const checker = {
    background: 'repeating-conic-gradient(#1c1c1f 0% 25%, #232327 0% 50%) 0 0 / 8px 8px',
  };

  if (!tex) {
    return (
      <span
        className={`grid shrink-0 place-items-center rounded-sm border border-dashed border-border text-muted-foreground ${className}`}
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.28) }}
        title={title ?? 'No texture — particles draw as soft dots'}>
        ●
      </span>
    );
  }

  // fit one cell into the square, preserving its aspect
  const { frameW, frameH } = frameSize(tex);
  const cellW = tex.width / cols;
  const k = size / Math.max(frameW, frameH, 1);
  const w = frameW * k;
  const h = frameH * k;

  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-sm ${className}`}
      style={{ width: size, height: size, ...checker }}
      title={title ?? tex.name}>
      <span
        style={{
          width: w,
          height: h,
          backgroundImage: `url("${tex.src}")`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${tex.width * k}px ${tex.height * k}px`,
          backgroundPosition: `${-frame * cellW * k}px 0px`,
          imageRendering: size >= frameW ? 'pixelated' : 'auto',
        }}
      />
    </span>
  );
}

/** The texture an emitter renders with, or null when it draws plain dots. */
export function useSystemTexture(systemId: string): EditorTexture | null {
  return useEditor((s) => {
    const id = (s.project.systemTextures ?? {})[systemId];
    return (id && s.project.textures?.find((t) => t.id === id)) || null;
  });
}

const NO_DISABLED: string[] = [];

/** Everything that shapes one of this emitter's particles over its life. */
export function useParticleLife(systemId: string): { tracks: Track[]; life: number } {
  const graph = useEditor((s) => s.project.systems.find((x) => x.id === systemId)?.graph);
  const disabled = useEditor((s) => s.project.disabledNodes) ?? NO_DISABLED;
  return useMemo(() => {
    const system = { graph: graph ?? { nodes: [], edges: [] } } as System;
    return { tracks: particleTracks(system, disabled), life: lifeSeconds(system) };
  }, [graph, disabled]);
}
