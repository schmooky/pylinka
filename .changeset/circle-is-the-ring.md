---
'@pylinka/core': major
---

**Behaviour change:** in the interpreted WebGL backend, `shape.circle` now spawns on the RING rather than across the filled disc.

The compiled backends have always emitted `vec2(cos a, sin a) * radius` — the outline — and the catalog implies as much by offering `shape.torus` alongside it. The interpreted one multiplied by `sqrt(random)` as well, filling the disc, so the same graph spawned one way in an editor preview and another way in a shipped game running a compiled backend. This is the one divergence between the two that was a difference of meaning rather than of coverage.

**If a project of yours uses `shape.circle` and wants a filled blob, change it to `shape.torus` with `innerRadius` 0.** The site's recipes and emitter templates were migrated that way, so the gallery keeps the look it was authored with. Note that a torus samples its radius linearly, so a blob built this way is a little denser at the centre than the old disc, which was uniform by area.
