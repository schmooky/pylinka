---
'@pylinka/core': minor
---

Pylinka now runs on WebGL1. Both WebGL backends simulate with transform feedback, which WebGL1 does not have, so a WebGL1 context gets a third backend: the simulation runs on the CPU and only the draw uses the GPU.

`createPylinka` picks it on its own when pixi runs WebGL1 (`preferWebGLVersion: 1`, or a device without WebGL2), in the same GL context, so particles still interleave with the scene, masks and filters. `createParticles` from `@pylinka/core/webgl` falls back to a WebGL1 context when the browser has no WebGL2, and takes a new `simulation: 'cpu'` option to run the CPU path on any context, which shows what a WebGL1 device will draw.

The CPU step is a port of the interpreted WebGL2 step: the same node patterns (`INTERPRETED_KINDS`), cursor-window spawning, forces, colliders, emission masks, atlases and sub-emitters with death and birth bursts. A node outside that list contributes nothing on WebGL1, as on the interpreted engine. It draws only alive particles, with `ANGLE_instanced_arrays`. Particle state survives a lost context, since it lives on the CPU.

Caveats are listed in the core README under "WebGL1: downsides and caveats". In short: compiled-only nodes are skipped and `createPylinka` warns about them; the main thread pays for every particle; results match the GPU statistically, not particle for particle; only `f32`/`vec2` knobs reach the CPU simulation; and a context without `ANGLE_instanced_arrays` simulates but draws nothing. Each view under `createPylinka` gets its own seed, so two copies of one effect no longer move in lockstep.

Two fixes in this change also touch the WebGL2 backend under `createPylinka`: both GL backends now re-sync pixi's state caches right after they create their GL objects. Before this, creating an effect mid-session could leave the next pixi draw using stale bindings.
