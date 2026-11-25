# @pylinka/revoltfx

## 0.1.0

### Minor Changes

- [#33](https://github.com/schmooky/pylinka/pull/33) [`0c4df9c`](https://github.com/schmooky/pylinka/commit/0c4df9cb3bc5038138eb3d642287ee3e134c833e) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - New package: play RevoltFX effect bundles with Pylinka. `convertEffect` turns a RevoltFX emitter or sequence into a `PylinkaProject`, with a fidelity report that lists every setting that did not carry over exactly. `createRevoltFxEffect` (`@pylinka/revoltfx/pixi`) plays it through `createPylinka` with RevoltFX's own spawn timing, delays and triggers. See MAPPING.md for the feature-by-feature mapping.

### Patch Changes

- Updated dependencies [[`6099ca1`](https://github.com/schmooky/pylinka/commit/6099ca1edf2c4f74874e3a24a77fad592b8ee436)]:
  - @pylinka/graph@2.3.0
  - @pylinka/compiler@2.3.0
