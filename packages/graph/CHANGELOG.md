# @pylinka/graph

## 2.0.0

### Major Changes

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - **Behaviour change:** angles in the catalog are DEGREES unless the node says otherwise.

  Typing 45 into a radian port turns a sprite seven times round and lands somewhere arbitrary, which is indistinguishable from rotation not working — and that is how it was reported. `output.initRotation`, `output.writeRotation` and `gen.spin` now carry a structural `unit` (`degrees` by default, `radians` if you say so). The unit lives on the DESTINATION, so it is set once per angle rather than on every node feeding it, and a `math.radians` node in front of a port still wins: graphs that convert for themselves — including every recipe — are untouched, and neither backend converts twice.

  `gen.spin`'s default rate moved from `π` to `180`, which is the same half-turn a second in the new unit, and `gen.rotationOverLife`'s `to` moved from `2π` to `360` for the same reason. Both backends read the unit the same way, so a preview and a shipped game agree about what 45 means.

  Also: `output.deathBurst`'s `max` offered powers of two, which reads like a hardware limit and is not one — it is a ceiling on children per parent event, sizing the child pool and the per-frame passes. The options are useful numbers now (1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64), and a new `W104_BURST_CLAMPED` warning fires when `countMax` asks for more than that ceiling, which used to just silently drop the extra children.

