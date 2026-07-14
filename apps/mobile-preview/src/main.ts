/**
 * Pylinka · Particle Probe — a standalone mobile harness that runs every recipe
 * on the real compiled GPU backends (WebGPU / WebGL2), shows a live debug
 * read-out, and cycles presets on tap. Hostable side by side with the site.
 */
import './style.css';
import { createCompiledParticles, type CompiledParticlesHandle } from '@pylinka/core/gpu';
import { RECIPES, type Recipe } from '../../site/src/recipes/data';

// ── recipe → runtime plumbing (a slim mirror of the editor's Preview) ────────

type Backend = 'webgpu' | 'webgl2';
type Atlas = NonNullable<Recipe['atlas']>;
type MaskDef = { src: string; width: number; offset?: [number, number] };
type ProjectWithExtras = Recipe['project'] & { systemMasks?: Record<string, MaskDef> };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`image failed: ${src}`));
    img.src = src;
  });
}

function atlasFor(recipe: Recipe, sysId: string): Atlas | undefined {
  if (recipe.systemAtlases?.[sysId]) return recipe.systemAtlases[sysId];
  if (recipe.atlas && sysId === recipe.project.systems[0]?.id) return recipe.atlas;
  return undefined;
}

async function buildAtlasOpts(a: Atlas) {
  const image = await loadImage(a.url);
  return {
    image,
    cols: a.cols,
    rows: a.rows,
    frameW: a.frameW,
    frameH: a.frameH,
    pad: a.pad,
    fps: a.fps,
    play: a.play,
    pick: a.pick,
  };
}

async function buildMaskOpts(m: MaskDef) {
  const image = await loadImage(m.src);
  return { image, width: m.width, ...(m.offset ? { offset: m.offset } : {}) };
}

/** Enabled systems, parents before children (so a sub-emitter finds its parent). */
function orderedSystems(recipe: Recipe): typeof recipe.project.systems {
  const systems = recipe.project.systems.filter((s) => s.enabled !== false);
  const ids = new Set(systems.map((s) => s.id));
  const links = recipe.subEmitters ?? {};
  const parentOf = (id: string) => (links[id] && ids.has(links[id]) ? links[id] : undefined);
  const out: typeof systems = [];
  const placed = new Set<string>();
  let guard = systems.length + 1;
  while (out.length < systems.length && guard-- > 0) {
    for (const s of systems) {
      if (placed.has(s.id)) continue;
      const p = parentOf(s.id);
      if (!p || placed.has(p)) {
        out.push(s);
        placed.add(s.id);
      }
    }
  }
  for (const s of systems) if (!placed.has(s.id)) out.push(s);
  return out;
}

// ── app state ────────────────────────────────────────────────────────────────

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const hudEl = document.getElementById('hud') as HTMLDivElement;
const presetName = document.querySelector('#preset .preset-name') as HTMLDivElement;
const presetSub = document.querySelector('#preset .preset-sub') as HTMLDivElement;
const flashEl = document.getElementById('flash') as HTMLDivElement;

// compiled shaders only: this harness always runs the compiled GPU pipeline
// (graph → generated WGSL/GLSL), never the interpreted backend. WebGPU when
// available, else the WebGL2 compiled backend — both run compiled shaders.
const backend: Backend =
  typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'webgl2';
let adapterInfo = '';

let index = 0;
let handles: CompiledParticlesHandle[] = [];
let generation = 0; // guards against races when tapping fast
let loadedAt = performance.now();

const dpr = Math.min(window.devicePixelRatio || 1, 2);
function sizeCanvas(): void {
  canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
}

let flashTimer = 0;
function flash(msg: string, isErr = false): void {
  flashEl.textContent = msg;
  flashEl.className = 'flash show' + (isErr ? ' err' : '');
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => (flashEl.className = 'flash'), 1100);
}

async function mount(next: number): Promise<void> {
  const gen = ++generation;
  index = (next + RECIPES.length) % RECIPES.length;
  const recipe = RECIPES[index]!;

  for (const h of handles) h.destroy();
  handles = [];
  sizeCanvas();

  const systems = orderedSystems(recipe);
  const proj = recipe.project as ProjectWithExtras;
  const byId = new Map<string, CompiledParticlesHandle>();
  const built: CompiledParticlesHandle[] = [];

  for (let i = 0; i < systems.length; i++) {
    const sys = systems[i]!;
    const a = atlasFor(recipe, sys.id);
    const m = proj.systemMasks?.[sys.id];
    const parentId = (recipe.subEmitters ?? {})[sys.id];
    const parent = parentId ? byId.get(parentId) : undefined;
    try {
      const atlas = a ? await buildAtlasOpts(a) : undefined;
      const emissionMask = m ? await buildMaskOpts(m) : undefined;
      if (gen !== generation) return; // superseded by a newer tap
      const h = await createCompiledParticles(canvas, recipe.project, {
        systemName: sys.name,
        backend,
        ...(atlas ? { atlas } : {}),
        ...(emissionMask ? { emissionMask } : {}),
        ...(parent ? { subParent: parent } : {}),
      });
      h.autoClear = i === 0; // first clears, the rest composite
      byId.set(sys.id, h);
      built.push(h);
    } catch (err) {
      flash(String((err as Error).message ?? err), true);
    }
  }
  if (gen !== generation) {
    for (const h of built) h.destroy();
    return;
  }
  handles = built;
  loadedAt = performance.now();

  presetName.textContent = recipe.title;
  presetSub.innerHTML =
    `<span class="idx">${index + 1} / ${RECIPES.length}</span> · ${recipe.group}` +
    ` · ${recipe.tags.slice(0, 3).join(' ')}`;
}

