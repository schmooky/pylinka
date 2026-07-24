/**
 * Asset manager — a full modal (opened from the header) for the project's
 * textures and sprite sequences. Load a single sprite or a sprite sheet, or
 * build an animated sequence by dropping an array of frame images, reorder
 * them, and BAKE them into a uniform strip the runtime plays. Assets bind to
 * the active system (what the preview renders) and are what tex.* node pickers
 * choose from.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../store';
import type { EditorTexture } from '../types';

const EMPTY: EditorTexture[] = [];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}
function readFile(file: File): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.readAsDataURL(file);
  });
}

/** Pack frame images into a 1×N horizontal strip (rows=1, cols=N) — the grid
 *  the runtime animates, one column per frame. Frames are centred in a cell
 *  sized to the largest frame. */
async function bakeStrip(frames: string[]) {
  const imgs = await Promise.all(frames.map(loadImage));
  const fw = Math.max(1, ...imgs.map((i) => i.naturalWidth));
  const fh = Math.max(1, ...imgs.map((i) => i.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = fw * imgs.length;
  canvas.height = fh;
  const ctx = canvas.getContext('2d')!;
  imgs.forEach((img, i) => {
    ctx.drawImage(img, i * fw + (fw - img.naturalWidth) / 2, (fh - img.naturalHeight) / 2);
  });
  return { src: canvas.toDataURL('image/png'), cols: imgs.length, rows: 1, width: canvas.width, height: canvas.height };
}

export function AssetManager() {
  const open = useEditor((s) => s.assetsOpen);
  const setOpen = useEditor((s) => s.setAssetsOpen);
  const textures = useEditor((s) => s.project.textures) ?? EMPTY;
  const activeId = useEditor((s) => (s.project.systemTextures ?? {})[s.activeSystemId] ?? null);
  const activeSystemName = useEditor((s) => s.system().name);
  const addTextureId = useEditor((s) => s.addTextureId);
  const updateTexture = useEditor((s) => s.updateTexture);
  const removeTexture = useEditor((s) => s.removeTexture);
  const setActive = useEditor((s) => s.setActiveTexture);

  const [selId, setSelId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = textures.find((t) => t.id === selId) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  // ── add: a single image (sprite or sheet, configured after) ───────────────
  const addImage = async (file: File) => {
    const src = await readFile(file);
    const img = await loadImage(src);
    const id = addTextureId({
      name: file.name.replace(/\.[^.]+$/, ''),
      src, width: img.naturalWidth, height: img.naturalHeight,
      cols: 1, rows: 1, pad: 0, fps: 12, play: 'loop', pick: 'per-particle',
    });
    setSelId(id);
  };

  // ── add: a sequence from many frame files (baked into a strip) ─────────────
  const addSequence = async (files: File[]) => {
    setBusy(true);
    try {
      const frames = await Promise.all(files.map(readFile));
      const baked = await bakeStrip(frames);
      const id = addTextureId({
        name: 'sequence', ...baked, pad: 0, fps: 12, play: 'loop', pick: 'per-particle', frames,
      });
      setSelId(id);
    } finally {
      setBusy(false);
    }
  };

  // re-bake an edited frame list back into the selected sequence
  const rebake = async (id: string, frames: string[]) => {
    setBusy(true);
    try {
      if (frames.length === 0) { updateTexture(id, { frames: [] }); return; }
      const baked = await bakeStrip(frames);
      updateTexture(id, { ...baked, frames });
    } finally {
      setBusy(false);
    }
  };

  const addBuiltInCoins = async () => {
    const img = await loadImage('/atlas/coins.png');
    const id = addTextureId({
      name: 'coins', src: '/atlas/coins.png', width: img.naturalWidth, height: img.naturalHeight,
      cols: 10, rows: 7, pad: 2, fps: 14, play: 'loop', pick: 'per-particle',
    });
    setSelId(id);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div
        className="flex h-[80vh] w-[min(1000px,92vw)] flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-foreground)' }}>
        {/* header */}
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">Assets</span>
            <span className="text-[11px] text-muted-foreground">textures &amp; animated sequences</span>
          </div>
          <button className="rounded-md px-2 py-1 text-muted-foreground hover:bg-black/20 hover:text-foreground" onClick={() => setOpen(false)}>✕</button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* library */}
          <div className="flex w-[300px] shrink-0 flex-col border-r" style={{ borderColor: 'var(--color-border)' }}>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Library</div>
              {textures.length === 0 && <div className="rounded-md border border-dashed px-3 py-6 text-center text-[11px] text-muted-foreground" style={{ borderColor: 'var(--color-border)' }}>No assets yet — add one below.</div>}
              <div className="grid grid-cols-2 gap-2">
                {textures.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelId(t.id)}
                    className="group/asset relative flex flex-col gap-1 rounded-lg border p-1.5 text-left hover:bg-black/20"
                    style={{ borderColor: t.id === selId ? 'var(--accent, #a78bfa)' : 'var(--color-border)' }}>
                    <div className="grid h-16 place-items-center overflow-hidden rounded bg-black/40">
                      <img src={t.src} alt="" className="max-h-16 max-w-full object-contain" style={{ imageRendering: 'pixelated' }} />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate text-[11px]">{t.name}</span>
                      {t.id === activeId && <span className="rounded bg-[#a78bfa]/20 px-1 text-[8px] text-[#c4b5fd]">live</span>}
                    </div>
                    <span className="font-mono text-[8px] text-muted-foreground">{t.frames ? `${t.frames.length}f` : `${t.cols}×${t.rows}`}</span>
                  </button>
                ))}
              </div>
            </div>
            {/* add actions */}
            <div className="flex flex-col gap-2 border-t p-3 text-[11px]" style={{ borderColor: 'var(--color-border)' }}>
              <label
                className="flex cursor-pointer flex-col items-center gap-0.5 rounded-md border border-dashed py-2.5 text-muted-foreground hover:bg-black/20"
                style={{ borderColor: 'var(--color-border)' }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const fs = [...(e.dataTransfer.files ?? [])].filter((f) => f.type.startsWith('image/')); if (fs.length === 1) void addImage(fs[0]!); else if (fs.length > 1) void addSequence(fs); }}>
                <span>+ Add image</span>
                <span className="text-[9px]">single sprite or sprite sheet</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void addImage(e.target.files[0])} />
              </label>
              <label className="flex cursor-pointer flex-col items-center gap-0.5 rounded-md border border-dashed py-2.5 text-muted-foreground hover:bg-black/20" style={{ borderColor: 'var(--color-border)' }}>
                <span>+ New sequence from files</span>
                <span className="text-[9px]">pick several frames — baked into a strip</span>
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) void addSequence(fs); }} />
              </label>
              <button className="rounded-md border py-1.5 text-muted-foreground hover:bg-black/20" style={{ borderColor: 'var(--color-border)' }} onClick={addBuiltInCoins}>Add built-in coins ↺</button>
            </div>
          </div>

          {/* detail / editor */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!selected ? (
              <div className="grid h-full place-items-center text-[12px] text-muted-foreground">Select an asset to edit it, or add one on the left.</div>
            ) : (
              <AssetDetail
                key={selected.id}
                tex={selected}
                busy={busy}
                isActive={selected.id === activeId}
                activeSystemName={activeSystemName}
                onName={(name) => updateTexture(selected.id, { name })}
                onPatch={(patch) => updateTexture(selected.id, patch)}
                onFrames={(frames) => void rebake(selected.id, frames)}
                onAddFrames={async (files) => {
                  const more = await Promise.all(files.map(readFile));
                  void rebake(selected.id, [...(selected.frames ?? []), ...more]);
                }}
                onUse={() => setActive(selected.id)}
                onDelete={() => { removeTexture(selected.id); setSelId(null); }}
              />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function num(v: string, d: number) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : d; }

function AssetDetail({
  tex, busy, isActive, activeSystemName, onName, onPatch, onFrames, onAddFrames, onUse, onDelete,
}: {
  tex: EditorTexture;
  busy: boolean;
  isActive: boolean;
  activeSystemName: string;
  onName(name: string): void;
  onPatch(patch: Partial<Omit<EditorTexture, 'id'>>): void;
  onFrames(frames: string[]): void;
  onAddFrames(files: File[]): void;
  onUse(): void;
  onDelete(): void;
}) {
  const isSeq = tex.frames !== undefined;
  const move = (i: number, dir: -1 | 1) => {
    const f = [...(tex.frames ?? [])];
    const j = i + dir;
    if (j < 0 || j >= f.length) return;
    [f[i], f[j]] = [f[j]!, f[i]!];
    onFrames(f);
  };
  const removeFrame = (i: number) => onFrames((tex.frames ?? []).filter((_, k) => k !== i));

  return (
    <div className="flex flex-col gap-4 text-[12px]">
      <div className="flex items-center gap-3">
        <input
          className="num flex-1 text-sm" style={{ width: 'auto' }} value={tex.name}
          onChange={(e) => onName(e.target.value)} aria-label="Asset name"
        />
        {busy && <span className="text-[10px] text-amber-300">baking…</span>}
        <button className="rounded-md border px-2.5 py-1 text-muted-foreground hover:bg-black/20 hover:text-foreground" style={{ borderColor: 'var(--color-border)' }} onClick={onDelete}>Delete</button>
      </div>

      <div className="grid place-items-center rounded-lg border bg-[repeating-conic-gradient(#0000_0_25%,#ffffff08_0_50%)] p-3" style={{ borderColor: 'var(--color-border)', backgroundSize: '16px 16px' }}>
        <img src={tex.src} alt="" className="max-h-56 max-w-full object-contain" style={{ imageRendering: 'pixelated' }} />
      </div>

      {isSeq ? (
        <>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Frames ({tex.frames!.length}) — reorder, then it re-bakes automatically</div>
          <div className="flex flex-wrap gap-2">
            {tex.frames!.map((f, i) => (
              <div key={i} className="group/frame relative flex flex-col items-center gap-1 rounded-md border p-1" style={{ borderColor: 'var(--color-border)' }}>
                <img src={f} alt="" className="h-12 w-12 object-contain" style={{ imageRendering: 'pixelated' }} />
                <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                  <button className="px-1 hover:text-foreground disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} title="Move left">◄</button>
                  <span className="font-mono">{i + 1}</span>
                  <button className="px-1 hover:text-foreground disabled:opacity-30" disabled={i === tex.frames!.length - 1} onClick={() => move(i, 1)} title="Move right">►</button>
                  <button className="px-1 hover:text-[#f87171]" onClick={() => removeFrame(i)} title="Remove frame">✕</button>
                </div>
              </div>
            ))}
            <label className="grid h-[74px] w-14 cursor-pointer place-items-center rounded-md border border-dashed text-muted-foreground hover:bg-black/20" style={{ borderColor: 'var(--color-border)' }} title="Add frames">
              +
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) onAddFrames(fs); }} />
            </label>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          <NumField label="cols" v={tex.cols} on={(n) => onPatch({ cols: n })} />
          <NumField label="rows" v={tex.rows} on={(n) => onPatch({ rows: n })} />
          <NumField label="pad" v={tex.pad} on={(n) => onPatch({ pad: n })} />
          <div />
          <div className="col-span-4 text-[10px] text-muted-foreground">
            image {tex.width}×{tex.height} · a sprite sheet is a grid where each <strong>row is a sequence</strong> and columns are frames. Leave cols/rows at 1 for a single sprite.
          </div>
        </div>
      )}

      {/* playback */}
      <div className="grid grid-cols-3 gap-2">
        <NumField label="fps" v={tex.fps} on={(n) => onPatch({ fps: n })} />
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] text-muted-foreground">play</span>
          <select className="sel" value={tex.play} onChange={(e) => onPatch({ play: e.target.value as 'loop' | 'once' })}>
            <option value="loop">loop</option>
            <option value="once">once</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] text-muted-foreground">pick</span>
          <select className="sel" value={tex.pick} onChange={(e) => onPatch({ pick: e.target.value as 'per-particle' | 'per-spawn' })}>
            <option value="per-particle">per particle</option>
            <option value="per-spawn">per spawn</option>
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
        {isActive ? (
          <span className="rounded-md bg-[#a78bfa]/20 px-3 py-1.5 text-[11px] text-[#c4b5fd]">● Rendering on “{activeSystemName}”</span>
        ) : (
          <button className="rounded-md bg-[#a78bfa] px-3 py-1.5 text-[11px] font-medium text-black hover:brightness-110" onClick={onUse}>Use for “{activeSystemName}”</button>
        )}
      </div>
    </div>
  );
}

function NumField({ label, v, on }: { label: string; v: number; on: (n: number) => void }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] text-muted-foreground">{label}</span>
      <input className="num" type="number" min="0" value={v} onChange={(e) => on(num(e.target.value, v))} />
    </label>
  );
}
