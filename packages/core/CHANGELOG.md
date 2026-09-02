# @pylinka/core

## 2.0.0

### Major Changes

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - **Behaviour change:** angles in the catalog are DEGREES unless the node says otherwise.

  Typing 45 into a radian port turns a sprite seven times round and lands somewhere arbitrary, which is indistinguishable from rotation not working — and that is how it was reported. `output.initRotation`, `output.writeRotation` and `gen.spin` now carry a structural `unit` (`degrees` by default, `radians` if you say so). The unit lives on the DESTINATION, so it is set once per angle rather than on every node feeding it, and a `math.radians` node in front of a port still wins: graphs that convert for themselves — including every recipe — are untouched, and neither backend converts twice.

  `gen.spin`'s default rate moved from `π` to `180`, which is the same half-turn a second in the new unit, and `gen.rotationOverLife`'s `to` moved from `2π` to `360` for the same reason. Both backends read the unit the same way, so a preview and a shipped game agree about what 45 means.

  Also: `output.deathBurst`'s `max` offered powers of two, which reads like a hardware limit and is not one — it is a ceiling on children per parent event, sizing the child pool and the per-frame passes. The options are useful numbers now (1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64), and a new `W104_BURST_CLAMPED` warning fires when `countMax` asks for more than that ceiling, which used to just silently drop the extra children.

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - **Behaviour change:** in the interpreted WebGL backend, `shape.circle` now spawns on the RING rather than across the filled disc.

  The compiled backends have always emitted `vec2(cos a, sin a) * radius` — the outline — and the catalog implies as much by offering `shape.torus` alongside it. The interpreted one multiplied by `sqrt(random)` as well, filling the disc, so the same graph spawned one way in an editor preview and another way in a shipped game running a compiled backend. This is the one divergence between the two that was a difference of meaning rather than of coverage.

  **If a project of yours uses `shape.circle` and wants a filled blob, change it to `shape.torus` with `innerRadius` 0.** The site's recipes and emitter templates were migrated that way, so the gallery keeps the look it was authored with. Note that a torus samples its radius linearly, so a blob built this way is a little denser at the centre than the old disc, which was uniform by area.

