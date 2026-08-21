---
'@pylinka/compiler': minor
'@pylinka/graph': minor
'@pylinka/core': minor
---

Multi-keyframe ease curves, plus `gen.numberOverLife` and `gen.alphaOverLife`.

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
