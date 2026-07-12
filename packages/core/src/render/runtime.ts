/**
 * The §11.5 runtime API: createPylinka / createParticleSystem. Each enabled
 * system becomes a ParticleView (a pixi renderable — add `view` to a STATIC
 * layer, §7.3) driven by a SimBackend on the host renderer's device/context.
 * Knobs fan out project-wide through one shared KnobStore; `update(dt)` runs
 * the CPU side (§13.11 steps 1–4) and the GPU work happens when pixi renders
 * the views (PylinkaRenderPipe.execute).
 */
import type { PylinkaProject, System, SystemBundle } from '@pylinka/graph';
import { KnobStore, type KnobBus } from '../knobs.js';
import { clampDt, DEFAULT_MAX_DT, FixedStepDriver } from '../time.js';
import { resolveBackend } from './backend.js';
import { registerCompiledBackends } from './backends.js';
import { ParticleView } from './particle-view.js';
import { getSimBackendFactory, type SimBackend, type SimStats } from './sim.js';

export interface CreateOptions {
  /** The host pixi Renderer (app.renderer). Backend + device derive from it. */
  renderer: unknown;
  /** seconds; enables deterministic fixed-step mode (e.g. 1/60) */
  fixedStep?: number;
  /** dt clamp, default 0.05 */
  maxDt?: number;
  /** deterministic base seed (capture mode) */
  seed?: number;
  onDeviceLost?: () => void;
}

/** A pixi Container with a global-position getter (structural, any DisplayObject). */
interface Followable {
  getGlobalPosition(): { x: number; y: number };
}

export interface ParticleSystemView {
  /** pixi Container (a ParticleView) — add to a STATIC layer (§7.3). */
  readonly view: ParticleView;
  readonly params: KnobBus;
  /** Advance the CPU side; no-op work happens at pixi render time. */
  update(dtSeconds: number): void;
  setEmitterPosition(x: number, y: number): void;
  /** Sample `target.getGlobalPosition()` into the emitter each update (§7.3). */
  follow(target: unknown): void;
  unfollow(): void;
  spawnBurst(count: number): void;
  restart(): void;
  /** Re-read an edited project (zero-recompile for value edits, §7.5). */
  apply(project: PylinkaProject): boolean;
  readonly stats: SimStats;
  destroy(): void;
}

export interface PylinkaRuntime {
  /** keyed by System.name */
  readonly systems: Record<string, ParticleSystemView>;
  /** project-wide knob fan-out */
  readonly params: KnobBus;
  /** once per rAF tick; clamps / fixed-steps internally */
  update(dtSeconds: number): void;
  destroy(): void;
}

class SystemHandle implements ParticleSystemView {
  readonly view: ParticleView;
  readonly params: KnobBus;
  private readonly sim: SimBackend;
  private target: Followable | undefined;
  private destroyed = false;

  constructor(view: ParticleView, sim: SimBackend, params: KnobBus) {
    this.view = view;
    this.sim = sim;
    this.params = params;
  }

  update(dtSeconds: number): void {
    if (this.destroyed) return;
    if (this.target !== undefined) {
      const p = this.target.getGlobalPosition();
      this.sim.setEmitter(p.x, p.y);
    }
    this.sim.prepare(dtSeconds);
  }

  setEmitterPosition(x: number, y: number): void {
    this.sim.setEmitter(x, y);
  }

  follow(target: unknown): void {
    if (typeof (target as Followable | null)?.getGlobalPosition !== 'function') {
      throw new Error('follow() target must expose getGlobalPosition() (any pixi Container).');
    }
    this.target = target as Followable;
  }

  unfollow(): void {
    this.target = undefined;
  }

  spawnBurst(count: number): void {
    this.sim.spawnBurst(count);
  }

  restart(): void {
    this.sim.restart();
  }

  apply(project: PylinkaProject): boolean {
    return this.sim.apply(project);
  }

  get stats(): SimStats {
    return this.sim.stats;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.view.sim = undefined; // the pipe must not double-destroy
    this.sim.destroy();
    this.view.destroy();
  }
}

function buildSystem(
  system: System,
  project: Pick<PylinkaProject, 'params'>,
  knobs: KnobStore,
  opts: CreateOptions,
): SystemHandle {
  registerCompiledBackends();
  const resolved = resolveBackend(opts.renderer as Parameters<typeof resolveBackend>[0]);
  const factory = getSimBackendFactory(resolved.kind);
  if (factory === undefined) {
    throw new Error(`No SimBackend registered for '${resolved.kind}'.`);
  }
  if (resolved.device === undefined || resolved.device === null) {
    throw new Error(
      `The host renderer exposed no ${resolved.kind === 'webgpu' ? 'GPUDevice' : 'WebGL2 context'} — ` +
        'pass a constructed pixi Renderer (await app.init() first).',
    );
  }
  const view = new ParticleView();
  const sim = factory({
    backend: resolved.kind,
    device: resolved.device,
    renderer: opts.renderer,
    system,
    params: project.params,
    knobs,
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
  });
  view.sim = sim;
  return new SystemHandle(view, sim, knobs);
}

function watchDeviceLost(opts: CreateOptions): void {
  if (opts.onDeviceLost === undefined) return;
  const gpu = (opts.renderer as { gpu?: { device?: { lost?: Promise<unknown> } } }).gpu;
  gpu?.device?.lost?.then(() => opts.onDeviceLost?.()).catch(() => undefined);
}

/** Build one system (§11.5). The bundle's system runs regardless of `enabled`. */
export async function createParticleSystem(
  bundle: SystemBundle,
  opts: CreateOptions,
): Promise<ParticleSystemView> {
  const knobs = new KnobStore(bundle.params);
  watchDeviceLost(opts);
  return buildSystem(bundle.system, { params: bundle.params }, knobs, opts);
}

/** Build every enabled system of a project (§11.5). */
export async function createPylinka(
  project: PylinkaProject,
  opts: CreateOptions,
): Promise<PylinkaRuntime> {
  const knobs = new KnobStore(project.params);
  watchDeviceLost(opts);
  const systems: Record<string, ParticleSystemView> = {};
  const handles: SystemHandle[] = [];
  for (const sys of project.systems) {
    if (!sys.enabled) continue;
    const h = buildSystem(sys, project, knobs, opts);
    systems[sys.name] = h;
    handles.push(h);
  }

  const maxDt = opts.maxDt ?? DEFAULT_MAX_DT;
  const driver = opts.fixedStep !== undefined ? new FixedStepDriver(opts.fixedStep, maxDt) : undefined;

  return {
    systems,
    params: knobs,
    update(dtSeconds: number) {
      if (driver !== undefined) {
        const n = driver.steps(dtSeconds);
        for (let i = 0; i < n; i++) {
          for (const h of handles) h.update(opts.fixedStep!);
        }
        return;
      }
      const dt = clampDt(dtSeconds, maxDt);
      for (const h of handles) h.update(dt);
    },
    destroy() {
      for (const h of handles) h.destroy();
    },
  };
}
