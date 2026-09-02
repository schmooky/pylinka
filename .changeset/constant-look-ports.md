---
'@pylinka/core': patch
---

Size, alpha and rotation read a constant on the port, not just a ramp node.

The interpreted WebGL backend took these from `gen.scaleOverLife` / `gen.alphaOverLife` / `gen.rotationOverLife` (and the generic `numberOverLife` / `curveOverLife` behind the matching output) and nothing else. A literal typed into `output.writeScale`, or a knob bound to it — the way a game sets particle size at runtime — was ignored, and every particle came out at the 8px default. A constant is now treated as a ramp that does not move, knobs included; `output.writeRotation` also follows a `math.radians` hop, the same as the birth angle does.

Nothing changes for a graph that uses ramp nodes, which is every recipe and template.
