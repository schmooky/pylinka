# RevoltFX → Pylinka mapping

This table maps every setting in a RevoltFX bundle onto Pylinka. It is the
converter's specification. Each row says how faithfully the setting carries
over:

- **exact**: same behaviour, up to float rounding and RNG streams.
- **approximate**: same intent, measurably different motion or timing. The
  converter reports each one, with the size of the error where it can be
  measured.
- **unsupported**: Pylinka has no way to express it today. The converter drops
  it and reports it.

"At 60 fps" marks RevoltFX settings that are per frame in RevoltFX itself
(speeds, gravity, spin, auto-rotation, spawn intervals rounded up to whole
frames). Pylinka runs them per second, so they match RevoltFX exactly at
60 fps and stay frame-rate independent elsewhere.

## Sources

The schema is not guessed. It comes from:

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
| `__h` hash / `__v` version | Checked the same way `FX.initBundle` checks them. A mismatch is a warning. | exact |
| `emitters[]` / `sequences[]` by `name` | One `PylinkaProject` per effect. Every emitter that effect reaches becomes one or more `System`s. Emitters and sequences are separate namespaces, like `getParticleEmitter` / `getEffectSequence`. | exact |
| Missing keys | Filled from `Sanitizer._presetStructure`, the defaults RevoltFX itself uses. | exact |
| `useBlendModes: false` | Every system gets `normal`. | exact |
| `maxParticles` (global cap) | No global cap. Each system has its own `capacity`. | approximate |
| `particleFac` (FX instance property) | Converter option. Integer factors are exact. | exact / approximate |

## Emitter (`emitters[i]`)

