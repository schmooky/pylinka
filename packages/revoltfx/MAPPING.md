# RevoltFX → Pylinka mapping

This table maps every setting in a RevoltFX bundle onto Pylinka 2.2. It was
written before the converter and is the converter's specification. Each row
says how faithfully the setting carries over:

- **exact**: same behaviour, up to float rounding and RNG streams.
- **approximate**: same intent, measurably different motion or timing. The
  converter reports each one, with the size of the error where it can be
  measured.
- **unsupported**: Pylinka has no way to express it today. The converter drops
  it and reports it.

"Runtime" in the Pylinka column means the `@pylinka/revoltfx/pixi` player does
the work on the CPU. A project converted with `drive: 'project'` (for the
editor, or for plain `createPylinka`) only gets the approximation in brackets.

## Sources

The schema is not guessed. It comes from these sources:

- `revolt-fx@1.3.6` from npm (`lib/Sanitizer.js` holds the full default
  structure, `lib/model/*`, `lib/Particle.js`, `lib/ParticleEmitter.js`,
  `lib/EffectSequence.js`, `lib/core/*EmitterCore.js`, `lib/util/Easing.js`,
  `lib/FX.js`).
- The official example bundle `default-bundle.json` from
  `bma73/revolt-fx-examples` (MIT): 76 emitters and 10 sequences. It is
  vendored as `test/fixtures/default-bundle.json` and every test runs against
  it.

## Bundle and file level

| RevoltFX | Pylinka | Fidelity |
|---|---|---|
| `__h` hash / `__v` version | Checked the same way `FX.initBundle` checks them (`80c6df7f…`, `0`). A mismatch is a warning, not an error. | exact |
| `emitters[]` / `sequences[]` by `name` | One `PylinkaProject` per effect name. Every emitter that effect reaches becomes one or more `System`s. | exact |
| Missing keys | Filled from `Sanitizer._presetStructure`, the same defaults RevoltFX uses. | exact |
| `useBlendModes: false` | Every system gets blend mode `normal`. | exact |
| `maxParticles` (global cap 5000 / bundle) | No global cap. Each system has its own `capacity`. | approximate |
| `spritesheetFilter` | Not needed. Textures are looked up by name. | exact |
| `particleFac` (FX instance property) | Not in the bundle. Converter option `particleFac`. | exact |

## Emitter (`emitters[i]`)

| RevoltFX | Pylinka | Fidelity |
|---|---|---|
| `core.type: circle`, `radius`, `angle` | `gen.randomRange` angle → `math.cos/sin` → `math.makeVec2` × `gen.randomRange(0, r)` → `output.spawnPosition`. Uniform radius, so particles bunch at the centre like RevoltFX. `angle: 0` means a full circle. | exact |
| `core.type: ring`, `radius`, `angle` | Same, with a fixed radius. | exact |
| ring `uniform: true` | Angle = start + `input.spawnIndex` × step. Needs a fixed spawn count, so `spawnCountMin` must equal `spawnCountMax`. Otherwise the average count is used. Sub-emitter bursts give no per-burst index. | exact when the count is fixed, otherwise approximate |
| `core.type: box`, `width`, `height` | `gen.randomRange` x/y → `math.rotate2d` by the emitter rotation. | exact |
| `radial` (circle/ring) | Movement direction = spawn angle. Initial sprite rotation = spawn angle. | exact |
| `radial` (box) | Direction = `math.normalize(offset)`. The sprite rotation needs `atan2`, which the catalog lacks, so it uses the emitter rotation instead. | approximate (rotation only) |
| not `radial` | Direction and rotation = emitter rotation. | exact |
| `rotation` | A per-system knob (`param.ref`) so the player can rotate a live effect. | exact |
| `autoRotation` (rad/frame) | Runtime: knob += autoRotation × 60 × dt. [static] | exact (runtime) |
| `spawnFrequencyMin/Max`, `spawnCountMin/Max` | Runtime: the same clock as `ParticleEmitter.update`. It fires on the first frame, waits `Rnd.float(fMin,fMax)` and spawns `Rnd.integer(cMin,cMax)`, where the max is exclusive like RevoltFX's. A frequency below one frame's dt fires once per frame, like RevoltFX. [`burst` mode: average count every average interval, first burst one interval late] | exact (runtime) |
| `infinite`, `duration` | Runtime: emits for `duration` s, or forever. `duration: 0` with `!infinite` is a single spawn. [`once` / `burst`] | exact (runtime) |
| `maxParticles` | `capacity` = min(maxParticles, the estimated live peak). Pylinka drops spawns past capacity. RevoltFX also counts toward the global cap. | approximate |
| `useGravity`, `gravity` (px/frame²) | `field.gravity (0, g·3600)` → `output.addForce`. RevoltFX integrates per frame and Pylinka per dt (semi-implicit), so paths differ by under 1 px/s at 60 fps. | approximate (tiny) |
| `useFloor`, `floorY` (only when `floorY > 0`) | `output.collidePlane` at (0, floorY), normal (0,−1), world space. | exact (container = world) |
| `childs[]` (emitters started with this one) | Extra top-level systems at the same emitter position. With `adoptRotation`, the runtime sets child rotation = child.rotation + parent rotation. | exact (runtime) |
| `childs[].scale` | Applied as a scale mod on that instance (see *Scale mod*). | exact |
| `containerId` | Runtime option `containers`: a map from containerId to a pixi Container. | exact (runtime) |

