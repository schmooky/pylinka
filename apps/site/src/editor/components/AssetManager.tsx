/**
 * Asset manager — a full modal (opened from the header) for the project's
 * textures, sprite sequences, and scene references. Load a single sprite or a sprite sheet, or
 * build an animated sequence by dropping an array of frame images, reorder
 * them, and BAKE them into a uniform strip the runtime plays. Assets bind to
 * the active system (what the preview renders) and are what tex.* node pickers
 * choose from.
 *
 * Scene references live here too, on their own tab: they are not particle
 * textures, but they ARE project assets an artist wants to keep and reuse
 * across every effect built for the same screen.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../store';
import type { AtlasPlay } from '@pylinka/core';
import type { EditorTexture } from '../types';
import { VFX_ASSETS, type VfxAsset } from '../../recipes/vfxAssets';
import { addReferenceFile, useReference } from '../reference';

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
  const setActiveBlend = useEditor((s) => s.setActiveBlend);

  const [tab, setTab] = useState<'textures' | 'references'>('textures');
  const [selId, setSelId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
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

  // add a built-in Brackeys VFX texture, and set the blend it wants (opaque
  // sprites want `add`, alpha sprites want `normal`) on the active system.
  const addBuiltInVfx = async (a: VfxAsset) => {
    const img = await loadImage(a.url);
    const id = addTextureId({
      name: a.name, src: a.url, width: img.naturalWidth, height: img.naturalHeight,
      cols: a.cols, rows: a.rows, pad: a.pad, fps: a.fps, play: a.play, pick: a.pick,
    });
    setActiveBlend(a.blend);
    setSelId(id);
    setPickerOpen(false);
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
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">Assets</span>
            <div className="flex gap-1 text-[11px]">
              {(['textures', 'references'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-md px-2 py-1 ${tab === t ? 'bg-black/30 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  {t === 'textures' ? 'Textures' : 'Scene references'}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {tab === 'textures' ? 'particle sprites & animated sequences' : 'the artwork the effect sits on'}
            </span>
          </div>
          <button className="rounded-md px-2 py-1 text-muted-foreground hover:bg-black/20 hover:text-foreground" onClick={() => setOpen(false)}>✕</button>
        </div>

        {tab === 'references' ? (
          <ReferenceTab />
        ) : (
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
              <button className="rounded-md border py-1.5 font-medium text-foreground hover:bg-black/20" style={{ borderColor: 'var(--color-border)' }} onClick={() => setPickerOpen(true)}>✨ Built-in VFX library…</button>
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
        )}
      </div>
      {pickerOpen && <VfxPicker onPick={addBuiltInVfx} onClose={() => setPickerOpen(false)} />}
    </div>,
    document.body,
  );
}

/**
 * Scene-reference library. One click shows an image under the preview; the same
 * image stays in the project, so switching between "on the reels background" and
 * "on the bonus screen" is a click, not a re-import.
 */
