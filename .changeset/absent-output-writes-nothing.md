---
'@pylinka/core': minor
---

The interpreted WebGL backend no longer invents behaviour for outputs a graph does not have.

`extractParams` fell back to preset values rather than neutral ones, so a system with no `output.initVelocity` spawned every particle at 60–120 px/s upward, and one with no `output.writeScale` shrank it from 8px to nothing over its life. Neither had a node anywhere in the graph to explain it or a way to switch it off, and the compiled backend disagreed on the same graph — it spawns at rest and keeps the size and colour a particle was born with. The interpreted backend now does the same.

Birth velocity also reads more than one node kind. Only a `gen.randomVec2` behind `output.initVelocity` was honoured, so a velocity typed straight into the port, or a knob bound to it, was ignored and the preset used instead. Anything that is not a random range now collapses to a single exact velocity, knobs included.

Effects that wire up `output.initVelocity` and `output.writeScale` — every recipe, template and seed project does — are unchanged. A project that deliberately omits one will now sit still, or hold its size, instead of drifting or fading.