## Particle (`particleSettings`)

| RevoltFX | Pylinka | Fidelity |
|---|---|---|
| `durationMin/Max` | `gen.randomRange` → `output.initLife`. | exact |
| `componentType: 0` (Sprite) + `componentId` | `textures[system]` → the frame cropped out of the spritesheet. | exact |
| `componentType: 1` (MovieClip) | `mc_<id>_*` frames packed into a strip atlas (`cols = n`). `loop` → `play: 'loop'`, otherwise `'hold'` (pixi `AnimatedSprite` stops on the last frame). fps = 60 × animationSpeed. | exact when `animationSpeedMin == Max`, otherwise approximate (average speed) |
| `componentParams.anchorX/Y` | The runtime pads the cropped frame so the anchor lands at the quad centre. Rotation and scale then pivot on the anchor. | exact (runtime) |
| Texture pixel size | Pylinka quads are square and `scale 1 = 8 px`. The runtime bakes each frame into a square canvas of side S, and the converter writes `scale × S/8`. Non-square frames keep their aspect inside the square. | exact (needs frame data) |
| `blendMode` 0 normal / 1 add / 3 screen | `System.blendMode`. | exact |
| `blendMode` 2 multiply | No multiply blend. Falls back to `normal`. | unsupported |
| `addOnTop: false` (new particles drawn under old ones) | Pylinka draws in pool-slot order. | unsupported |
| `useMotion` with gravity: `moveSpeedMin/Max` (px/frame) | `output.initVelocity` = dir × speed × 60. | exact |
| `useMotion` without gravity: `distanceMin/Max`, `distanceEase` | RevoltFX tweens position over the lifetime. It moves `Rnd.integer(min,max) × 0.64` px, the double `0.8` factor in `Particle.init`. Pylinka has no "position at birth" in the update pass, so the tween becomes `initVelocity` + a per-particle `output.drag` = c/life. The particle travels exactly the RevoltFX distance by the time it dies. The curve shape is 1−e^(−c·t), with c fitted to the ease. `linear` is exact (c = 0). | approximate (shape error reported: linear 0, easeOutQuint 2.5%, easeInCubic 3.3%, easeIn/OutSine 4.3% of the distance) |
| `bounceFacMin/Max`, `frictionMin/Max` | `collidePlane` `restitution` / `friction` from per-particle `gen.randomRange`. | exact |
| `stopOnBounce` | `output.killIfOutOfRect` below `floorY`. The particle dies one frame later than in RevoltFX. | approximate |
| `align` (rotation = velocity heading) | Needs `atan2`. Falls back to the launch direction. | unsupported |
| `useRotation`, `rotationSpeedMin/Max` (rad/frame) | `gen.spin` (radians, × 60 → rad/s) into `output.writeRotation`. | exact at 60 fps (RevoltFX spin is frame-rate dependent) |
| `randomRotationDirection` | Sign = sin(x)/abs(sin(x)) with x random, so P(+) = ½. | exact |
| `randomStartRotation` | `gen.randomRange(0, 2π)`: `initRotation`, or the spin base. | exact |
| Spin starting from the spawn direction (radial + spin, not random start) | The update pass cannot read the birth angle, so spin starts from a random angle. | approximate |
| `useAlpha`: `alphaStart/EndMin/Max`, `alphaEase` | `gen.alphaOverLife` with per-particle `gen.randomRange` endpoints → `output.writeAlpha`. | exact for presets, fitted for the rest (see *Eases*) |
| `fadeIn`, `fadeInDurationFac`, `fadeInEase` | alpha = mix(a0, a1, ramp) × fade, with two `curve(...)` eases holding flat across the fade window. | exact for linear, fitted for the rest |
| `useScale` + `uniformScale`: `scaleStart/EndMin/Max`, `scaleEase` | `gen.randomRange` endpoints → `mix` by a `gen.numberOverLife` ramp → × S/8 → `output.writeScale`. | exact |
| `scaleIn`, `scaleInDurationFac`, `scaleInEase` | Same two-curve form as fadeIn. | exact for linear, fitted for the rest |
| `uniformScale: false` (`scaleX*` / `scaleY*`) | `output.writeScale` is a scalar. Uses the mean of X and Y with the X ease. | approximate |
| `useTint`: `tintStart`, `tintEnd`, `tintEase` | `gen.colorOverLife` → `output.writeColor`. | exact |
| `useSpawns`: `spawn.onComplete` (type 0, emitter) | Child system with `output.deathBurst { on: death }`, linked in `project.subEmitters`. Count = the spawned emitter's spawn count. | exact if the spawned emitter is one-shot, otherwise approximate (one burst instead of a stream) |
| `spawn.onStart` (type 0) | Same, with `on: birth`. | same as above |
| `spawn.*` type 1 (a sequence) | The sequence's emitter effects become death/birth-burst children. Delays, sprite elements and triggers are dropped. | approximate |
| `spawn.onHalfway` | No mid-life event. (RevoltFX fires it at age ≥ 0.5 s, not at half the lifetime.) | unsupported |
| `spawn.onBounce` | No collision event. | unsupported |
| spawn `adoptRotation` | A child cannot read its parent particle's rotation. The child uses its own rotation. | approximate |
| spawn `scale` | Scale mod on the child instance. | exact |
| `useChilds` / `particleSettings.childs` (emitters that ride along with each particle, i.e. trails) | Pylinka sub-emitters fire once per event, never continuously from a live parent. | unsupported |
| `fx.particleFac` count scaling | Converter option. | exact |

