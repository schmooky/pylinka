/**
 * @pylinka/core/pixi — pixi v8 render-graph integration (docs/SPIKE-RESULTS
 * "S2"). Depends on pixi.js (peer). Import from '@pylinka/core/pixi'; the base
 * '@pylinka/core' entry stays pixi-free.
 *
 * The scene-graph wiring here is complete and typed against pixi v8. The GPU
 * backend that plugs into SimBackend (compute dispatch + instanced draw) is
 * gated on the M1.0 spike (REQUIREMENTS §18.1, §20).
 */
export { ParticleView } from './particle-view.js';
export { PylinkaRenderPipe } from './pipe.js';
export { PylinkaApplicationPlugin } from './plugin.js';
export { registerPylinka, unregisterPylinka } from './register.js';
export { resolveBackend, type ResolvedBackend } from './backend.js';
export {
  registerSimBackend,
  getSimBackendFactory,
  type Affine,
  type SimBackend,
  type SimBackendDeps,
  type SimBackendFactory,
  type SimStats,
} from './sim.js';
