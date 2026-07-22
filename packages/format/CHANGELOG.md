# @pylinka/format

## 1.0.0

### Major Changes

- Particles can react to things now.

  `field.obstacle` is a body that moves through the field. It shoves particles out of a disc, adds a
  swirl around the edge, and drags them along with it, so something crossing a dust cloud gets a bow
  wave in front and a curling wake behind. Bind its centre and velocity to knobs and a cursor or a
  flying sprite drives it every frame.

  `output.collidePlane`, `output.collideRect` and `output.collideCircle` give you floors, walls,
  boxes and discs. Particles land on them, bounce with `restitution`, slide with `friction`, and stop
  passing through. The rect works as a container or as a solid crate, and the circle can be handed a
  velocity so a moving wall kicks what it hits.

  All four read their geometry either in world coordinates or relative to the emitter. Emitter space
  is what you want for a floor that follows a character, or for an effect that has to survive a
  change of canvas size.

  `setKnob` and `params.set` take a second component now. That is how a pointer position reaches a
  vec2 port without touching the graph.

  An effect that uses none of this compiles to exactly the same GPU code it did before.

  The gallery has a `physics` group with six new effects, and there is a sandbox at `/interactive`
  for pushing a field around with the cursor.

### Patch Changes

- Updated dependencies []:
  - @pylinka/graph@1.0.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`3aa652f`](https://github.com/schmooky/pylinka/commit/3aa652f00439fe7e77ee68c0b08b193434135c5b)]:
  - @pylinka/graph@0.3.0

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
