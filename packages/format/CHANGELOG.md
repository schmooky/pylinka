# @pylinka/format

## 0.2.0

### Minor Changes

- [`09b8040`](https://github.com/schmooky/pylinka/commit/09b8040f7fcac8ef8b5d80956b7601a2aec7ddeb) - The promised GPU backends, delivered end-to-end — every graph now runs as generated GPU code:

  **@pylinka/compiler**

  - `compile(bundle, catalog, 'webgl2')` is implemented: the generated node bodies are translated
    WGSL→GLSL (typed lets, `select()`→ternary, vector-compare builtins) and spliced into a fused
    GLSL ES 3.00 transform-feedback step shader (cursor-window spawning, §13.12). `emitSrc` = the
    step vertex shader, `updateSrc` = the discard fragment stage; the interleaved 56-byte state
    layout ships as `WEBGL2_LAYOUT`. Golden-locked like the WGSL target.
  - WGSL scaffolds fix: the §13.2 binding was named `meta`, a **reserved WGSL keyword** that real
    drivers (Dawn) reject — renamed `pmeta` (first hardware validation of the §13 contract).

  **@pylinka/core**

  - `@pylinka/core/webgpu` — the WebGPU compute backend: §13.2 buffers (STORAGE|VERTEX), emit +
    update kernel dispatch, §13.8 instanced render pipeline with §13.1 blend modes, exactly two
    `writeBuffer`s per frame, async counter readback every 30 frames. Handles on one canvas share
    a device/context (multi-system compositing).
  - `@pylinka/core/webgl2` — the compiled WebGL2 transform-feedback backend running the new
    compiler target on ping-pong interleaved buffers.
  - `@pylinka/core/gpu` — `createCompiledParticles(canvas, project, { backend: 'auto' | 'webgpu'
| 'webgl2' })`: one call, best available compiled backend, same handle either way. Knob moves
    and value edits write the vec4 slot table (zero recompile); structural edits rebuild pipelines
    and reset the pool — and a structurally-invalid intermediate edit keeps the previous pipelines
    running instead of killing the effect.
  - `@pylinka/core/pixi` — the §11.5 runtime is real: `createPylinka` / `createParticleSystem`
    build a `ParticleView` per system on the host pixi v8 renderer (WebGPU shares the device;
    WebGL shares the GL context), with `follow()`, project-wide `KnobBus` fan-out, fixed-step
    mode, per-system `apply()` live edits, and stats. Raw-command interop uses pixi's sanctioned
    encoder restore on WebGPU and targeted state-cache resets on WebGL — verified live with scene
    interleaving on both hosts.

### Patch Changes

- Updated dependencies [[`09b8040`](https://github.com/schmooky/pylinka/commit/09b8040f7fcac8ef8b5d80956b7601a2aec7ddeb)]:
  - @pylinka/graph@0.2.0

## 0.1.0

### Minor Changes

- First public release.

  - `@pylinka/graph` — graph types, node catalog (emitters, fields, forces, masks, splines), validation, hashing, slot assignment. Zero runtime deps.
  - `@pylinka/compiler` — SystemBundle → IR → GPU codegen (WGSL + GLSL ES 3.00 transform-feedback). Golden byte-locked.
  - `@pylinka/format` — versioned project format: parse, serialize (inline↔blob assets), migrate.
  - `@pylinka/core` — runtime: `@pylinka/core/webgl` WebGL2 transform-feedback engine (`createParticles`), CPU scheduler, knob bus, live-uniform knob updates without recompiles; pixi v8 render pipe under `@pylinka/core/pixi` (peer `pixi.js@^8`, optional).

### Patch Changes

- Updated dependencies []:
  - @pylinka/graph@0.1.0
