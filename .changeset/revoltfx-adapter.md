---
'@pylinka/revoltfx': minor
---

New package: play RevoltFX effect bundles with Pylinka. `convertEffect` turns a RevoltFX emitter or sequence into a `PylinkaProject`, with a fidelity report that lists every setting that did not carry over exactly. `createRevoltFxEffect` (`@pylinka/revoltfx/pixi`) plays it through `createPylinka` with RevoltFX's own spawn timing, delays and triggers. See MAPPING.md for the feature-by-feature mapping.
