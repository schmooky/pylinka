/**
 * The template gallery behind "+ Emitter → From template".
 *
 * Each one is a real graph out of the ordinary catalog, not a special case the
 * editor knows about — pick one and it lands as an emitter you can take apart.
 * That matters more than the presets themselves: the fastest way to learn what
 * a node does is to meet it already wired to something that works.
 */
import { createPortal } from 'react-dom';
import { useEditor } from '../store';
import { autoLayout } from '../layout';
import { emitterPayload } from '../clipboard';
import { EMITTER_TEMPLATES } from '../templates';

export function TemplatePicker({ onClose }: { onClose(): void }) {
  const pasteEmitter = useEditor((s) => s.pasteEmitter);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}>
      <div
        className="flex max-h-[70vh] w-[min(680px,92vw)] flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div
          className="flex items-baseline justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-sm font-semibold">New emitter from a template</span>
          <button
            className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {EMITTER_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  const system = { ...structuredClone(t.system), id: `t_${t.id}` };
                  pasteEmitter(emitterPayload(system, autoLayout(system.graph)));
                  onClose();
                }}
                className="flex flex-col gap-1 rounded-lg border border-border p-3 text-left hover:bg-accent">
                <span className="text-xs font-medium">{t.name}</span>
                <span className="text-[10px] leading-relaxed text-muted-foreground">{t.hint}</span>
                <span className="mt-1 font-mono text-[9px] text-muted-foreground">
                  {t.system.graph.nodes.length} nodes · {t.system.blendMode}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
