import { useState } from 'react';
import { useEditor } from '../store';
import type { EditorTexture } from '../types';

type Draft = Omit<EditorTexture, 'id'>;

const EMPTY: EditorTexture[] = [];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

export function Assets() {
  // NB: select the raw ref — `?? []` would mint a new array each getSnapshot and
  // send useSyncExternalStore into an infinite re-render (React #185).
  const textures = useEditor((s) => s.project.textures) ?? EMPTY;
  const activeId = useEditor((s) => s.project.activeTextureId ?? null);
  const addTexture = useEditor((s) => s.addTexture);
  const removeTexture = useEditor((s) => s.removeTexture);
  const setActive = useEditor((s) => s.setActiveTexture);
  const [draft, setDraft] = useState<Draft | null>(null);

  const onFile = async (file: File) => {
    const src = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.readAsDataURL(file);
    });
    const img = await loadImage(src);
    setDraft({
      name: file.name.replace(/\.[^.]+$/, ''),
      src,
      width: img.naturalWidth,
      height: img.naturalHeight,
      cols: 1,
      rows: 1,
      pad: 0,
      fps: 12,
      play: 'loop',
      pick: 'per-particle',
    });
  };

  const addCoins = async () => {
    const img = await loadImage('/atlas/coins.png');
    addTexture({
      name: 'coins', src: '/atlas/coins.png', width: img.naturalWidth, height: img.naturalHeight,
      cols: 10, rows: 7, pad: 2, fps: 14, play: 'loop', pick: 'per-particle',
    });
  };

  const fw = draft ? Math.max(1, Math.round(draft.width / (draft.cols || 1)) - draft.pad) : 0;
  const fh = draft ? Math.max(1, Math.round(draft.height / (draft.rows || 1)) - draft.pad) : 0;

  return (
    <div className="text-xs">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Textures</div>

      {/* active list */}
      <label className="mb-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
        <input type="radio" checked={activeId === null} onChange={() => setActive(null)} />
        <span className="text-muted-foreground">None (soft sprite)</span>
      </label>
      {textures.map((t) => (
        <div key={t.id} className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
          <input type="radio" checked={activeId === t.id} onChange={() => setActive(t.id)} />
          <img src={t.src} alt="" className="h-6 w-6 rounded border border-border object-cover" style={{ imageRendering: 'pixelated' }} />
          <span className="min-w-0 flex-1 truncate">{t.name}</span>
          <span className="font-mono text-[9px] text-muted-foreground">{t.cols}×{t.rows}</span>
          <button className="text-muted-foreground hover:text-foreground" onClick={() => removeTexture(t.id)} title="Remove">✕</button>
        </div>
      ))}

      {/* add */}
      <div className="mt-3 rounded-lg border border-border p-2">
        {!draft ? (
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-border py-3 text-muted-foreground hover:bg-accent">
              + Upload atlas image
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            <button className="rounded-md border border-border py-1.5 text-muted-foreground hover:bg-accent" onClick={addCoins}>
              Add built-in coins ↺
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <img src={draft.src} alt="" className="h-10 w-10 rounded border border-border object-cover" style={{ imageRendering: 'pixelated' }} />
              <input className="num flex-1" style={{ width: 'auto' }} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="text-[10px] text-muted-foreground">
              image {draft.width}×{draft.height} · each frame ≈ {fw}×{fh}px · rows = sequences, columns = frames
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Field label="cols" v={draft.cols} on={(n) => setDraft({ ...draft, cols: n })} />
              <Field label="rows" v={draft.rows} on={(n) => setDraft({ ...draft, rows: n })} />
              <Field label="pad" v={draft.pad} on={(n) => setDraft({ ...draft, pad: n })} />
              <Field label="fps" v={draft.fps} on={(n) => setDraft({ ...draft, fps: n })} />
              <label className="flex flex-col gap-0.5">
                <span className="text-[9px] text-muted-foreground">play</span>
                <select className="sel" value={draft.play} onChange={(e) => setDraft({ ...draft, play: e.target.value as 'loop' | 'once' })}>
                  <option value="loop">loop</option>
                  <option value="once">once</option>
                </select>
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[9px] text-muted-foreground">pick</span>
                <select className="sel" value={draft.pick} onChange={(e) => setDraft({ ...draft, pick: e.target.value as 'per-particle' | 'per-spawn' })}>
                  <option value="per-particle">per particle</option>
                  <option value="per-spawn">per spawn</option>
                </select>
              </label>
            </div>
            <div className="flex gap-2">
              <button className="flex-1 rounded-md bg-primary py-1.5 text-primary-foreground" onClick={() => { addTexture(draft); setDraft(null); }}>
                Add texture
              </button>
              <button className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-accent" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Particles render the atlas as animated sprites — each <strong>row is a sequence</strong>, each
        column a frame. With <em>per-particle</em> pick, every particle spins a random row.
      </p>
    </div>
  );
}

function Field({ label, v, on }: { label: string; v: number; on: (n: number) => void }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] text-muted-foreground">{label}</span>
      <input className="num" type="number" min="0" value={v} onChange={(e) => on(Math.max(0, Number(e.target.value) || 0))} />
    </label>
  );
}
