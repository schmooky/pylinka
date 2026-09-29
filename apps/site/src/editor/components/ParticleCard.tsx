import { useState } from 'react';
import { useEditor } from '../store';
import { LifePreview } from './LifePreview';
import { useParticleLife, useSetParticleImage, useSystemTexture } from './ParticleThumb';

const COLLAPSED_KEY = 'pylinka.editor.particleCardCollapsed';

/**
 * The active emitter's particle, pinned to the corner of its graph.
 *
 * A graph is a column of nodes about numbers; nothing on it showed what those
 * numbers are drawn ON. With several emitters and a library of textures that
 * made it easy to lose track of which graph was which. This is the answer to
 * "what does this emitter draw", in the place you are looking while editing it:
 * the sprite, living out one lifetime with every over-life node applied.
 *
 * Drop an image on it to give the emitter new art. It folds down to just the
 * particle when it is in the way of the nodes under it.
 */
export function ParticleCard({ offsetTop = 0 }: { offsetTop?: number }) {
  const activeId = useEditor((s) => s.activeSystemId);
  const name = useEditor((s) => s.system().name);
  const tex = useSystemTexture(activeId);
  const { tracks, life } = useParticleLife(activeId);
  const setConfigSection = useEditor((s) => s.setConfigSection);
  const setConfigOpen = useEditor((s) => s.setConfigOpen);
  const setImage = useSetParticleImage(activeId);
  const [over, setOver] = useState(false);
  const [collapsed, setCollapsedState] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setCollapsed = (v: boolean) => {
    setCollapsedState(v);
    try {
      localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0');
    } catch {
      /* a per-viewer convenience; fine to forget */
    }
  };
  const openSettings = () => {
    setConfigSection(`emitter:${activeId}`);
    setConfigOpen(true);
  };

  return (
    <div
      className="absolute left-2 z-10 flex items-center gap-2 rounded-lg border p-1.5 shadow-lg"
      style={{
        top: 8 + offsetTop,
        borderColor: over ? 'var(--color-foreground)' : 'var(--color-border)',
        background: 'color-mix(in oklab, var(--color-card) 92%, transparent)',
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const files = [...(e.dataTransfer.files ?? [])];
        if (!files.some((f) => f.type.startsWith('image/'))) return;
        // an image here is art for this emitter, not a project to import
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        void setImage(files);
      }}>
      <button
        className="rounded"
        title={`What “${name}” draws — one particle over its ${life.toFixed(1)}s life. Click for its settings; drop an image to replace its art.`}
        onClick={openSettings}>
        <LifePreview tracks={tracks} tex={tex} life={life} width={collapsed ? 32 : 56} height={collapsed ? 32 : 56} />
      </button>
      {!collapsed && (
        <button className="flex max-w-[120px] flex-col gap-0.5 text-left text-[10px] leading-tight" onClick={openSettings}>
          <span className="truncate font-medium text-foreground">{name}</span>
          <span className="truncate text-muted-foreground">{over ? 'drop to replace art' : tex ? tex.name : 'soft dot'}</span>
          <span className="font-mono text-[9px] text-muted-foreground">{life.toFixed(1)}s life</span>
        </button>
      )}
      <button
        className="self-start rounded px-0.5 text-[10px] leading-none text-muted-foreground hover:text-foreground"
        title={collapsed ? 'Show the details' : 'Fold down to just the particle'}
        onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? '›' : '‹'}
      </button>
    </div>
  );
}
