/**
 * @pylinka/core — the runtime (REQUIREMENTS.md §7).
 *
 * SHIPPED: the CPU-side, GPU-independent primitives — spawn scheduling, the knob
 * bus, and the frame-time / fixed-step policy. These are fully unit-tested.
 *
 * PENDING (M1.3 R1–R2, R4–R8): the WebGPU BackendProvider, Pool, UniformBus
 * wiring, PipelineCache, ParticleSystemView, PylinkaRuntime, and the instanced
 * renderer. Those are gated on the M1.0 spike (REQUIREMENTS.md §18.1, §20) —
 * device sharing with pixi v8, the view-transform hookup, and the color-storage
 * decision must be validated on real hardware before they are built.
 */
export { SpawnScheduler } from './scheduler.js';
export { KnobStore, type KnobBus } from './knobs.js';
export { clampDt, FixedStepDriver, DEFAULT_MAX_DT } from './time.js';
