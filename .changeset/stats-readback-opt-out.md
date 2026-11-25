---
'@pylinka/core': minor
---

`createPylinka` takes `stats: false` to turn off the GPU particle-count readback behind `stats.aliveCount` / `overflowCount`. On WebGL2 that readback is a synchronous `getBufferSubData` every 30 frames and stalls the GPU pipeline, so production builds that do not show stats should pass `false`. The default stays `true`.
