---
"@pylinka/core": patch
---

Fix compiled backends drawing particles 8× too small. The WebGPU and WebGL2 render pipelines drew each sprite at its raw normalized scale (a `writeScale` of 1 → a 1px quad), while the interpreted WebGL runtime bakes an 8px base sprite size into its size uniforms. The compiled backends now apply the same `BASE_SPRITE_PX` base via the render size-scale uniform, so a scale of 1 draws an 8px sprite — the three preview modes now match. `rnd.size` stays a normalized scale; the base pixel size is a rendering concern.
