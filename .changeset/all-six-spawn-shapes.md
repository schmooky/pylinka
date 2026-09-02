---
'@pylinka/core': minor
---

The interpreted WebGL backend implements all six spawn shapes.

It branched on `shape.circle` and `shape.rectangle` only. `shape.torus`, `shape.burstRing` and `shape.polygonalChain` fell through to a point, so picking one in the editor changed nothing and said nothing, and `shape.point` dropped its own `offset`. The compiled backend has always implemented all six, so the same graph spawned differently depending on which backend ran it — and the `shockwave` recipe, whose whole shape is a ring, had been rendering as a dot.

The shape now lives in one `shapeOffset()` helper shared by both spawn paths, so they cannot drift apart again. `burstRing` lays its particles out evenly by spawn index where there is one, matching the compiled backend; a sub-emitter spawns on parent deaths rather than in a numbered window, so it spaces by burst copy when it is a death burst and takes a random angle otherwise.

Two shape ports also stopped ignoring knobs (rectangle `size`, chain `start`/`end`), and the fallbacks for an empty port are the catalog's defaults now rather than numbers this file invented — a circle with no radius is 50, the schema default, not 40.