### Minor Changes

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The interpreted WebGL backend no longer invents behaviour for outputs a graph does not have.

  `extractParams` fell back to preset values rather than neutral ones, so a system with no `output.initVelocity` spawned every particle at 60–120 px/s upward, and one with no `output.writeScale` shrank it from 8px to nothing over its life. Neither had a node anywhere in the graph to explain it or a way to switch it off, and the compiled backend disagreed on the same graph — it spawns at rest and keeps the size and colour a particle was born with. The interpreted backend now does the same.

  Birth velocity also reads more than one node kind. Only a `gen.randomVec2` behind `output.initVelocity` was honoured, so a velocity typed straight into the port, or a knob bound to it, was ignored and the preset used instead. Anything that is not a random range now collapses to a single exact velocity, knobs included.

  Effects that wire up `output.initVelocity` and `output.writeScale` — every recipe, template and seed project does — are unchanged. A project that deliberately omits one will now sit still, or hold its size, instead of drifting or fading.

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The interpreted WebGL backend implements all six spawn shapes.

  It branched on `shape.circle` and `shape.rectangle` only. `shape.torus`, `shape.burstRing` and `shape.polygonalChain` fell through to a point, so picking one in the editor changed nothing and said nothing, and `shape.point` dropped its own `offset`. The compiled backend has always implemented all six, so the same graph spawned differently depending on which backend ran it — and the `shockwave` recipe, whose whole shape is a ring, had been rendering as a dot.

  The shape now lives in one `shapeOffset()` helper shared by both spawn paths, so they cannot drift apart again. `burstRing` lays its particles out evenly by spawn index where there is one, matching the compiled backend; a sub-emitter spawns on parent deaths rather than in a numbered window, so it spaces by burst copy when it is a death burst and takes a random angle otherwise.

  Two shape ports also stopped ignoring knobs (rectangle `size`, chain `start`/`end`), and the fallbacks for an empty port are the catalog's defaults now rather than numbers this file invented — a circle with no radius is 50, the schema default, not 40.

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - A handle stays bound to the system it was created for, even after a rename.

  `apply()` re-resolved the system by NAME on every live edit, with a fall-through to "the first enabled system". Renaming an emitter therefore did not fail — the handle silently rebound to a different system and started rendering another effect. In the editor, where renaming a tab does not rebuild the preview, that is exactly what happened. Handles now re-resolve by system id, which survives a rename, and fall back to the name only if the id is gone.

  A `systemName` that matches nothing still falls back rather than throwing — a game asking for an effect that was renamed should not go down — but it now warns once, naming the systems the project does have. It used to play a different effect in silence.

  `pickSystem` moved to its own module (`@pylinka/core` internals) so the interpreted WebGL path no longer imports the WebGPU one to ask which system to run, and takes an optional third `systemId` argument.

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - More of the interpreted WebGL backend's fallbacks now agree with the graph.

  **A field wired to nothing does nothing.** Fields are found by kind rather than by following wires, so a `field.gravity` dropped on the canvas and left unconnected pulled on the whole effect, and deleting the `output.addForce` it fed changed nothing at all. A field now needs an outgoing edge to count. The test is coarse — this backend cannot follow a force through a math node, so it does not check where the wire goes — but a node connected to nothing no longer acts.

  **Gravity and drag accumulate.** `output.addForce` and `output.drag` are accumulating outputs, and the compiler emits `force +=` / `dragK +=`, but here a second node of the same kind replaced the first. Two gravity nodes are now one stronger pull, and two drags one stronger drag.

  **Knobs reach more places.** Gravity, the vortex centre and the radial centre read their knob bindings, the way `field.obstacle` and the wind strength already did. Lifetime does too: `output.initLife` behind anything other than a `gen.randomRange` read the port's raw literal only, so a knob-driven lifetime silently fell back to the 1–1.5s default.

  Recipes, templates and the seed project wire every field they use and none of them carry two of a kind, so their output is unchanged.

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - `ParticlesHandle.clearColor` — what `autoClear` clears the canvas to, as straight `[r,g,b,a]` in 0..1. Defaults to fully transparent, so nothing changes unless you set it. Available on the interpreted and both compiled backends.

  This exists because of what a light blend mode can actually reach. `add` and `screen` add to the pixels in the SAME framebuffer; they cannot add to the page behind a transparent canvas. So an additive effect on a transparent canvas behaves as if the backdrop were black, and an opaque sprite drawn on black covers whatever is really behind the canvas rather than keying itself out. Clearing to the colour the effect will actually play on gives the light somewhere to land.

  Worth recording what does NOT work, since it looks obviously right: holding the destination alpha at 0 so the page shows through. The canvas is premultiplied, so RGB carrying light at alpha 0 is not a representable colour and the compositor discards the pixel — measured, an additive emitter rendered nothing at all. The blend functions are unchanged.

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - `@pylinka/core/webgl` says which nodes it cannot run.

  The interpreted backend recognises node patterns instead of evaluating the graph — that is what keeps it small and lets it live-edit without recompiling — so a kind it does not recognise contributes nothing at all. Silently: the effect just comes out wrong, with no error, until you work out that the compiled backends run the whole catalog and this one runs 35 kinds of it. Whole namespaces are affected, `math.*` and `input.*` among them, along with `output.setVelocity`, `writePosition`, `killIf`, `killIfOutOfRect` and `reflectInRect`.

  New exports `INTERPRETED_KINDS`, `isInterpreted(kind)` and `unsupportedNodes(system)` make that list something a tool can read. `output.addForce`, `output.drag`, `output.writeColor` and the `tex.*` pair count as supported: this backend reads the field or ramp node behind them rather than the output itself, so the effect still lands. A test holds the list against the source of `params.ts`, so support added there without a line in the list fails the build.

  The editor uses it to mark those nodes `inert` while the interpreted backend is the one running.

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - `zoom` is settable on a running handle, on all three backends.

  It was a construction-time option, so anything wanting to zoom a live effect had to scale the finished canvas instead — magnifying a raster rendered at the un-zoomed size, which blurs, worse the further in you go. `handle.zoom = 0.5` now shows half as much world at full resolution. Zero and negative values are ignored rather than blanking the view.

  The editor uses it for both halves of a bug the preview had: it grows the canvas buffer with the zoom so a magnified view is drawn rather than stretched, and it sets `zoom = 1 / devicePixelRatio` so that world units are CSS pixels. Effects used to be measured in DEVICE pixels there, which meant the same project rendered half-size on a 2× display — a particle authored at 8px covering 8 device pixels rather than 8 CSS ones.

  The runtime default is unchanged: `zoom: 1` still means one world unit per canvas pixel.

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - The pixi runtime carries emission masks and sub-emitter links.

  `createPylinka` built each enabled system on its own, so two things the compiled sims underneath have always supported never reached them through this path: painted **emission masks**, and **sub-emitters** — a system whose particles are born from another system's. Anything built on the pixi integration silently lost both, which reads as broken rather than unsupported.

  New options: `emissionMask` / `emissionMasks` (per system name), and `subEmitters` as `child name → parent name`. An editor project's own `subEmitters` map is read when the option is absent, translating its system IDs to names. Parents are built before their children, since the two share GPU buffers; a link to a muted or missing system is dropped rather than throwing, so muting one emitter does not take its children down with it.

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - `setEmitter(x, y, teleport?)` — move the emitter without counting the distance travelled.

  That distance is what `rateOverDistance` turns into spawns, which is the feature that lays a trail behind a dragged emitter. It also means jumping the emitter somewhere for a single frame fires a spawn proportional to how far it jumped, and another one when it jumps back — so placing a one-off burst produced two large dumps instead of the burst you asked for. Measured on a `rate: 420, rateOverDistance: 1.4` emitter, one 100-particle burst placed 178px away spawned 356 particles at the target and 256 more at the origin on the next frame; with `teleport` it spawns 100.

  Teleport when the move is a cut rather than a motion: placing a burst, or repositioning between shots. Leave it off to keep the trail. Available on the interpreted and both compiled backends.

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Sub-emitter links are part of the project format, and loading one wires them up.

  A system whose particles are born from another's was stored as `subEmitters` on the project — an undeclared extra key, written by the editor and read by nothing on the loading side. `PylinkaProject` had no such field, `createParticles` never looked for it, and `createCompiledParticles` did not either: a project that worked in the editor came back from a file as a set of unrelated systems, with the child spawning at its own emitter instead of on its parent's deaths. It read as the link not having been saved. It was saved; nothing read it.

  `subEmitters` is now a documented field on `PylinkaProject` (`child system id` → `parent system id`), part of the document rather than editor decoration.

  **Loading a project now runs it.** `createParticles(canvas, project)` and `createCompiledParticles(canvas, project)` build EVERY enabled system with the links wired, and return one handle over all of them: `update` steps them parents-first, `setKnob` and `setEmitter` reach every system, `spawnBurst` reaches only the ones that are not born from another (bursting a sub-emitter means nothing — its particles come from its parent's), and the clear belongs to the first so the rest composite on top. Pass `systemName` for the old single-system behaviour.

  Also new in `@pylinka/core`: `systemsInBuildOrder(project)` returns the enabled systems parents-first along with the links that survived (a link to a muted or missing system is dropped rather than taking the child down with it; a cycle keeps its systems), and `buildProject(project, create)` walks that order, hands each child its parent's handle, and returns something that steps every system in the same order — a child reads the parent's state from the frame it is in, so the parent has to move first.

  The pixi runtime already resolved the links and is unchanged; the editor now shares the same ordering rather than keeping a second copy of it.

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - `handle.viewOffset` — pan the view without moving the effect.

  `[x, y]` in world units, subtracted before the world is mapped to the screen, so the same particles are drawn through a window that slid. It pairs with the live `zoom` added alongside it: together they are a full view transform inside the renderer, which is where a view belongs. Transforming the canvas ELEMENT instead moves finished pixels — it slides the drawn area out of its own viewport and leaves an empty margin, and it does not compose with a rendered zoom.

  `setEmitter` maps its canvas pixels through the offset as well as the zoom, so a panned view no longer drags the emitter along with the window. With the default view (`[0, 0]`, zoom 1) nothing changes.

  The editor now sets both instead of CSS-transforming its canvas, which never scales or translates again.

  Measured on a real context — 200×200 canvas, emitter centred, particles read back with `readPixels`: the centroid sat at (100, 101), and with `viewOffset = [40, 25]` it sat at (60, 76). The exact shift, in the opposite direction.

### Patch Changes

- [#24](https://github.com/schmooky/pylinka/pull/24) [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Size, alpha and rotation read a constant on the port, not just a ramp node.

  The interpreted WebGL backend took these from `gen.scaleOverLife` / `gen.alphaOverLife` / `gen.rotationOverLife` (and the generic `numberOverLife` / `curveOverLife` behind the matching output) and nothing else. A literal typed into `output.writeScale`, or a knob bound to it — the way a game sets particle size at runtime — was ignored, and every particle came out at the 8px default. A constant is now treated as a ramp that does not move, knobs included; `output.writeRotation` also follows a `math.radians` hop, the same as the birth angle does.

  Nothing changes for a graph that uses ramp nodes, which is every recipe and template.

- Updated dependencies [[`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936), [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936), [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936), [`b3046c5`](https://github.com/schmooky/pylinka/commit/b3046c5e928d314600f8729dbe9fda5004f0d936)]:
  - @pylinka/graph@2.0.0
  - @pylinka/compiler@2.0.0

## 1.4.0

### Minor Changes

- [`765ddf8`](https://github.com/schmooky/pylinka/commit/765ddf8e1c45bcbd2b5ed618277a112060a33e1f) - Sub-emitters can spawn on a parent's **birth**, and sprite sheets gain the playback mode where `fps` actually means something.

  **Birth-triggered sub-emitters.** A child system only ever spawned on its parent's death — debris where a projectile ends. The other half of the idea was missing: a flash the instant one appears. A bolt of lightning and the light it throws are born on the same frame, and there was no way to say that. `output.deathBurst` gains a structural `on: 'death' | 'birth'`. Both are one-frame edges on the same parent slot, read from the same buffers, so a birth costs exactly what a death costs — it is the comparison that flips, in all three backends. It is a compile-time constant, so a graph that never asks for it emits byte-identical shaders.

  **`AtlasPlay: 'hold'`.** `play: 'once'` stretches the strip across the particle's lifetime, so the sequence always finishes exactly as the particle dies — a useful mode, but it ignores `fps` entirely, which made a changed `fps` look broken. Rather than change what `once` means (effects rely on it), `hold` is the mode that plays through once **at** `fps` and stays on the last frame. `loop` and `once` keep their exact shader expressions, so nothing authored on either shifts a frame.

  `AtlasPlay` and `playCode` are exported from `@pylinka/core`.

### Patch Changes

- Updated dependencies [[`765ddf8`](https://github.com/schmooky/pylinka/commit/765ddf8e1c45bcbd2b5ed618277a112060a33e1f)]:
  - @pylinka/graph@1.4.0
  - @pylinka/compiler@1.4.0

## 1.3.0

### Minor Changes

- [#20](https://github.com/schmooky/pylinka/pull/20) [`ae8963b`](https://github.com/schmooky/pylinka/commit/ae8963b59fdce2f26869680233fda6212c2b6f4d) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Rotation you can actually author.

  `output.writeRotation` existed, but nothing an artist could wire into it made a sprite turn: the interpreted WebGL backend never read an angle at all, and no node could set one at spawn. Three nodes close the gap.

  - `output.initRotation` — the angle a particle is born at. Feed it a `gen.randomRange` so each one starts somewhere different, or a literal to pin them all. Previously every particle spawned at zero, so a burst spun in lockstep and read as one rigid object.
  - `gen.spin` — an angular velocity in radians per second, integrated over the particle's own age. This is the term that was missing: feeding a constant into `output.writeRotation` sets an angle, it does not turn anything.
  - `gen.rotationOverLife` — an eased sweep between two angles, for a tile that turns exactly ninety degrees as it falls and then stops.

  Plus `math.radians`, since every angle port in the catalog is radians and artists type degrees.

  All three terms sum, so a shard can start at a random angle, tumble at its own rate, and settle. The interpreted backend derives the angle from the seed and age each particle already carries rather than widening the particle state, and rotates the sprite quad rather than the texture lookup, so an atlas cell turns instead of shearing. The compiled backends already drew with an angle and now honour the spawn-time write.

### Patch Changes

- Updated dependencies [[`ae8963b`](https://github.com/schmooky/pylinka/commit/ae8963b59fdce2f26869680233fda6212c2b6f4d)]:
  - @pylinka/graph@1.3.0
  - @pylinka/compiler@1.3.0

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
  - @pylinka/compiler@1.2.0
  - @pylinka/graph@1.2.0

## 1.1.0

### Minor Changes

- [#16](https://github.com/schmooky/pylinka/pull/16) [`f7b0e65`](https://github.com/schmooky/pylinka/commit/f7b0e656accd8be00504faf5ef0531ffd2de5213) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Add an official texture/atlas API to the PixiJS runtime

  `createPylinka` / `createParticleSystem` now accept a `textures` map (and single
  `texture`) so systems render real art instead of the built-in soft disc. A
  texture can be a URL, a `TexImageSource`, or a pixi `Texture`, and carries atlas
  options for animated sprite sheets: `cols`/`rows`, `frameW`/`frameH`, `pad`,
  `fps`, `play` (`loop`|`once`) and `pick` (`per-particle`|`per-spawn`). New
  `resolveTexture` / `loadImage` / `toTexImageSource` helpers are exported.

- [#16](https://github.com/schmooky/pylinka/pull/16) [`f7b0e65`](https://github.com/schmooky/pylinka/commit/f7b0e656accd8be00504faf5ef0531ffd2de5213) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Add spawn-on-death sub-emitters (`output.deathBurst`)

  A new `output.deathBurst` node bursts a child system when a parent particle
  dies — RevoltFX-style explosions (e.g. exploding ships). Configurable spawn
  count (one, many, or a random distribution), a `max` clamp (1–64), and velocity
  inheritance from the dying parent. Works on all three backends: WebGPU compute,
  WebGL2 transform-feedback, and the interpreted WebGL runtime.

### Patch Changes

- [#16](https://github.com/schmooky/pylinka/pull/16) [`f7b0e65`](https://github.com/schmooky/pylinka/commit/f7b0e656accd8be00504faf5ef0531ffd2de5213) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Render particles into pixi's current render target (filters, cache-as-texture)

  The particle draw computed its clip-space transform from the screen size, so a
  system inside a filtered or cached-as-texture container drew off the off-screen
  FBO and vanished. It now composes pixi's current render-target projection with
  the view's world transform (identical to the old maths for the screen, so
  unfiltered rendering is unchanged). A particle view still reports empty bounds —
  its particles live on the GPU — so to filter/mask-to-texture a container, set its
  `boundsArea` to the region to capture.

- [#16](https://github.com/schmooky/pylinka/pull/16) [`f7b0e65`](https://github.com/schmooky/pylinka/commit/f7b0e656accd8be00504faf5ef0531ffd2de5213) Thanks [@igaming-bulochka](https://github.com/igaming-bulochka)! - Fix PixiJS z-order and `visible` corruption in the render pipe

  Particle views now render at their true position in the scene graph, so they
  layer correctly against sibling containers, `Graphics`, and `Text` instead of
  always drawing on top. Toggling a view's `visible` no longer leaks GL state onto
  other containers. This is what makes pylinka usable inside a real pixi app.

- Updated dependencies [[`f7b0e65`](https://github.com/schmooky/pylinka/commit/f7b0e656accd8be00504faf5ef0531ffd2de5213), [`f7b0e65`](https://github.com/schmooky/pylinka/commit/f7b0e656accd8be00504faf5ef0531ffd2de5213)]:
  - @pylinka/graph@1.1.0
  - @pylinka/compiler@1.1.0

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

  Context loss no longer kills an effect. On WebGL2 both backends pause while the GPU context is
  gone and rebuild themselves when the browser gives it back, carrying your knob values and emitter
  position across. `contextLost` tells you where you stand, and `onContextLost` and
  `onContextRestored` fire if you want to show something on screen. WebGPU device loss is detected
  and reported, and replacing the device stays with whoever owns it.

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