### Scale mod

RevoltFX passes `scaleMod` (child `scale`, spawn `scale`, sequence
`scaleMin/Max`) into `Particle.init`. It multiplies duration, distance, speed,
bounce, friction, rotation speed, the scale start, the scale delta and the core
radius/size. The converter bakes it into the instance's graph. A random scale
range is reduced to its mean (approximate).

## Sequences (`sequences[i]`)

| RevoltFX | Pylinka | Fidelity |
|---|---|---|
| `delay`, `effects[].delay` (offsets from the sequence start) | Runtime timeline. | exact (runtime) |
| `componentType: 2` (emitter) | Systems for that emitter, started at its delay. | exact (runtime) |
| `componentType: 0` (sprite): `scale/alpha/rotation Min/Max`, `tint`, `blendMode`, `duration`, anchor | A one-particle system: life = duration, constant scale/alpha/tint, random rotation. | exact |
| `componentType: 1` (movie clip) | Same, with a strip atlas. | exact (speed range → average) |
| `componentType: 3` (trigger), `triggerValue` | Runtime `onTrigger(value)` callback. Not representable in a project. | exact (runtime) |
| `scaleMin/Max` (sequence and element) | Scale mod / sprite scale. A range becomes its mean for emitters and stays per particle for sprites. | approximate (emitters), exact (sprites) |

## Eases

RevoltFX uses Penner eases. Pylinka has GSAP presets and multi-key `curve(...)`
eases.

| RevoltFX | Pylinka | Fidelity |
|---|---|---|
| `linear` | `linear` | exact |
| `easeIn/Out/InOutQuad` | `power1.*` | exact |
| `easeIn/Out/InOutCubic` | `power2.*` | exact |
| `easeInQuart`, `easeOutQuart` | `power3.in/out` | exact |
| `easeIn/OutSine`, `easeInOutSine` | `sine.*` | exact |
| `easeOutBack` | `back.out` | exact |
| everything else (`Quint`, `InOutQuart`, `Expo` in/inOut, `Circ`, `Elastic`, `Bounce`, `InBack`, `InOutBack`) | A fitted `curve(...)` of up to 12 keys. | approximate (max error reported: smooth eases ≤ 0.005, `easeOutBounce` 0.014, `easeInOutElastic` 0.018) |

## Backends

The converted graphs use wired math, knobs (`param.ref`) and `curve(...)`
eases, so they need a compiled backend: **WebGPU or WebGL2**. Both were checked
side by side against revolt-fx 1.3.6 on the demo page. Pylinka's **WebGL1**
CPU backend interprets only a fixed subset of node shapes, and it draws
converted effects wrongly (almost nothing visible). That is a WebGL1 backend
limit, not a converter one.

## Checked side by side

`apps/site` → `/revoltfx` plays the real `revolt-fx` package (left) and the
conversion (right) on one pixi stage. On the example bundle:

- `side-torch`: same size, placement, flicker and colours. Pylinka's flame is
  rounder, because the X/Y scale is averaged (see non-uniform scale).
- `side-rain`: same fall, floor splash and density.
- `top-flamethrower`: same reach and spread. Movie-clip frames play.
- `top-big-explosion` (sequence): same timing, flash sprite, and the `shake`
  trigger fires at 0 s and 1 s.
- `fireworks`: the rocket climbs at the same rate (ease-in fitted as negative
  drag) and bursts into matching radial sparks. The green rocket trail
  (`useChilds`) is missing.

## What Pylinka cannot express yet

Adding these would close the gaps above:

1. An **`atan2` / heading node**. It would give `align` (rotate to velocity),
   radial box rotation, and spin that starts from the spawn direction.
2. **Continuous per-particle emitters** (trails): `useChilds`.
3. **Mid-life and collision events** for sub-emitters: `onHalfway`, `onBounce`.
4. **Multiply blend mode.**
5. **Non-uniform particle scale** (`writeScale` is a scalar).
6. **Birth-position access in the update pass**, or a `positionOverLife` node.
   It would make eased distance motion exact instead of drag-fitted.
7. **Emitter timeline in the project format** (start delay, duration, random
   count/interval ranges, auto-rotation). Today the runtime player holds these.
   A project played without the player only approximates them with
   `burst`/`once`.
8. **Draw order control** (`addOnTop: false`).