// ── frame loop + metrics ─────────────────────────────────────────────────────

let last = performance.now();
// rolling frame-time window (ms) for min / avg / max
const win: number[] = [];
const WIN = 90;
let hudAt = 0;

function metricsRow(k: string, v: string, cls = ''): string {
  return `<div class="row"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
}

function renderHud(fpsInst: number): void {
  const recipe = RECIPES[index];
  if (!recipe) return;
  const sorted = [...win].sort((a, b) => a - b);
  const avg = win.reduce((s, x) => s + x, 0) / (win.length || 1);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? max;

  let alive = 0;
  let overflow = 0;
  let gpuMs: number | null = null;
  for (const h of handles) {
    const s = h.stats;
    alive += s.aliveCount;
    overflow += s.overflowCount;
    if (s.gpuMs != null) gpuMs = (gpuMs ?? 0) + s.gpuMs;
  }
  const systems = recipe.project.systems.filter((s) => s.enabled !== false);
  const capacity = systems.reduce((s, sys) => s + sys.capacity, 0);
  const blends = [...new Set(systems.map((s) => s.blendMode))].join(',');
  const hasAtlas = !!(recipe.atlas || recipe.systemAtlases);
  const hasMask = !!(recipe.project as ProjectWithExtras).systemMasks;
  const hasSub = !!recipe.subEmitters;
  const fillPct = capacity ? Math.round((alive / capacity) * 100) : 0;
  const fpsCls = fpsInst >= 55 ? 'good' : fpsInst >= 30 ? 'warn' : 'warn';
  const uptime = ((performance.now() - loadedAt) / 1000).toFixed(1);

  hudEl.innerHTML =
    `<div class="sec">renderer</div>` +
    metricsRow('backend', backend, 'accent') +
    (adapterInfo ? metricsRow('gpu', adapterInfo) : '') +
    metricsRow('canvas', `${canvas.width}×${canvas.height}`) +
    metricsRow('dpr', `${dpr} · ${window.innerWidth}×${window.innerHeight}css`) +
    `<div class="sec">frame</div>` +
    metricsRow('fps', `${fpsInst.toFixed(0)}`, fpsCls) +
    metricsRow('cpu ms', `${avg.toFixed(2)} avg`) +
    metricsRow('', `${min.toFixed(2)} / ${p95.toFixed(2)} / ${max.toFixed(2)} (lo/95/hi)`) +
    (gpuMs != null ? metricsRow('gpu ms', gpuMs.toFixed(2)) : '') +
    metricsRow('uptime', `${uptime}s`) +
    `<div class="sec">particles</div>` +
    metricsRow('alive', `${alive.toLocaleString()}`, 'good') +
    metricsRow('capacity', `${capacity.toLocaleString()} · ${fillPct}%`) +
    metricsRow('overflow', `${overflow.toLocaleString()}`, overflow > 0 ? 'warn' : '') +
    metricsRow('draws', `${handles.length}`) +
    `<div class="sec">preset</div>` +
    metricsRow('systems', `${systems.length} · ${blends}`) +
    metricsRow('features', [hasAtlas && 'atlas', hasMask && 'mask', hasSub && 'sub'].filter(Boolean).join(' ') || '—');
}

function loop(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  win.push(dt * 1000);
  if (win.length > WIN) win.shift();

  if (handles.length) {
    // emitter fixed at the canvas centre — just spawn, no orbit
    const ex = canvas.width / 2;
    const ey = canvas.height / 2;
    for (const h of handles) {
      h.setEmitter(ex, ey);
      h.update(dt);
    }
  }

  if (now - hudAt > 160) {
    hudAt = now;
    renderHud(1 / (dt || 1 / 60));
  }
  requestAnimationFrame(loop);
}

// ── input + boot ─────────────────────────────────────────────────────────────

function nextPreset(): void {
  void mount(index + 1);
}
canvas.addEventListener('pointerdown', nextPreset);
document.getElementById('preset')!.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  nextPreset();
});

window.addEventListener('resize', sizeCanvas);

async function boot(): Promise<void> {
  if (backend === 'webgpu') {
    try {
      const adapter = await (navigator as unknown as {
        gpu: { requestAdapter(): Promise<{ info?: { vendor?: string; architecture?: string } } | null> };
      }).gpu.requestAdapter();
      const info = adapter?.info;
      if (info) adapterInfo = [info.vendor, info.architecture].filter(Boolean).join(' ') || '';
    } catch {
      /* adapter info is best-effort */
    }
  }
  await mount(0);
  requestAnimationFrame(loop);
}

void boot();
