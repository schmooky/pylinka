# @pylinka/compiler

## 1.2.0

### Minor Changes

- [#18](https://github.com/schmooky/pylinka/pull/18) [`c0d95f9`](https://github.com/schmooky/pylinka/commit/c0d95f9778c91431577df8f2bc044c448bad1333) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Multi-keyframe ease curves, plus `gen.numberOverLife` and `gen.alphaOverLife`.

  An ease was fixed at two endpoints — a named preset or a single
  `cubic-bezier(...)` — so shaping "fade in, hold, snap out" meant stacking nodes.
  The `ease` param now also accepts `curve(x,y,ix,iy,ox,oy; …)`: 2 to 12 keyframes
  joined by cubic Béziers, where each group is a keyframe followed by the offsets
  of its incoming and outgoing handles. A 2-key curve is exactly the equivalent
  `cubic-bezier(...)`, so converting between the two forms is lossless.

  `@pylinka/compiler` gains `parseCurve`, `formatCurve`, `normalizeCurve`,
  `sampleCurve`, `splitCurveAt` (shape-preserving keyframe insertion by de
  Casteljau subdivision), `removeCurveKey`, `curveFromBezier`, `curveFromEase`
  (fits any ease to the fewest keyframes that stay within 0.4% of it — most of
  the §13.9 catalogue is exactly two), `isCurveEase`, `sampleEaseLut`, and the
  `CurveKey` type. Curves compile to WGSL and GLSL ES 3.00 alongside the existing
  flavours, emitting the Newton solve once regardless of keyframe count.

  `@pylinka/core`'s interpreted WebGL backend previously rendered any non-preset
  ease as `linear`, because its fixed-function shader selects an ease by integer
  index — this silently affected `cubic-bezier(...)` too. It now bakes any ease it
  cannot name into a 32-sample LUT uniform across three channels (size, colour,
  alpha); presets keep their exact analytic path. That backend also gains alpha
  ramp support, which it previously had no representation for at all.

  `@pylinka/graph` adds `gen.numberOverLife` and `gen.alphaOverLife`.

  Fixes `SpawnScheduler` being replaced rather than retargeted on `apply()`. It
  carries fractional spawn debt, so re-reading an edited project every frame — what
  a live-editing host does — floored a 30/s flow emitter to zero spawns forever and
  stopped burst emitters from ever firing. `SpawnScheduler.setEmitter()` swaps the
  settings while keeping the accumulators, re-arming only when the mode changes
  into one-shot.

### Patch Changes

- Updated dependencies [[`c0d95f9`](https://github.com/schmooky/pylinka/commit/c0d95f9778c91431577df8f2bc044c448bad1333)]:
  - @pylinka/graph@1.2.0

## 1.1.0

### Minor Changes

- [#16](https://github.com/schmooky/pylinka/pull/16) [`f7b0e65`](https://github.com/schmooky/pylinka/commit/f7b0e656accd8be00504faf5ef0531ffd2de5213) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Add spawn-on-death sub-emitters (`output.deathBurst`)

  A new `output.deathBurst` node bursts a child system when a parent particle
  dies — RevoltFX-style explosions (e.g. exploding ships). Configurable spawn
  count (one, many, or a random distribution), a `max` clamp (1–64), and velocity
  inheritance from the dying parent. Works on all three backends: WebGPU compute,
  WebGL2 transform-feedback, and the interpreted WebGL runtime.

- [#16](https://github.com/schmooky/pylinka/pull/16) [`f7b0e65`](https://github.com/schmooky/pylinka/commit/f7b0e656accd8be00504faf5ef0531ffd2de5213) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Add a standalone `gen.ease` curve node with custom cubic-bezier

  `gen.ease` is a plug-in easing node: wire it into any input to shape a value
  over life with a named preset or a custom cubic-bezier. It runs on the compiled
  backends and evaluates identically in the interpreted JS ease sampler, so
  presets and hand-authored curves match across backends. The node is
  inferred-time (like `math.*`), so it composes with update-only inputs.

### Patch Changes

- Updated dependencies [[`f7b0e65`](https://github.com/schmooky/pylinka/commit/f7b0e656accd8be00504faf5ef0531ffd2de5213), [`f7b0e65`](https://github.com/schmooky/pylinka/commit/f7b0e656accd8be00504faf5ef0531ffd2de5213)]:
  - @pylinka/graph@1.1.0

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

## 0.5.0

### Minor Changes

- [#10](https://github.com/schmooky/pylinka/pull/10) [`2194ba1`](https://github.com/schmooky/pylinka/commit/2194ba1282146f2375387437fffaef6e42534243) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Sub-emitters now work on the compiled WebGPU and WebGL2 backends. A child system configured to spawn on a parent's particle deaths ("↳ deaths of …") now fires on the compiled path exactly as it does interpreted — one particle spawned at each parent death, running the child's own graph — instead of falling back to a clock-driven emitter.

  Detection is transition-based and needs no changes to the existing emit/update kernels (no golden churn): the compiler emits a `subSrc` per target — a WebGPU `subEmit` compute kernel that reads the parent's hot/meta buffers plus a child-owned `prevAlive` shadow (bindings 8/9/10) and pops from the child's own pool, and a fused WebGL2 sub-step that reads the parent's current + previous ping-pong state (like the interpreted sub-emitter). `CompiledParticlesOptions.subParent` wires a parent handle; the editor forwards its sub-emitter links. The child mirrors the parent's capacity.

## 0.4.0

### Minor Changes

- [#7](https://github.com/schmooky/pylinka/pull/7) [`d8a4b06`](https://github.com/schmooky/pylinka/commit/d8a4b0626e5fc4cb4f736739e44ae38ff988067e) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Emission masks now work on the compiled WebGPU and WebGL2 backends. A painted mask is rasterised into a point table of emitter-relative spawn offsets; the compiled emit kernel samples one per spawn instead of the graph's analytic shape (matching the interpreted backend). WebGPU binds the table as a read-only storage buffer (binding 7); WebGL2 samples an RG32F texture. `CompiledParticlesOptions` gains `emissionMask`. The compiler's emit/step scaffolds gained the mask sampling (emit WGSL binding + WebGL2 step uniforms); the update kernel is unchanged.

## 0.3.0

### Patch Changes

- [#3](https://github.com/schmooky/pylinka/pull/3) [`3aa652f`](https://github.com/schmooky/pylinka/commit/3aa652f00439fe7e77ee68c0b08b193434135c5b) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Support multiple eases per system. The compiler now emits one ease function per distinct ease key (`easeFnName`: `sine.out` → `easeSel_sine_out`) and each over-life node calls its own via `CodegenCtx.ease(key)`, instead of inlining a single `easeSel` and throwing `one ease per system`. This fixes every recipe that mixes eases (e.g. color `sine.out` + scale `linear`) — all swirl/vortex recipes now compile on the WebGPU path. Adds `ease()` to the `CodegenCtx` interface.

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
