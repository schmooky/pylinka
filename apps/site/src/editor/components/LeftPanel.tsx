/**
 * Left dock: tabbed Nodes (palette) / Knobs / Emitter. Knobs and Emitter used
 * to sit under the preview on the right; moving them here frees the right side
 * to be a big spawner view. They drive the preview through the preview store.
 */
import { useState } from 'react';
import { usePreview } from '../previewStore';
import { Palette } from './Palette';
import { Knobs } from './Knobs';
import { EmitterPanel } from './EmitterPanel';

type Tab = 'nodes' | 'knobs' | 'emitter';

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>('nodes');
  const knobs = usePreview((s) => s.knobs);
  const setKnob = usePreview((s) => s.setKnob);
  const pathEdit = usePreview((s) => s.pathEdit);
  const setPathEdit = usePreview((s) => s.setPathEdit);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border">
      <div className="flex border-b border-border text-xs">
        {(['nodes', 'knobs', 'emitter'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 border-b-2 py-2 capitalize ${tab === k ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {k}
          </button>
        ))}
      </div>
      {/* keep Nodes mounted (its search/scroll state) — just hide it when off */}
      <div className={`min-h-0 flex-1 flex-col ${tab === 'nodes' ? 'flex' : 'hidden'}`}>
        <Palette />
      </div>
      {tab === 'knobs' && (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
          <Knobs values={knobs} onSet={setKnob} />
        </div>
      )}
      {tab === 'emitter' && (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
          <EmitterPanel pathEdit={pathEdit} setPathEdit={setPathEdit} />
        </div>
      )}
    </aside>
  );
}
