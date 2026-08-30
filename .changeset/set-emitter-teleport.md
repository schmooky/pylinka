---
'@pylinka/core': minor
---

`setEmitter(x, y, teleport?)` — move the emitter without counting the distance travelled.

That distance is what `rateOverDistance` turns into spawns, which is the feature that lays a trail behind a dragged emitter. It also means jumping the emitter somewhere for a single frame fires a spawn proportional to how far it jumped, and another one when it jumps back — so placing a one-off burst produced two large dumps instead of the burst you asked for. Measured on a `rate: 420, rateOverDistance: 1.4` emitter, one 100-particle burst placed 178px away spawned 356 particles at the target and 256 more at the origin on the next frame; with `teleport` it spawns 100.

Teleport when the move is a cut rather than a motion: placing a burst, or repositioning between shots. Leave it off to keep the trail. Available on the interpreted and both compiled backends.
