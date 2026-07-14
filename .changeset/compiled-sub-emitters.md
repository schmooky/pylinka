---
"@pylinka/core": minor
"@pylinka/compiler": minor
---

Sub-emitters now work on the compiled WebGPU and WebGL2 backends. A child system configured to spawn on a parent's particle deaths ("↳ deaths of …") now fires on the compiled path exactly as it does interpreted — one particle spawned at each parent death, running the child's own graph — instead of falling back to a clock-driven emitter.

Detection is transition-based and needs no changes to the existing emit/update kernels (no golden churn): the compiler emits a `subSrc` per target — a WebGPU `subEmit` compute kernel that reads the parent's hot/meta buffers plus a child-owned `prevAlive` shadow (bindings 8/9/10) and pops from the child's own pool, and a fused WebGL2 sub-step that reads the parent's current + previous ping-pong state (like the interpreted sub-emitter). `CompiledParticlesOptions.subParent` wires a parent handle; the editor forwards its sub-emitter links. The child mirrors the parent's capacity.