function ReferenceTab() {
  const images = useEditor((s) => s.project.references) ?? [];
  const ref = useReference();
  const setReference = useEditor((s) => s.setReference);
  const removeReference = useEditor((s) => s.removeReference);
  const renameReference = useEditor((s) => s.renameReference);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <label
        className="mb-4 flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed py-6 text-[12px] text-muted-foreground hover:bg-black/20"
        style={{ borderColor: 'var(--color-border)' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = [...(e.dataTransfer.files ?? [])].find((x) => x.type.startsWith('image/'));
          if (f) void addReferenceFile(f);
        }}>
        <span className="text-foreground">+ Add a reference image</span>
        <span className="text-[10px]">drop a screenshot of the scene, or click to pick a file</span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && void addReferenceFile(e.target.files[0])}
        />
      </label>

      {images.length === 0 ? (
        <div className="grid place-items-center py-10 text-center text-[12px] text-muted-foreground">
          No references yet. Add the screen this effect plays on and it appears under the preview,
          so scale and contrast are decided against the real background instead of black.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {images.map((r) => (
            <div
              key={r.id}
              className="flex flex-col gap-1.5 rounded-lg border p-2"
              style={{ borderColor: r.id === ref.id ? 'var(--color-foreground)' : 'var(--color-border)' }}>
              <div className="grid h-28 place-items-center overflow-hidden rounded bg-black/40">
                <img src={r.src} alt="" className="max-h-28 max-w-full object-contain" />
              </div>
              <input
                className="num w-full text-[11px]"
                style={{ width: 'auto' }}
                value={r.name}
                onChange={(e) => renameReference(r.id, e.target.value)}
                aria-label="Reference name"
              />
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="font-mono">{r.width}×{r.height}</span>
                <button
                  className="ml-auto rounded px-1.5 py-0.5 hover:bg-black/20 hover:text-foreground"
                  onClick={() => removeReference(r.id)}>
                  Delete
                </button>
                {r.id === ref.id ? (
                  <span className="rounded bg-[#a78bfa]/20 px-1.5 py-0.5 text-[#c4b5fd]">● shown</span>
                ) : (
                  <button
                    className="rounded bg-[#a78bfa] px-1.5 py-0.5 font-medium text-black hover:brightness-110"
                    onClick={() => setReference({ id: r.id, visible: true })}>
                    Show
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Grid of built-in Brackeys VFX textures, grouped by kind. Picking one adds it
 *  to the project (and sets the matching blend) so it shows in the library. */
function VfxPicker({ onPick, onClose }: { onPick(a: VfxAsset): void; onClose(): void }) {
  const groups: { label: string; hint: string; kind: VfxAsset['kind'] }[] = [
    { label: 'Sparks & magic', hint: 'opaque · additive', kind: 'opaque' },
    { label: 'Alpha sprites', hint: 'transparent · normal blend', kind: 'alpha' },
    { label: 'Animated sheets', hint: 'flipbooks & pre-drawn grids', kind: 'sheet' },
  ];
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="flex h-[78vh] w-[min(860px,90vw)] flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-foreground)' }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">Built-in VFX library</span>
            <span className="text-[11px] text-muted-foreground">Brackeys pack · CC0 · {VFX_ASSETS.length} textures</span>
          </div>
          <button className="rounded-md px-2 py-1 text-muted-foreground hover:bg-black/20 hover:text-foreground" onClick={onClose}>✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {groups.map((g) => (
            <div key={g.kind} className="mb-5">
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{g.label}</span>
                <span className="text-[10px] text-muted-foreground">{g.hint}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {VFX_ASSETS.filter((a) => a.kind === g.kind).map((a) => (
                  <button
                    key={a.key}
                    onClick={() => onPick(a)}
                    title={`${a.name} — ${a.cols}×${a.rows} · ${a.blend}`}
                    className="group/vfx flex flex-col gap-1 rounded-lg border p-1.5 text-left hover:bg-black/20"
                    style={{ borderColor: 'var(--color-border)' }}>
                    <div className="grid aspect-square place-items-center overflow-hidden rounded bg-[repeating-conic-gradient(#0000_0_25%,#ffffff08_0_50%)] bg-black/50" style={{ backgroundSize: '12px 12px' }}>
                      <img src={a.url} alt="" className="max-h-full max-w-full object-contain" />
                    </div>
                    <span className="truncate text-[10px]">{a.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
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
        <NumField label="fps" v={tex.fps} on={(n) => onPatch({ fps: n })} disabled={tex.play === 'once'} />
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] text-muted-foreground">play</span>
          <select className="sel" value={tex.play} onChange={(e) => onPatch({ play: e.target.value as AtlasPlay })}>
            <option value="loop">loop at fps</option>
            <option value="once">stretch over life</option>
            <option value="hold">once at fps, hold</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] text-muted-foreground">pick</span>
          <select className="sel" value={tex.pick} onChange={(e) => onPatch({ pick: e.target.value as 'per-particle' | 'per-spawn' })}>
            <option value="per-particle">per particle</option>
            <option value="per-spawn">per spawn</option>
          </select>
        </label>
        <div className="col-span-3 text-[10px] text-muted-foreground">
          {tex.play === 'once'
            ? 'Stretch over life ignores fps — the sequence always finishes exactly as the particle dies, whatever its lifetime. Pick a mode below if you want the frame rate to be the thing that decides.'
            : tex.play === 'hold'
              ? `Plays through once at ${tex.fps} fps (${(tex.cols / Math.max(tex.fps, 1)).toFixed(2)}s for ${tex.cols} frames), then stays on the last frame.`
              : `Cycles forever at ${tex.fps} fps — one pass every ${(tex.cols / Math.max(tex.fps, 1)).toFixed(2)}s over ${tex.cols} frames.`}
        </div>
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

function NumField({ label, v, on, disabled }: { label: string; v: number; on: (n: number) => void; disabled?: boolean }) {
  return (
    <label className={`flex flex-col gap-0.5 ${disabled ? 'opacity-40' : ''}`}>
      <span className="text-[9px] text-muted-foreground">{label}</span>
      <input
        className="num"
        type="number"
        min="0"
        value={v}
        disabled={disabled}
        title={disabled ? 'This playback mode ignores fps' : undefined}
        onChange={(e) => on(num(e.target.value, v))}
      />
    </label>
  );
}
