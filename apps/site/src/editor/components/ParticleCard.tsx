import { useEditor } from '../store';
import { LifePreview } from './LifePreview';
import { useParticleLife, useSystemTexture } from './ParticleThumb';

/**
 * The active emitter's particle, pinned to the corner of its graph.
 *
 * A graph is a column of nodes about numbers; nothing on it showed what those
 * numbers are drawn ON. With several emitters and a library of textures that
 * made it easy to lose track of which graph was which. This is the answer to
 * "what does this emitter draw", in the place you are looking while editing it:
 * the sprite, living out one lifetime with every over-life node applied.
 */
export function ParticleCard({ offsetTop = 0 }: { offsetTop?: number }) {
  const activeId = useEditor((s) => s.activeSystemId);
  const name = useEditor((s) => s.system().name);
  const tex = useSystemTexture(activeId);
  const { tracks, life } = useParticleLife(activeId);
  const setConfigSection = useEditor((s) => s.setConfigSection);
  const setConfigOpen = useEditor((s) => s.setConfigOpen);

  return (
    <button
      className="absolute left-2 z-10 flex items-center gap-2 rounded-lg border p-1.5 pr-2.5 text-left shadow-lg hover:border-foreground/40"
      style={{
        top: 8 + offsetTop,
        borderColor: 'var(--color-border)',
        background: 'color-mix(in oklab, var(--color-card) 92%, transparent)',
      }}
      title="What this emitter draws — one particle over its life. Click for the emitter's settings."
      onClick={() => {
        setConfigSection(`emitter:${activeId}`);
        setConfigOpen(true);
      }}>
      <LifePreview tracks={tracks} tex={tex} life={life} width={56} height={56} />
      <span className="flex max-w-[120px] flex-col gap-0.5 text-[10px] leading-tight">
        <span className="truncate font-medium text-foreground">{name}</span>
        <span className="truncate text-muted-foreground">{tex ? tex.name : 'soft dot'}</span>
        <span className="font-mono text-[9px] text-muted-foreground">{life.toFixed(1)}s life</span>
      </span>
    </button>
  );
}
