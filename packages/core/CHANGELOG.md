# @pylinka/core

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
  - @pylinka/compiler@1.0.0

## 0.5.0

### Minor Changes

- [#10](https://github.com/schmooky/pylinka/pull/10) [`2194ba1`](https://github.com/schmooky/pylinka/commit/2194ba1282146f2375387437fffaef6e42534243) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Sub-emitters now work on the compiled WebGPU and WebGL2 backends. A child system configured to spawn on a parent's particle deaths ("↳ deaths of …") now fires on the compiled path exactly as it does interpreted — one particle spawned at each parent death, running the child's own graph — instead of falling back to a clock-driven emitter.

  Detection is transition-based and needs no changes to the existing emit/update kernels (no golden churn): the compiler emits a `subSrc` per target — a WebGPU `subEmit` compute kernel that reads the parent's hot/meta buffers plus a child-owned `prevAlive` shadow (bindings 8/9/10) and pops from the child's own pool, and a fused WebGL2 sub-step that reads the parent's current + previous ping-pong state (like the interpreted sub-emitter). `CompiledParticlesOptions.subParent` wires a parent handle; the editor forwards its sub-emitter links. The child mirrors the parent's capacity.

### Patch Changes

- Updated dependencies [[`2194ba1`](https://github.com/schmooky/pylinka/commit/2194ba1282146f2375387437fffaef6e42534243)]:
  - @pylinka/compiler@0.5.0

## 0.4.0

### Minor Changes

- [#7](https://github.com/schmooky/pylinka/pull/7) [`d8a4b06`](https://github.com/schmooky/pylinka/commit/d8a4b0626e5fc4cb4f736739e44ae38ff988067e) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Animated sprite atlases now play on the compiled WebGPU and WebGL2 backends. Previously the compiled render drew a single static atlas cell (frame 0, row 0), so every particle showed the same frame and colour — spinning coins didn't spin and per-particle "random colour" rows all collapsed to one. The render pipelines now receive `age`/`life`/`seed` and the atlas animation uniforms (fps, play, pick, grid, frame/pad), and compute the cell exactly like the interpreted backend: the column advances over life (loop by `age·fps`, or once-over-life) and the row is per-particle (or a fixed row for `per-spawn`). `CompiledAtlasOptions` gains `frameW`/`frameH`/`pad`/`fps`/`play`/`pick`/`row`. Masks and sub-emitters remain interpreted-only.

- [#7](https://github.com/schmooky/pylinka/pull/7) [`d8a4b06`](https://github.com/schmooky/pylinka/commit/d8a4b0626e5fc4cb4f736739e44ae38ff988067e) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Emission masks now work on the compiled WebGPU and WebGL2 backends. A painted mask is rasterised into a point table of emitter-relative spawn offsets; the compiled emit kernel samples one per spawn instead of the graph's analytic shape (matching the interpreted backend). WebGPU binds the table as a read-only storage buffer (binding 7); WebGL2 samples an RG32F texture. `CompiledParticlesOptions` gains `emissionMask`. The compiler's emit/step scaffolds gained the mask sampling (emit WGSL binding + WebGL2 step uniforms); the update kernel is unchanged.

### Patch Changes

- Updated dependencies [[`d8a4b06`](https://github.com/schmooky/pylinka/commit/d8a4b0626e5fc4cb4f736739e44ae38ff988067e)]:
  - @pylinka/compiler@0.4.0

## 0.3.1

### Patch Changes

- [#5](https://github.com/schmooky/pylinka/pull/5) [`a0fafd8`](https://github.com/schmooky/pylinka/commit/a0fafd878ce20c136acf474e61265c135084fcc6) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Fix compiled backends drawing particles 8× too small. The WebGPU and WebGL2 render pipelines drew each sprite at its raw normalized scale (a `writeScale` of 1 → a 1px quad), while the interpreted WebGL runtime bakes an 8px base sprite size into its size uniforms. The compiled backends now apply the same `BASE_SPRITE_PX` base via the render size-scale uniform, so a scale of 1 draws an 8px sprite — the three preview modes now match. `rnd.size` stays a normalized scale; the base pixel size is a rendering concern.

## 0.3.0

### Patch Changes

- Updated dependencies [[`3aa652f`](https://github.com/schmooky/pylinka/commit/3aa652f00439fe7e77ee68c0b08b193434135c5b)]:
  - @pylinka/compiler@0.3.0
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
  - @pylinka/compiler@0.2.0
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
  - @pylinka/compiler@0.1.0
