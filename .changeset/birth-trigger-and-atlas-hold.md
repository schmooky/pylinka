---
'@pylinka/graph': minor
'@pylinka/compiler': minor
'@pylinka/core': minor
---

Sub-emitters can spawn on a parent's **birth**, and sprite sheets gain the playback mode where `fps` actually means something.

**Birth-triggered sub-emitters.** A child system only ever spawned on its parent's death — debris where a projectile ends. The other half of the idea was missing: a flash the instant one appears. A bolt of lightning and the light it throws are born on the same frame, and there was no way to say that. `output.deathBurst` gains a structural `on: 'death' | 'birth'`. Both are one-frame edges on the same parent slot, read from the same buffers, so a birth costs exactly what a death costs — it is the comparison that flips, in all three backends. It is a compile-time constant, so a graph that never asks for it emits byte-identical shaders.

**`AtlasPlay: 'hold'`.** `play: 'once'` stretches the strip across the particle's lifetime, so the sequence always finishes exactly as the particle dies — a useful mode, but it ignores `fps` entirely, which made a changed `fps` look broken. Rather than change what `once` means (effects rely on it), `hold` is the mode that plays through once **at** `fps` and stays on the last frame. `loop` and `once` keep their exact shader expressions, so nothing authored on either shifts a frame.

`AtlasPlay` and `playCode` are exported from `@pylinka/core`.
