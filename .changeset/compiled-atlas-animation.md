---
"@pylinka/core": minor
---

Animated sprite atlases now play on the compiled WebGPU and WebGL2 backends. Previously the compiled render drew a single static atlas cell (frame 0, row 0), so every particle showed the same frame and colour — spinning coins didn't spin and per-particle "random colour" rows all collapsed to one. The render pipelines now receive `age`/`life`/`seed` and the atlas animation uniforms (fps, play, pick, grid, frame/pad), and compute the cell exactly like the interpreted backend: the column advances over life (loop by `age·fps`, or once-over-life) and the row is per-particle (or a fixed row for `per-spawn`). `CompiledAtlasOptions` gains `frameW`/`frameH`/`pad`/`fps`/`play`/`pick`/`row`. Masks and sub-emitters remain interpreted-only.
