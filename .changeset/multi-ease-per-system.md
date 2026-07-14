---
"@pylinka/compiler": patch
"@pylinka/graph": minor
---

Support multiple eases per system. The compiler now emits one ease function per distinct ease key (`easeFnName`: `sine.out` → `easeSel_sine_out`) and each over-life node calls its own via `CodegenCtx.ease(key)`, instead of inlining a single `easeSel` and throwing `one ease per system`. This fixes every recipe that mixes eases (e.g. color `sine.out` + scale `linear`) — all swirl/vortex recipes now compile on the WebGPU path. Adds `ease()` to the `CodegenCtx` interface.
