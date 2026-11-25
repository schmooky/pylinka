---
'@pylinka/graph': minor
'@pylinka/compiler': minor
'@pylinka/core': minor
---

New graph features, added to play RevoltFX effects faithfully and useful on their own:

- `math.atan2`, `input.rotation` and `input.dt` nodes. Turn a sprite to its velocity heading, spin from the birth angle, and step a value per frame. `input.time` is now readable at spawn too.
- `output.writeScaleXY`: separate width and height scale. Both compiled backends store an aspect per particle.
- `multiply` blend mode on every backend.
- Emitter timeline: `delay`, `duration`, and `burst.countMax` / `intervalMax` / `immediate` for random burst counts and waits and a first burst at start. Scheduler randomness follows the `seed` option.
- Sub-emitter events beyond death and birth on `output.deathBurst`: `age` (the parent reaches `at` seconds), `bounce` (a parent collide output resolved a hit) and `alive` (`rate` times a second while the parent lives, i.e. trails). `input.spawnIndex` is the index within a burst. The `max` cap rises to 128.
