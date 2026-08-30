---
'@pylinka/core': minor
---

More of the interpreted WebGL backend's fallbacks now agree with the graph.

**A field wired to nothing does nothing.** Fields are found by kind rather than by following wires, so a `field.gravity` dropped on the canvas and left unconnected pulled on the whole effect, and deleting the `output.addForce` it fed changed nothing at all. A field now needs an outgoing edge to count. The test is coarse — this backend cannot follow a force through a math node, so it does not check where the wire goes — but a node connected to nothing no longer acts.

**Gravity and drag accumulate.** `output.addForce` and `output.drag` are accumulating outputs, and the compiler emits `force +=` / `dragK +=`, but here a second node of the same kind replaced the first. Two gravity nodes are now one stronger pull, and two drags one stronger drag.

**Knobs reach more places.** Gravity, the vortex centre and the radial centre read their knob bindings, the way `field.obstacle` and the wind strength already did. Lifetime does too: `output.initLife` behind anything other than a `gen.randomRange` read the port's raw literal only, so a knob-driven lifetime silently fell back to the 1–1.5s default.

Recipes, templates and the seed project wire every field they use and none of them carry two of a kind, so their output is unchanged.
