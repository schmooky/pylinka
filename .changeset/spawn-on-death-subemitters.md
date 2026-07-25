---
"@pylinka/graph": minor
"@pylinka/compiler": minor
"@pylinka/core": minor
---

Add spawn-on-death sub-emitters (`output.deathBurst`)

A new `output.deathBurst` node bursts a child system when a parent particle
dies — RevoltFX-style explosions (e.g. exploding ships). Configurable spawn
count (one, many, or a random distribution), a `max` clamp (1–64), and velocity
inheritance from the dying parent. Works on all three backends: WebGPU compute,
WebGL2 transform-feedback, and the interpreted WebGL runtime.
