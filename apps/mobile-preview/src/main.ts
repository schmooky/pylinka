/**
 * Pylinka · Particle Probe — a standalone mobile harness that runs every recipe
 * on the real compiled GPU backends (WebGPU / WebGL2), shows a live debug
 * read-out, and cycles presets on tap. Hostable side by side with the site.
 */
import './style.css';
import { createCompiledParticles, type CompiledParticlesHandle } from '@pylinka/core/gpu';
import { PRESETS, type Preset } from './presets';

// ── preset → runtime plumbing ────────────────────────────────────────────────

type Backend = 'webgpu' | 'webgl2';

/** Enabled systems for a preset (curated presets have no sub-emitter ordering). */
function orderedSystems(preset: Preset): Preset['project']['systems'] {
  return preset.project.systems.filter((s) => s.enabled !== false);
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
  index = (next + PRESETS.length) % PRESETS.length;
  const preset = PRESETS[index]!;

  for (const h of handles) h.destroy();
  handles = [];
  sizeCanvas();

  const systems = orderedSystems(preset);
  const built: CompiledParticlesHandle[] = [];

  for (let i = 0; i < systems.length; i++) {
    const sys = systems[i]!;
    try {
      if (gen !== generation) return; // superseded by a newer tap
      const h = await createCompiledParticles(canvas, preset.project, {
        systemName: sys.name,
        backend,
      });
      h.autoClear = i === 0; // first clears, the rest composite
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

  presetName.textContent = preset.title;
  presetSub.innerHTML =
    `<span class="idx">${index + 1} / ${PRESETS.length}</span> · ${preset.group}` +
    ` · ${preset.tags.slice(0, 3).join(' ')}`;
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
  const preset = PRESETS[index];
  if (!preset) return;
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
  const systems = preset.project.systems.filter((s) => s.enabled !== false);
  const capacity = systems.reduce((s, sys) => s + sys.capacity, 0);
  const blends = [...new Set(systems.map((s) => s.blendMode))].join(',');
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
    metricsRow('group', preset.group);
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
