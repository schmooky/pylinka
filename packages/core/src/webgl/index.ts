/**
 * @pylinka/core/webgl — a usable WebGL2 particle runtime.
 *
 * Drop a pylinka project onto a canvas and drive it. The simulation runs on the
 * GPU via transform feedback (REQUIREMENTS §13.12); no WebGPU required. This is
 * the pragmatic v1 runtime — it interprets the common node patterns (spawn
 * shape, random velocity/life, gravity, wind, drag, colour/scale over life) into
 * a fixed GPU model. Effects with unrecognised nodes still run (those nodes are
 * ignored).
 *
 * @example
 * ```ts
 * import { createParticles } from '@pylinka/core/webgl';
 * const fx = createParticles(canvas, project);
 * fx.setEmitter(x, y);
 * app.ticker?.add?.(() => fx.update(1 / 60)); // or your own rAF loop
 * fx.setKnob('windPower', 40);
 * ```
 */
import type { PylinkaProject } from '@pylinka/graph';
import { SpawnScheduler } from '../scheduler.js';
import { clampDt } from '../time.js';
import { WebGL2Engine } from './engine.js';
import { extractParams, type EngineParams } from './params.js';

export interface ParticlesHandle {
  /** Step the simulation and render one frame. Call once per rAF tick. */
  update(dtSeconds: number): void;
  /** Move where new particles are born (world/canvas pixels). */
  setEmitter(x: number, y: number): void;
  /** Emit an extra burst next frame. */
  spawnBurst(count: number): void;
  /** Set a named knob live (e.g. 'windPower', 'windDir'). */
  setKnob(name: string, value: number): void;
  /**
   * Re-read an edited project into the running effect with no restart (the
   * uniform-driven live-edit path for editors). Returns false if a change needs
   * a full re-create (only pool capacity does) — recreate via createParticles.
   */
  apply(project: PylinkaProject): boolean;
  /** Whether the canvas should be cleared each frame (default true). */
  autoClear: boolean;
  /** Alive particle count. Synchronous GPU readback — for debug/stats, not per-frame. */
  aliveCount(): number;
  destroy(): void;
}

export interface ParticlesOptions {
  /** Which system to run (defaults to the first enabled system). */
  systemName?: string;
  /** dt clamp in seconds (default 0.05). */
  maxDt?: number;
  /**
   * View zoom-out factor (default 1). Renders a larger world region into the
   * canvas, so effects authored for a full-size game view fit inside small
   * thumbnails. Emitter/mouse coordinates stay in canvas pixels.
   */
  zoom?: number;
  /** Particle sprite size multiplier (default 1) — keeps thumbnails legible. */
  sizeScale?: number;
}

export { extractParams, parseColor, type EngineParams } from './params.js';
export { WebGL2Engine } from './engine.js';

export function createParticles(
  target: HTMLCanvasElement | WebGL2RenderingContext,
  project: PylinkaProject,
  opts: ParticlesOptions = {},
): ParticlesHandle {
  const gl =
    target instanceof WebGL2RenderingContext
      ? target
      : target.getContext('webgl2', { premultipliedAlpha: true, alpha: true });
  if (!gl) throw new Error('WebGL2 is not available on this target.');

  const system =
    project.systems.find((s) => s.name === opts.systemName) ??
    project.systems.find((s) => s.enabled) ??
    project.systems[0];
  if (!system) throw new Error('Project has no systems.');

  // knob values seeded from ParamDef defaults (by name)
  const knobValues: Record<string, number> = {};
  for (const p of project.params) if (p.default.t === 'f32') knobValues[p.name] = p.default.v;

  const params: EngineParams = extractParams(system, project.params, knobValues);
  const engine = new WebGL2Engine(gl, params, opts.sizeScale ?? 1);
  let scheduler = new SpawnScheduler(system.emitter, params.capacity);
  const systemName = system.name;
  const maxDt = opts.maxDt ?? 0.05;

  const canvas = gl.canvas as HTMLCanvasElement;
  const zoom = opts.zoom ?? 1;
  let ex = (canvas.width * zoom) / 2;
  let ey = (canvas.height * zoom) / 2;
  let px = ex;
  let py = ey;
  const wind: [number, number] = [0, 0];
  const recomputeWind = () => {
    wind[0] = Math.cos(params.windDir) * params.windPower;
    wind[1] = Math.sin(params.windDir) * params.windPower;
  };
  recomputeWind();

  const handle: ParticlesHandle = {
    autoClear: true,
    update(dtSeconds: number) {
      const dt = clampDt(dtSeconds, maxDt);
      const dist = Math.hypot(ex - px, ey - py);
      const spawnCount = scheduler.tick(dt, dist);
      engine.step(dt, spawnCount, [ex, ey], wind, params);

      gl.viewport(0, 0, canvas.width, canvas.height);
      if (this.autoClear) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      engine.render(canvas.width * zoom, canvas.height * zoom, params);

      px = ex;
      py = ey;
    },
    setEmitter(x: number, y: number) {
      ex = x * zoom;
      ey = y * zoom;
    },
    spawnBurst(count: number) {
      scheduler.spawnBurst(count);
    },
    setKnob(name: string, value: number) {
      knobValues[name] = value;
      if (name === params.windPowerKnob) params.windPower = value;
      if (name === params.windDirKnob) params.windDir = value;
      recomputeWind();
    },
    apply(next: PylinkaProject): boolean {
      const sys =
        next.systems.find((s) => s.name === systemName) ??
        next.systems.find((s) => s.enabled) ??
        next.systems[0];
      if (!sys) return false;
      for (const pd of next.params) if (pd.default.t === 'f32' && !(pd.name in knobValues)) knobValues[pd.name] = pd.default.v;
      const np = extractParams(sys, next.params, knobValues);
      if (np.capacity !== params.capacity) return false; // needs a full re-create
      Object.assign(params, np);
      scheduler = new SpawnScheduler(sys.emitter, params.capacity);
      recomputeWind();
      return true;
    },
    aliveCount() {
      return engine.aliveCount();
    },
    destroy() {
      engine.destroy();
    },
  };
  return handle;
}
