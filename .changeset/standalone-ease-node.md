---
"@pylinka/graph": minor
"@pylinka/compiler": minor
---

Add a standalone `gen.ease` curve node with custom cubic-bezier

`gen.ease` is a plug-in easing node: wire it into any input to shape a value
over life with a named preset or a custom cubic-bezier. It runs on the compiled
backends and evaluates identically in the interpreted JS ease sampler, so
presets and hand-authored curves match across backends. The node is
inferred-time (like `math.*`), so it composes with update-only inputs.