| RevoltFX | Pylinka | Fidelity |
|---|---|---|
| `core.type: circle`, `radius`, `angle` | Random angle (`angle: 0` = full circle) and uniform radius → `output.spawnPosition`. Particles bunch at the centre like RevoltFX. | exact |
| `core.type: ring` | Same, with a fixed radius. | exact |
| ring `uniform: true` | Angle = start + `input.spawnIndex` × step. In a sub-emitter burst the index runs within the burst. Needs a fixed count (`spawnCountMax − spawnCountMin ≤ 1`). | exact when the count is fixed, otherwise approximate |
| `core.type: box` | Random x/y → `math.rotate2d` by the emitter rotation. | exact |
| `radial` | Direction = spawn angle (circle/ring) or the offset's heading (box). Sprite rotation = the same heading (box: `math.atan2`). | exact |
| `rotation` | A per-system knob (`param.ref`), so the effect can be rotated live. | exact |
| `autoRotation` (rad/frame) | Spawn angle += rate × 60 × (`input.time` − start). Emitter children that adopt the rotation inherit the term. | exact at 60 fps |
| `spawnFrequencyMin/Max`, `spawnCountMin/Max` | `emitter.burst`: `count`/`countMax` (RevoltFX's `Rnd.integer` max is exclusive, so `countMax = spawnCountMax − 1`), `interval`/`intervalMax` rounded up to whole frames (RevoltFX resets its timer on each spawn), `immediate: true` (RevoltFX fires on its first frame). | exact at 60 fps |
| `infinite`, `duration` | `emitter.duration`. `duration: 0` with `!infinite` is `mode: 'once'`. | exact |
| `useGravity`, `gravity` (px/frame²) | `field.gravity (0, g·3600)` → `output.addForce`. | exact at 60 fps (integration order differs by under 1 px/s) |
| `useFloor`, `floorY` (only when `floorY > 0`) | `output.collidePlane` at (0, floorY), normal (0, −1), world space. | exact |
| `childs[]` (emitters started with this one) | More top-level systems at the same emitter position. `adoptRotation`: the child's knob defaults to child + parent rotation, plus the parent's autoRotation term. | exact |
| `childs[].scale` | Scale mod on that instance (see *Scale mod*). | exact |
| `containerId` | Player option `containers`: containerId → pixi Container. | exact (player) |

## Particle (`particleSettings`)

| RevoltFX | Pylinka | Fidelity |
|---|---|---|
| `durationMin/Max` | `gen.randomRange` → `output.initLife`. | exact |
| `componentType: 0` (Sprite) | The frame, cropped out of the spritesheet by the player. | exact |
| `componentType: 1` (MovieClip) | `mc_<id>_*` frames packed into a strip atlas. `loop` → `play: 'loop'`, otherwise `'hold'`. fps = 60 × animationSpeed. | exact when `animationSpeedMin == Max`, otherwise approximate (mean speed) |
| `componentParams.anchorX/Y` | The player pads the frame so the anchor lands at the quad centre. | exact (player) |
| Texture pixel size | Pylinka quads are 8 px at scale 1. The converter writes `scale × side/8`, and the player bakes each frame into a square of that side. | exact (needs frame data) |
| `blendMode` 0 / 1 / 2 / 3 | `normal` / `add` / `multiply` / `screen`. | exact |
| `addOnTop: false` (new particles drawn under old ones) | Pylinka draws in pool-slot order. Ordering by age needs a per-frame GPU sort. | unsupported |
| `useMotion` with gravity: `moveSpeedMin/Max` (px/frame) | `output.initVelocity` = dir × speed × 60. | exact at 60 fps |
| `useMotion` without gravity: `distanceMin/Max`, `distanceEase` | `initVelocity` holds the whole displacement D (RevoltFX moves `Rnd.integer(min,max) × 0.64` px). Each frame, `output.writePosition` = pos + D·(E((age+dt)/life) − E(age/life)), with `input.dt` and `gen.ease`. | exact (eases as below) |
| `bounceFacMin/Max`, `frictionMin/Max` | `collidePlane` `restitution` / `friction` from per-particle `gen.randomRange`. | exact |
| `stopOnBounce` | `collidePlane` parks the particle on the floor, and `output.killIfOutOfRect` kills it there on the next frame. | approximate (dies one frame late) |
| `align` (rotation = velocity heading) | `output.writeRotation` = `math.atan2(vel.y, vel.x)` (+ the spin step, as RevoltFX adds it after). | exact |
| `useRotation`, `rotationSpeedMin/Max` (rad/frame) | `writeRotation` = `input.rotation` + rate × 60 × `input.dt`, so spin starts from the birth angle. | exact at 60 fps |
| `randomRotationDirection` | Sign = sin(x)/abs(sin(x)), x random: P(+) = ½. | exact |
| `randomStartRotation` | `gen.randomRange(0, 2π)` → `initRotation`. | exact |
| `useAlpha`: start/end ranges, `alphaEase` | `gen.alphaOverLife` with per-particle endpoints → `output.writeAlpha`. | exact (eases as below) |
| `fadeIn`, `fadeInDurationFac`, `fadeInEase` | alpha = mix(a0, a1, ramp) × fade, with two `curve(...)` eases held flat across the window. | exact for linear, fitted otherwise |
| `useScale` + `uniformScale` | Per-particle endpoints → `mix` by a `gen.numberOverLife` ramp → × side/8 → `output.writeScale`. | exact |
| `scaleIn`, `scaleInDurationFac`, `scaleInEase` | Same two-curve form as fadeIn. | exact for linear, fitted otherwise |
| `uniformScale: false` (`scaleX*` / `scaleY*`, each with its own ease) | `output.writeScaleXY`: two tweens into one vec2. The engines store an aspect per particle. | exact |
| `useTint`: `tintStart`, `tintEnd`, `tintEase` | `gen.colorOverLife` → `output.writeColor`. | exact |
| `spawn.onComplete` / `onStart` (type 0, emitter) | Child system with `output.deathBurst { on: death / birth }`, linked in `project.subEmitters`. Count = the spawned emitter's count range, uniform over the integers. | exact if the spawned emitter is one-shot, otherwise approximate (one burst instead of a stream) |
| `spawn.onHalfway` | `on: 'age'`, `at: 0.5`. RevoltFX fires it at age ≥ 0.5 s, not at half the lifetime, and so does the conversion. | exact |
| `spawn.onBounce` | `on: 'bounce'`: fires on a frame where the parent's `collidePlane` resolved a hit. | exact |
| `spawn.*` type 1 (a sequence) | Its emitters and sprites become children on the same event. Element delays are dropped. Triggers cannot fire per GPU particle. | approximate when the sequence has delays |
| spawn / trail `adoptRotation` | A child cannot read its parent particle's rotation. The WebGPU sub-emit pass already uses its 8 storage buffers. | approximate (when the child is direction-sensitive) |
| spawn / trail `scale` | Scale mod on the child instance. | exact |
| `useChilds` / `particleSettings.childs` (trails) | Child system with `on: 'alive'`, `rate` = 1 / the child emitter's frequency: it spawns the child's count every tick while the parent lives, keyed off the parent's own age. A one-shot child is `on: 'birth'`. Pool per parent up to 128. | exact (mean interval when the frequency is a range; a timed child runs until its particle dies) |

### Scale mod

RevoltFX passes `scaleMod` (child `scale`, spawn `scale`, sequence
`scaleMin/Max`) into `Particle.init`. It multiplies duration, distance, speed,
bounce, friction, rotation speed, the scale start and delta, and the core
radius/size. The converter bakes it into the instance's graph. A random scale
range on an emitter is reduced to its mean (approximate).

## Sequences (`sequences[i]`)

| RevoltFX | Pylinka | Fidelity |
|---|---|---|
| `delay`, `effects[].delay` | `emitter.delay` on each element's systems. An element waits for the one before it, as `EffectSequence.setNextEffect` does. | exact |
| `componentType: 2` (emitter) | Systems for that emitter, delayed. | exact |
| `componentType: 0 / 1` (sprite / movie clip) | A one-particle system: life = duration, random scale/alpha/rotation, tint, blend. | exact |
| `componentType: 3` (trigger) | Player `onTrigger(value)` callback. Not representable in a project. | exact (player) |
| `scaleMin/Max` | Per particle for sprites. The mean, for emitters. | exact / approximate |

## Eases

RevoltFX uses Penner eases. Pylinka has GSAP presets and multi-key `curve(...)`
eases.

| RevoltFX | Pylinka | Fidelity |
|---|---|---|
| `linear`, `Quad` → `power1`, `Cubic` → `power2`, `easeIn/OutQuart` → `power3`, `Sine` → `sine`, `easeOutBack` → `back.out` | presets | exact |
| everything else (`Quint`, `InOutQuart`, `Expo` in/inOut, `Circ`, `Elastic`, `Bounce`, `InBack`, `InOutBack`) | A fitted `curve(...)` of up to 12 keys. | approximate (max error reported: smooth eases ≤ 0.005, `easeOutBounce` 0.014, `easeInOutElastic` 0.018) |

## Backends

The converted graphs need a compiled backend: **WebGPU or WebGL2**. On WebGL2 a
sub-emitter runs one transform-feedback pass per pool copy (`max`, up to 128),
so a dense trail costs more draw calls there than on WebGPU. Pylinka's
**WebGL1** CPU backend interprets a fixed subset of node shapes and draws
converted effects wrongly. It also ignores the newer nodes (`writeScaleXY`,
the age/bounce/alive sub-emitter events).

## Checked side by side

`apps/site` → `/revoltfx` plays the real `revolt-fx` package (left) and the
conversion (right) on one pixi stage:

- `side-torch`: same elongated flame, size, flicker and colours. The report is
  empty.
- `side-rain`: same fall, floor splash and density.
- `top-flamethrower`: same reach and spread. Movie-clip frames play.
- `top-big-explosion` (sequence): same timing and flash sprite. `shake`
  triggers fire at 0 s and 1 s.
- `fireworks`: the rocket climbs on the same eased path, with a trail of
  matching density, and bursts into matching radial sparks.

## Still not expressible

1. **Draw order by age** (`addOnTop: false`). It needs a per-frame GPU sort.
2. **A child reading its parent particle's rotation** (spawn/trail
   `adoptRotation`). The WebGPU sub-emit pass is at the default limit of 8
   storage buffers per stage.
3. **Element delays inside a sequence spawned on a particle**, and triggers
   per GPU particle.
4. **Random movie-clip speed per particle**, and a random emitter scale per
   play (the mean is used).