### Minor Changes

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Sub-emitter links are part of the project format, and loading one wires them up.

  A system whose particles are born from another's was stored as `subEmitters` on the project — an undeclared extra key, written by the editor and read by nothing on the loading side. `PylinkaProject` had no such field, `createParticles` never looked for it, and `createCompiledParticles` did not either: a project that worked in the editor came back from a file as a set of unrelated systems, with the child spawning at its own emitter instead of on its parent's deaths. It read as the link not having been saved. It was saved; nothing read it.

  `subEmitters` is now a documented field on `PylinkaProject` (`child system id` → `parent system id`), part of the document rather than editor decoration.

  **Loading a project now runs it.** `createParticles(canvas, project)` and `createCompiledParticles(canvas, project)` build EVERY enabled system with the links wired, and return one handle over all of them: `update` steps them parents-first, `setKnob` and `setEmitter` reach every system, `spawnBurst` reaches only the ones that are not born from another (bursting a sub-emitter means nothing — its particles come from its parent's), and the clear belongs to the first so the rest composite on top. Pass `systemName` for the old single-system behaviour.

  Also new in `@pylinka/core`: `systemsInBuildOrder(project)` returns the enabled systems parents-first along with the links that survived (a link to a muted or missing system is dropped rather than taking the child down with it; a cycle keeps its systems), and `buildProject(project, create)` walks that order, hands each child its parent's handle, and returns something that steps every system in the same order — a child reads the parent's state from the frame it is in, so the parent has to move first.

  The pixi runtime already resolved the links and is unchanged; the editor now shares the same ordering rather than keeping a second copy of it.

### Patch Changes

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - `W101_CAPACITY_OVERFLOW` covers burst and one-shot emitters, not just `flow`.

  Bursts overlap whenever the lifetime outlasts the interval, so 120 particles every 0.5s that live for 2s is 480 alive at the peak — and `capacity` is a hard ceiling the scheduler clamps to, silently. That was the mode most likely to blow the pool and the one mode the check skipped. A one-shot larger than the pool is now flagged too, and the message says outright that the excess is dropped without a word.

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - `W107_EMITTER_NEVER_FIRES`: a repeating burst with no count or no interval.

  The scheduler counts down an interval to decide when to fire, so `0` is not "as fast as possible" — it is an emitter that silently emits nothing, forever. The editor clamps the field, but an imported or hand-written project can hold it, and an emitter that produces nothing looks like a broken graph rather than a setting.

## 1.4.0

### Minor Changes

- [`765ddf8`](https://github.com/schmooky/pylinka/commit/765ddf8e1c45bcbd2b5ed618277a112060a33e1f) - Sub-emitters can spawn on a parent's **birth**, and sprite sheets gain the playback mode where `fps` actually means something.

  **Birth-triggered sub-emitters.** A child system only ever spawned on its parent's death — debris where a projectile ends. The other half of the idea was missing: a flash the instant one appears. A bolt of lightning and the light it throws are born on the same frame, and there was no way to say that. `output.deathBurst` gains a structural `on: 'death' | 'birth'`. Both are one-frame edges on the same parent slot, read from the same buffers, so a birth costs exactly what a death costs — it is the comparison that flips, in all three backends. It is a compile-time constant, so a graph that never asks for it emits byte-identical shaders.

  **`AtlasPlay: 'hold'`.** `play: 'once'` stretches the strip across the particle's lifetime, so the sequence always finishes exactly as the particle dies — a useful mode, but it ignores `fps` entirely, which made a changed `fps` look broken. Rather than change what `once` means (effects rely on it), `hold` is the mode that plays through once **at** `fps` and stays on the last frame. `loop` and `once` keep their exact shader expressions, so nothing authored on either shifts a frame.

  `AtlasPlay` and `playCode` are exported from `@pylinka/core`.

## 1.3.0

### Minor Changes

- [#20](https://github.com/schmooky/pylinka/pull/20) [`ae8963b`](https://github.com/schmooky/pylinka/commit/ae8963b59fdce2f26869680233fda6212c2b6f4d) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Rotation you can actually author.

  `output.writeRotation` existed, but nothing an artist could wire into it made a sprite turn: the interpreted WebGL backend never read an angle at all, and no node could set one at spawn. Three nodes close the gap.

  - `output.initRotation` — the angle a particle is born at. Feed it a `gen.randomRange` so each one starts somewhere different, or a literal to pin them all. Previously every particle spawned at zero, so a burst spun in lockstep and read as one rigid object.
  - `gen.spin` — an angular velocity in radians per second, integrated over the particle's own age. This is the term that was missing: feeding a constant into `output.writeRotation` sets an angle, it does not turn anything.
  - `gen.rotationOverLife` — an eased sweep between two angles, for a tile that turns exactly ninety degrees as it falls and then stops.

  Plus `math.radians`, since every angle port in the catalog is radians and artists type degrees.

  All three terms sum, so a shard can start at a random angle, tumble at its own rate, and settle. The interpreted backend derives the angle from the seed and age each particle already carries rather than widening the particle state, and rotates the sprite quad rather than the texture lookup, so an atlas cell turns instead of shearing. The compiled backends already drew with an angle and now honour the spawn-time write.

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

## 0.3.0

### Minor Changes

- [#3](https://github.com/schmooky/pylinka/pull/3) [`3aa652f`](https://github.com/schmooky/pylinka/commit/3aa652f00439fe7e77ee68c0b08b193434135c5b) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Support multiple eases per system. The compiler now emits one ease function per distinct ease key (`easeFnName`: `sine.out` → `easeSel_sine_out`) and each over-life node calls its own via `CodegenCtx.ease(key)`, instead of inlining a single `easeSel` and throwing `one ease per system`. This fixes every recipe that mixes eases (e.g. color `sine.out` + scale `linear`) — all swirl/vortex recipes now compile on the WebGPU path. Adds `ease()` to the `CodegenCtx` interface.

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

## 0.1.0

### Minor Changes

- First public release.

  - `@pylinka/graph` — graph types, node catalog (emitters, fields, forces, masks, splines), validation, hashing, slot assignment. Zero runtime deps.
  - `@pylinka/compiler` — SystemBundle → IR → GPU codegen (WGSL + GLSL ES 3.00 transform-feedback). Golden byte-locked.
  - `@pylinka/format` — versioned project format: parse, serialize (inline↔blob assets), migrate.
  - `@pylinka/core` — runtime: `@pylinka/core/webgl` WebGL2 transform-feedback engine (`createParticles`), CPU scheduler, knob bus, live-uniform knob updates without recompiles; pixi v8 render pipe under `@pylinka/core/pixi` (peer `pixi.js@^8`, optional).
