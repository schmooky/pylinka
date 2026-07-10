# SPIKE-RESULTS

> Status: **partial**. This file is normally produced by the M1.0 GPU spike
> (REQUIREMENTS §18.1). The GPU-compute measurements (S1, S3–S7) still require
> real hardware and are **not yet done**. What *is* resolved here is **S2 — the
> pixi v8 render-graph integration contract** — settled by studying a shipping
> reference rather than guessing. Entries are dated; numbers get appended when a
> hardware run happens.

---

## S2 — pixi v8 integration contract (RESOLVED by reference study · 2026-07-10)

### Reference

NeutrinoParticles' official pixi-v8 integration:
`gitlab.com/neutrinoparticles/neutrinoparticles.pixi.js` (`src/`, license **ISC**).
It is a **CPU-simulated, pixi-batched** particle renderer — not GPU-compute — so
it does *not* answer pylinka's compute/device-sharing questions, but it is a
production example of the exact thing §20 Q4 was unsure about: **how a custom
renderable injects a pass into pixi v8's render graph while respecting scene-graph
z-order and transforms.** Only the *architecture* was studied; no code was copied
(pylinka stays MIT).

### The pixi v8 extension mechanism (confirmed)

pixi v8 renders through per-renderable **RenderPipes** selected by a
`renderPipeId` on the view, registered as extensions:

| Piece | pixi v8 API | Role for pylinka |
|---|---|---|
| Register everything | `extensions.add(...)` | one `registerPylinka()` call |
| Grab the renderer | `ExtensionType.Application` plugin → `this.renderer` | derive backend (WebGL2 vs WebGPU) + device/context |
| The renderable/view | subclass **`ViewContainer`** implements `Instruction`, sets `renderPipeId = 'pylinka'`, `batched = false` | this **is** `ParticleSystemView` — a real scene-graph node |
| The custom pass | **`RenderPipe<View>`** under `ExtensionType.WebGLPipes` *and* `ExtensionType.WebGPUPipes` | `addRenderable` / `updateRenderable` / `execute` — `execute()` issues our own instanced draw |

Because the view is an ordinary `ViewContainer`, **z-interleaving, culling, and
parent transforms are free** — this is the "particles behind symbols, above the
background" requirement (Risk #0), and it needs no canvas overlay.

### View-transform hookup — §20 Q4 answer

The reference reads the view's **`worldTransform`** (and an explicit optional
`baseParent.worldTransform` that fixes the global coordinate frame) inside the
render pipe, then feeds it to the geometry/shader. Mapping to pylinka:

- `ParticleSystemView extends ViewContainer`. In the WebGPU/WebGL RenderPipe's
  `execute(view)`, read `view.worldTransform` → derive the §13.8 `scaleOffset`
  (world→clip) render uniform. This replaces the standalone ortho path the M1.0
  spike used as a placeholder.
- The reference's `baseParent` (a container that provides the global coordinate
  system, decoupled from the view's own parent) is **exactly** pylinka's
  world-space model: put the view in a static VFX layer, and let `follow(target)`
  drive the emitter uniform — never reparent the view (the documented
  anti-pattern, §7.3). Adopt `baseParent` as the mechanism behind `follow()`.

### Where pylinka deliberately diverges from the reference

1. **No batching.** Neutrino packs CPU-simulated quads into pixi's `Batcher`.
   pylinka's particles live in GPU buffers; `execute()` issues **one instanced
   draw** straight from the sim buffers (`STORAGE | VERTEX`, §13.8) — no per-quad
   CPU packing, no batcher.
2. **WebGPU-first + compute.** The reference is WebGL-only (`WebGLRenderer`,
   `WebGLPipes`) with no compute. pylinka registers **both** a `WebGPUPipes` and
   (M2) a `WebGLPipes` pipe, and its emit/update run as **compute dispatches**
   before the draw. Getting the compute device from `renderer.gpu.device` and
   dispatching from within a render pipe is the part the reference does **not**
   cover — **still a hardware spike item.**
3. **Backend follows host** (Risk #0/#1): pick the pipe by `renderer.type`
   (`webgl` → WebGL2 TF backend in the same GL context, M2; `webgpu` → shared
   `renderer.gpu.device`). The reference confirms the WebGL pipe path works end
   to end.

### Concrete contract for `@pylinka/core` (render module, when built)

```
render/
  plugin.ts       ExtensionType.Application → attaches BackendProvider to the app
  system-view.ts  ParticleSystemView extends ViewContainer (renderPipeId='pylinka',
                  batched=false); owns pool + uniform bus + compiled pipelines
  pipe-webgpu.ts  RenderPipe under WebGPUPipes: execute() → flush uniforms,
                  emit dispatch, update dispatch, instanced draw using worldTransform
  pipe-webgl2.ts  (M2) RenderPipe under WebGLPipes: TF sim + instanced mesh draw
  register.ts     registerPylinka()/unregisterPylinka() via extensions.add/remove
```

This resolves the *architecture* of R4 (`ParticleSystemView` as a pixi container)
and the render half of R1 (`BackendProvider`). The **GPU bodies inside `execute()`
(compute dispatch + draw) and the device-loss path still need a real-hardware
run** before they can be written with confidence.

---

## Still outstanding (need real GPU hardware)

| Item | §18.1 | Blocking? |
|---|---|---|
| S1 1M standalone WebGPU sim, timestamp-query budget | S1/S4 | ships M1.3 GPU backend |
| S3 moving-emitter trail acceptance (§14.5) | S3 | validation of the compiler output |
| S5 zero-alloc frame-loop check | S5 | perf discipline gate |
| S6 color storage: `vec4<f32>` vs packed `rgba8unorm` | S6/§20 Q1 | scaffold assumes packed; may amend §13 |
| S7 PRNG cross-GPU sanity | S7 | determinism claims |
| S8 WebGL2 TF probe | S8 | M2 fallback feasibility |
| Compute dispatch *from within* a pixi WebGPU RenderPipe | new (from S2) | the one thing the reference didn't cover |

**Gate unchanged:** if pixi-WebGPU device sharing or the T2 (250k @ 60 fps on a
real phone) budget fails, escalate before building the M1.3 GPU backend.
