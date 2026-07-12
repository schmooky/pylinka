/**
 * @pylinka/core/pixi — pixi v8 render-graph integration (REQUIREMENTS.md §11.5,
 * docs/SPIKE-RESULTS "S2"). Depends on pixi.js (peer). Import from
 * '@pylinka/core/pixi'; the base '@pylinka/core' entry stays pixi-free.
 *
 * ```ts
 * import { registerPylinka, createPylinka } from '@pylinka/core/pixi';
 * registerPylinka();                       // once, before app init
 * const app = new Application();
 * await app.init({ ... });                 // WebGPU or WebGL — backend follows
 * const fx = await createPylinka(project, { renderer: app.renderer });
 * app.stage.addChild(fx.systems['sparks'].view);
 * app.ticker.add((t) => fx.update(t.deltaMS / 1000));
 * fx.params.set('windPower', 40);          // live, zero recompile
 * ```
 */
export { ParticleView } from './particle-view.js';
export { PylinkaRenderPipe } from './pipe.js';
export { PylinkaApplicationPlugin } from './plugin.js';
export { registerPylinka, unregisterPylinka } from './register.js';
export { resolveBackend, type ResolvedBackend } from './backend.js';
export { registerCompiledBackends } from './backends.js';
export {
  createPylinka,
  createParticleSystem,
  type CreateOptions,
  type ParticleSystemView,
  type PylinkaRuntime,
} from './runtime.js';
export {
  registerSimBackend,
  getSimBackendFactory,
  type Affine,
  type SimBackend,
  type SimBackendDeps,
  type SimBackendFactory,
  type SimStats,
} from './sim.js';
