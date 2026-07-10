# Pylinka — Complete Technical Requirements (DDD)

> **Status:** `v1.0` — consolidated, implementation-ready. Supersedes the former `docs/{SPEC,CONTRACTS,GPU,EDITOR,PLAN}.md`.
> **Owner:** schmooky · **Site:** `pylinka.schmooky.dev` · **Repo:** `schmooky/pylinka` (to be created) · **License:** **MIT, permanent.**
> **One-liner:** A GPU-driven, node-based particle system for PixiJS — a Neutrino-style dataflow editor whose graph compiles to GPU programs, with everything live-tweakable, a recipe gallery, and a versionable project format. WebGPU first, WebGL2 fallback, **built for slot games on real phones**.

---

## 0. Reading contract (READ FIRST, EVERY SESSION)

This is the **single source of truth** for implementing Pylinka. It is a Domain-Driven Design requirement: ubiquitous language and bounded contexts first (§4–§10), then exact technical contracts (§11–§17), then execution (§18–§20). **MUST / SHOULD / MAY** per RFC-2119.

Rules for the implementing agent:

1. **Precedence:** golden files (`packages/compiler/test/golden/*`) > this document > your judgment. On any ambiguity or perceived conflict: STOP, append an entry to `docs/QUESTIONS.md` (`date, §, question, your proposed answer`), follow the higher-precedence source, and continue. **Never silently improvise a contract.** Create `docs/QUESTIONS.md` on repo bootstrap.
2. **No new public API.** Everything a package exports must appear in §11. No renames, no "better" signatures, no extra options.
3. **No new dependencies** without a QUESTIONS.md entry. `@pylinka/graph` and `@pylinka/compiler` are **zero-dependency** (dev-deps fine). Approved elsewhere: `pixi.js@^8` (peer), `@xyflow/react@^12`, `zustand@^5`, `immer@^10`, `react@^19`, shadcn/Tailwind-v4 stack for the site.
4. **Style:** TypeScript strict, no `any`, no non-null `!` without a comment. Plain functions + interfaces; classes only where §11 names one; no inheritance hierarchies.
5. **Hot-path discipline** (`@pylinka/core` per-frame code): no closures, no array/object literals, no spread, no `Array.prototype` iteration methods; preallocate and reuse. Init-time allocation belongs in create paths only.
6. **Never** merge the emit and update dispatches, reorder them, or "optimize" the vec4 value table into tighter packing (§13.5–§13.6 explain why).
7. **Codegen changes** = regenerate goldens deliberately, review the diff, mention it in the commit. A golden diff in an unrelated commit is a bug.
8. **When unsure a WGSL construct is valid**, write a 5-line `device.createShaderModule` + `getCompilationInfo()` test — do not guess.
9. **One task = one commit/PR**, referencing the task ID (§18.4); tick its checkbox in the same commit.
10. **Do not add features** not listed in a task table, however trivial. Ideas → QUESTIONS.md.

---

## 1. Product definition

### 1.1 Vision

Pylinka lets an author wire a **typed dataflow graph** of nodes (`Position`, `Velocity`, `Age`, `RandomVec2`, `Noise`, `AddForce`, `KillIf`, …). That graph is **compiled to GPU programs**; particles live and update entirely on the GPU. **Every number and color in the graph is live** — inline literals are lowered to uniforms, so dragging any value in the editor updates the running effect instantly with zero recompilation (the Neutrino feel: add stuff, click stuff, see it now). Authors can additionally **promote any value to a named knob** (`windPower`, `fireStrength`) with range + linear/log scaling, adjustable at runtime by the consuming game. The runtime is a drop-in PixiJS view.

Around the engine sits a static site with an `/editor` route (IndexedDB-cached projects and images), a **recipe gallery** with pre-generated soundless preview clips, and an **"Open in editor"** flow that forks a recipe into a new local project.

### 1.2 In scope (eventually)

- GPU particle simulation: **WebGPU compute (primary)** + **WebGL2 transform-feedback (fallback, M2)** behind one backend-neutral IR.
- Graph → GPU-program compiler with a pipeline cache.
- Live parametrization: all value literals as uniforms; promoted knobs (linear/log) driven from editor and host game.
- Trail-grade emitters: world-space simulation, rate-over-distance, sub-frame spawn interpolation (the "coin leaves sparks" case is a v1 acceptance test).
- Force/gradient fields (wind, radial, vortex, curl) and drawable spawn/field areas (M2).
- Versionable, self-contained project format with export-time base64 assets **and** runtime texture override from the host's `Assets` cache.
- Recipe gallery + headless preview (webm) generation pipeline.
- IndexedDB persistence for projects and images; no login initially.

### 1.3 Non-Goals (v1)

- **No general-purpose GPGPU framework** — the compiler targets particle programs only.
- **No login / cloud sync / multi-user** in v1 (format and repository abstraction MUST leave room for it — §9.5).
- **No 3D.** 2D only: simulation state is `vec2`; the type system has **no `vec3`** (`vec4` exists for color).
- **No physics solver** (no constraints, no particle-particle collision). Field forces and simple bounds only.
- **No depth sorting** of particles in v1. Additive/premultiplied blending is the recommended documented path; alpha-blended smoke will exhibit draw-order artifacts (§13.8).
- **No sub-emitters / death-event chains** in v1. Candidate for M3.
- **No WebGL1.** The fallback floor is WebGL2.

### 1.4 Target platforms & consumers (governs everything)

**Primary consumer: the studio's slot games** (Stake-Engine / artube stack: pixi v8, mobile web). Secondary: the public editor/site as an OSS showcase. Where these conflict, **slots win**.

| Tier | Representative device | Renderer reality | Backend | Status |
|---|---|---|---|---|
| **T1 — low mobile** | 2021-class Android (Adreno 610 / Mali-G52), older iPhones | pixi **WebGL** | WebGL2 transform-feedback | **primary ship target** (M2) |
| **T2 — high mobile** | iPhone 14+, flagship Android, iOS 26+ Safari | pixi WebGL or WebGPU | WebGPU (WebGL2 if host is WebGL) | primary ship target |
| **T3 — desktop** | integrated-GPU laptops | either | WebGPU | editor default |
| **T4 — desktop dGPU** | 2024 dGPU | WebGPU | WebGPU | stretch/headline tier |

Two hard consequences:

1. **Backend follows the host renderer.** A slot running pixi's WebGL renderer gets the WebGL2 simulation backend *in the same GL context*, so particles interleave correctly in the scene graph (behind symbols, above background). A WebGPU-renderer host shares the WebGPU device. Pylinka never forces a canvas overlay for normal use.
2. **Budgets are quoted per tier** (§2.2). A feature cheap on T4 and ruinous on T1 gets a **High impact tag** and the editor says so plainly: *"this impacts performance a lot on low-tier devices."*

---

## 2. Performance Charter (PRIMARY DRIVER)

### 2.1 Principles

1. **The GPU owns the particles.** State lives in GPU buffers and never round-trips to the CPU during steady state. The CPU writes **uniforms** (values, knobs, emitter transform, dt, frame) and **spawn counts** — never per-particle data.
2. **No per-frame allocation** in pylinka code paths; all GPU buffers pre-allocated to capacity; reused typed-array scratch only.
3. **Value edits never recompile.** Every inline literal and every knob is a uniform: dragging a number = one uniform write, visible next frame. Only **structural** changes (nodes/edges/types/structural params) recompile — and recompiles are embraced, not feared: fast (≤ 30 ms typical), debounced, pipeline-cached, and **visible** ("Recompiling…" state, pool reset — §8.5).
4. **One dispatch family per system.** Per frame: 1 emit pass + 1 update pass + 1 instanced draw, max. (Stream compaction is M2.) No per-particle draw calls, no per-behavior CPU passes (contrast the CPU reference engine, §5.4).
5. **Data-oriented layout.** SoA in few storage buffers, laid out to minimize update-pass memory traffic (§13.2).
6. **Analytic over spatial.** Fields evaluate analytically per particle in parallel. Only *baked* drawn fields sample a texture. No quadtrees on the GPU path.
7. **Determinism, honestly scoped.** Integer-hash PRNG (§13.4) gives bit-reproducible runs **on the same device + driver + fixed-step mode**. Across GPUs, float math (fma contraction, transcendental precision) diverges: expect statistical similarity, not bit-identical trajectories. No cross-client sync claims.

### 2.2 Budgets (targets, validated in the M1.0 spike per tier)

| Metric | T1 low mobile (WebGL2) | T2 high mobile (WebGPU) | T3 desktop iGPU | T4 dGPU (stretch) |
|---|---|---|---|---|
| Alive particles @ 60 fps | **≥ 50,000** | **≥ 250,000** | ≥ 250,000 | ≥ 1,000,000 |
| CPU cost per system/frame | ≤ 0.1 ms | ≤ 0.1 ms | ≤ 0.1 ms | ≤ 0.1 ms |
| Value/knob edit → visible | ≤ 1 frame, 0 recompiles | — | ≤ 1 frame | — |
| Structural edit → running again | — | — | ≤ 30 ms compile + visible "Recompiling…" | — |
| Draw calls per system | 1 | 1 | 1 | 1 |

Typical slot VFX (coin trails, win bursts) needs 2k–20k alive particles; the T1 budget is ~10× headroom, not the design ceiling.

### 2.3 Enforcement

- **CI gates correctness, not milliseconds:** golden codegen tests, validation/compile determinism, allocation instrumentation. GPU-less CI runners produce meaningless perf numbers (SwiftShader), so **perf benchmarks run on real hardware** — locally and/or a self-hosted GPU runner — against a **committed baseline JSON**; regressions reviewed, not auto-gated.
- **Allocation discipline:** an instrumented test build counts allocations attributable to pylinka's per-frame paths over a fixed window and asserts zero; a secondary heap-drift check (600-frame window, below-noise threshold) guards instrumentation gaps. The enforceable claim is "no allocations in pylinka's hot paths."
- **Editor feedback is honest:** measured update-pass time via GPU timestamp queries (WebGPU) / `EXT_disjoint_timer_query` (WebGL2) where available, plus qualitative **Impact Tags** per node (§16). No per-node ALU arithmetic — GPU cost is not additive per node.

---

## 3. Ubiquitous Language (Glossary)

| Term | Definition |
|---|---|
| **Project** | Top-level authored document. Aggregate root of Authoring. Contains systems, params, assets, editor view state. Serializes to the versioned `pylinka` format. |
| **System** | One particle system: graph + emitter settings + pool capacity + blend mode. A Project has ≥1 System. Aggregate. |
| **SystemBundle** | A System resolved with its project-scoped ParamDefs and Assets — the unit both compiler and runtime consume. Value object. |
| **Graph** | A typed dataflow of Nodes connected by Edges. One graph per System. |
| **Node** | A unit of computation (input, math, generator, field, shape, or output). Entity within a Graph. |
| **Port** | A typed input or output slot on a Node. Value object. |
| **Edge** | A directed connection from an output Port to an input Port. Value object. |
| **PortType** | `f32 \| vec2 \| vec4 \| color \| bool`. (No `vec3` — §1.3.) |
| **EvalTime** | When a node evaluates: `init` (on spawn), `update` (per frame), or `both`. Derived during compilation. |
| **Structural param** | A node param that changes generated-code SHAPE (ease choice, knob reference). Hashed; changing it recompiles. |
| **Value param** | A default literal on an unconnected input port. Auto-lowered into the uniform table; changing it never recompiles. |
| **Param / Knob** | A named exposed control (`windPower`) with range + linear/log scale + default. Any value param can be **promoted** to a knob with one click — zero recompile (the uniform slot already exists). |
| **Field** | An analytic or baked force generator sampled per-particle. A node family. |
| **IR** | Backend-neutral intermediate representation the codegens consume. |
| **Backend** | A codegen + execution strategy: `webgpu` (compute) or `webgl2` (transform feedback). |
| **Kernel** | A compiled GPU program pair: **emit** and **update** (compute shaders on WebGPU; TF vertex programs on WebGL2). |
| **PipelineCache** | Cache of compiled pipelines keyed by (device, backend, graph hash). |
| **UniformBus** | Runtime channel writing value + knob + system uniforms to the GPU once per frame. |
| **Pool** | Fixed-capacity GPU allocation of particle slots for a System. |
| **ParticleSystemView** | Runtime object; a PixiJS container. Owns pool, kernels, uniform bus, draw. |
| **PylinkaRuntime** | Project-level runtime handle: all systems + the **shared knob bus**. |
| **Asset** | An image used as a particle texture. Internally a blob reference; base64-inlined only on export. Optional `pixiAssetKey` for host override. |
| **Recipe** | A curated example Project shipped with the site (MDX + co-located project JSON), with generated preview media and "Open in editor". |
| **Impact Tag** | Qualitative per-node performance label (`low`/`medium`/`high`, per-tier notes) shown in the editor. |
| **ProjectRepository** | Persistence port over IndexedDB (v1) / cloud (later). |

**Naming discipline:** the reference engine calls a system an "emitter". Pylinka uses **System** for the aggregate and reserves **emit/Emitter** for the spawn concern. Code MUST follow this.

---

## 4. Bounded Contexts & Context Map

### 4.1 Contexts

1. **Authoring** — the editor's domain: Projects, Systems, Graphs, Nodes, Params, Assets, view state. Owns graph validation.
2. **Compilation** — SystemBundle → IR → per-backend GPU programs. Pure, deterministic, no I/O.
3. **Simulation / Runtime** — executes programs each frame; owns pools, uniform bus, spawn scheduling, rendering, pixi integration, device-loss recovery. The shippable **`@pylinka/core`**.
4. **Persistence** — serialization, versioning/migration (document **and** node-catalog level), IndexedDB repositories.
5. **Recipes / Gallery** — recipe catalog, preview generation, open-in-editor hand-off. Site-side consumer of the public API.

### 4.2 Context map

```
            Shared Kernel: Graph model + PortType + Node schema (types only)
                 (packages/graph — depended on by editor, compiler)

 Authoring ──(SystemBundle)──▶ Compilation ──(CompiledSystem)──▶ Simulation/Runtime
     │                              ▲                                   ▲
     │ (Project)                    │ (graph hash → PipelineCache)      │ (UniformBus, spawn)
     ▼                              │                                   │
 Persistence ◀──────────────────────┴── Recipes/Gallery ──(Project JSON)┘
   (IndexedDB)                            Open-in-editor forks a Recipe → new Project
                                          Preview generation drives Runtime headlessly (offline frame-stepped)
```

- **Shared Kernel:** `@pylinka/graph` = types + pure schema only (no React, no GPU).
- **ACL:** the Runtime's public contract is `PylinkaRuntime` / `ParticleSystemView` / `UniformBus`; the editor never touches kernels directly.
- **Customer/Supplier:** Compilation → Runtime; Runtime pins a compiler API version.

### 4.3 Package topology & repository layout (create exactly this)

```
pylinka/
  REQUIREMENTS.md    (this file)
  docs/              QUESTIONS.md  SPIKE-RESULTS.md (produced by M1.0)
  packages/
    graph/     @pylinka/graph     src/{types.ts,catalog/,validate.ts,hash.ts,slots.ts} test/
                                  Shared Kernel. Pure TS, ZERO deps.
    compiler/  @pylinka/compiler  src/{compile.ts,evaltime.ts,topo.ts,codegen-wgsl/,scaffold/} test/golden/*.wgsl
                                  Backend-neutral IR; WGSL codegen (M1), GLSL ES 3.00 TF (M2). Pure TS, ZERO deps.
    core/      @pylinka/core      src/{runtime.ts,system-view.ts,pool.ts,uniform-bus.ts,scheduler.ts,
                                       pipeline-cache.ts,backend/,render/,texture-resolver.ts} bench/ test/
                                  Peer pixi.js@^8.
    format/    @pylinka/format    src/{parse.ts,serialize.ts,migrate.ts} test/
    editor/    @pylinka/editor    src/{app/,stores/,canvas/,panels/,preview/,repo/} test/
  apps/site/         Astro + shadcn (dark, zvuk design system). /editor route, recipe gallery. (M1-beta)
  tools/gen-previews/  Offline frame-stepped capture → webm/poster. (M1-beta)
  spike/             M1.0 throwaway code — allowed to be ugly; deleted after docs/SPIKE-RESULTS.md lands.
```

Recipes live inside `apps/site` per the pixi-reels convention (§10): `apps/site/src/content/recipes/*.mdx` + `apps/site/src/recipes/*.{recipe.ts,pylinka.json}` + generated media under `public/recipes/<slug>/` (built, not committed).

### 4.4 Tooling (fixed)

Node ≥ 22, pnpm ≥ 9 workspaces. TypeScript ≥ 5.6 `strict`. Build: `tsup` for packages (ESM only, `.d.ts`), `vite` for editor dev, Astro ≥ 5 for site. Tests: `vitest`. Lint: eslint 9 flat + prettier (root config). Versioning: `changesets`; publish later via npm OIDC trusted publishing. CI (GitHub Actions): typecheck, lint, unit, golden, allocation tests. **No perf gates in CI** (§2.3); `pnpm bench` runs Playwright against real Chrome with GPU, writing `bench/results.json` compared by hand against committed `bench/baseline.json`.

---

## 5. Domain Model — Authoring context

### 5.1 Aggregates & entities

**`Project`** *(aggregate root)* — `id: UUID`, `name`, `formatVersion`, `catalogVersion`, `createdAt`, `updatedAt`; `systems: System[]` (≥1), `params: ParamDef[]` (project-scoped knobs shared across systems), `assets: Asset[]`, `editor: EditorViewState`. Invariants: unique `system.id`, unique identifier-safe `param.name`, unique `asset.id`; every param binding/reference resolves; every asset reference resolves.

**`System`** *(aggregate)* — `id`, `name`, `capacity`, `blendMode`, `enabled`, `space: 'world'` (v1 fixed; `'local'` M2), `emitter: EmitterSettings`, `graph: Graph`. Invariant: graph valid (§5.3) and **well-formed**: exactly one `output.spawnPosition` and one `output.initLife` (the editor auto-inserts defaults into new systems), at most one `output.setVelocity` (§7.4).

**`Graph`** — `nodes: Node[]`, `edges: Edge[]`. One graph per system; the editor provides a system switcher. Invariants: no duplicate edges into an input; **no cycles**; edges connect compatible PortTypes (§12.3); every input port is connected or has a value default.

**`Node`** *(entity)* — `id`, `kind`, `structural` (enum choices — recompile on change), `values` (**defaults for unconnected input ports** — every numeric/vector/color input is a port that can be *wired* or *scrubbed* inline; unconnected defaults auto-lower to uniform slots and never recompile), `knobBindings` (value slots promoted to knobs). `kind` resolves to a **NodeSchema** (§11.2).

### 5.2 Authoring domain services

- **`GraphValidator`** — pure; typed diagnostics (§12.3). Runs on every edit; blocks compile on error.
- **`GraphHasher`** — stable structural hash of `{node kinds, structural params, edges}` — **excluding** positions, value literals, knob values/bindings (§12.1). This is the exact boundary of "what recompiles."
- **`NodeCatalog`** — registry of NodeSchemas; single source of truth shared with Compilation; carries `catalogVersion` + kind-alias/migration table.

### 5.3 View state & events

`EditorViewState` and node positions are presentation: serialized in the Project (layout restores), excluded from the hash and runtime path. Domain events (`NodeAdded`, `EdgeConnected`, `ValueChanged`, `ParamPromoted`, …) drive **undo/redo (minimal command stack ships in M1.5)** and autosave.

### 5.4 Relationship to the reference engine (`@g-slots/particle-emitter`)

The studio's existing lib is a **CPU behavior-list engine** — correct, finished, and structurally the opposite of §2.1. Its role: (a) **node-catalog specification** — every behavior (gravity, speed, drag, color-over-life, scale-over-life, rotation, spawn shapes, death-zone, collide, alpha) maps to a node or subgraph (§16); (b) **optional CPU reference interpreter** of the same IR for differential testing and non-GPU preview — may be skipped if headless GPU proves reliable (post-spike decision).

---

## 6. Domain Model — Compilation context

Pure function: `compile(bundle, catalog, target): CompiledSystem` (the bundle carries ParamDefs and Assets — a bare Graph is not compilable). Deterministic, no I/O, no GPU. Heavily tested with golden output files.

**Pipeline stages:**

1. **Validate** (reuse GraphValidator; re-assert invariants).
2. **Eval-time resolution** — tag nodes `init`/`update`/`both`. Intrinsic constraints: `age`, `time`, `frameRandom` are update-only; `spawnIndex`, `shape.*` init-only. A `both` node MUST be a pure function of eval-time-invariant inputs (uniforms, structural params, `stableRandom`); otherwise **compile error** naming the offending input.
3. **Live-pruning + topological sort** per eval-time subgraph; cycles are errors; ties broken by node.id ascending (determinism).
4. **SSA lowering** — node outputs → typed temps; **every unconnected-input default → a slot in the uniform table** (§12.2); knob bindings map onto those same slots.
5. **Codegen** — backend-specific (WGSL M1; GLSL ES 3.00 TF M2) from the same IR. All emitted arithmetic uses **guarded helpers** where NaN is possible (§13.10).
6. **Assemble kernels** — splice bodies into the fixed per-backend scaffolds (§13.5–§13.6).

**Determinism requirement:** same bundle+catalog+target ⇒ byte-identical sources. Temp naming: `t_<nodeId>` (single-output) / `t_<nodeId>_<portId>` (multi-output) — never a global counter dependent on visit order beyond the deterministic topo sort.

**Write-combination model:**
- *Force-like* outputs (`output.addForce`, `output.drag`) **accumulate**; deterministic topo order (drag is commutative by construction).
- *Set-like* outputs (`output.setVelocity`, `output.writePosition`, `output.writeColor`, `output.writeScale`, `output.writeRotation`, `output.initLife`, `output.spawnPosition`, `output.initVelocity`, `output.initTexIndex`) are **single-writer** — a second writer is a compile error.
- `output.setVelocity` + any `output.addForce` in one system = **compile error** (mutually exclusive control models).
- `output.writeAlpha` is a lane-masked write applied **after** `writeColor`; one of each may coexist.

---

## 7. Domain Model — Simulation / Runtime context (`@pylinka/core`)

### 7.1 Aggregates

**`PylinkaRuntime`** *(project-level handle)* — created from a Project; owns one `ParticleSystemView` per enabled system **and the shared knob bus**: `runtime.params.set('windPower', v)` fans out to every system's UniformBus binding that knob (matches project-scoped knobs in Authoring).

**`ParticleSystemView`** *(per system; is a PixiJS container)* — owns `Pool`, `UniformBus`, compiled programs (via `PipelineCache`), `SpawnScheduler`, draw pipeline. Lifecycle: create → `update(dt)` (flush uniforms → emit → update → render on pixi's pass) → `destroy()`.

### 7.2 Runtime services

- **`Simulator`** — per-frame order per §13.11. dt policy: host rAF dt **clamped to 50 ms** default (configurable); optional **fixed-step mode** (accumulator) for deterministic capture/replay.
- **`BackendProvider`** — host pixi WebGPU renderer → shared `renderer.gpu.device`; host pixi WebGL renderer → WebGL2 TF in the **same GL context** (M2); headless/standalone → own device, WebGPU preferred.
- **`TextureResolver`** — ACL for assets: prefer `Assets.cache[pixiAssetKey]` when present, else decode the blob/inline source.

### 7.3 Coordinate-space contract & moving emitters

- **Simulation is world-space** (v1): particle positions live in the **view's local coordinate space**; `emitterPos` is a uniform consumed **only at spawn**. Moving the emitter moves where new particles are born; alive particles are unaffected — a coin flying across the board leaves sparks that hang and fade in place. (`space:'local'` — aura-follows-character — is an M2 per-system flag.)
- **The parenting anti-pattern, documented loudly:** do **not** `coinSprite.addChild(system.view)` — that transforms every existing particle with the coin and silently defeats world-space simulation. The view belongs in a static VFX layer; the emitter follows the target via the uniform.
- **`system.follow(target)` / `unfollow()`** — samples the target's global transform each frame, converts into the view's local space, drives `setEmitterPosition`. Makes the right thing the easy thing.

### 7.4 Guarantees

- No per-particle CPU access in steady state; `aliveCount`/`overflowCount` readback is opt-in, async, stats-only.
- `params.set` is O(1), allocation-free, effective next frame.
- Pool overflow policy: **drop-new**; `overflowCount` increments; editor warns statically when `rate×maxLife > capacity`.
- `prewarm`: at create/restart, bounded offline fixed-step substeps (`min(prewarm.seconds, 10)` s at 1/30) inside one command encoder before first present.

### 7.5 Recompiles (structural edits)

Structural edit → debounce (200 ms) → async `compile` (Web Worker in the editor) → during compilation the preview overlays **"Recompiling…"** and the system hides its particles → pipelines swap via PipelineCache → **pool resets** (no state preservation; old particles are simply gone) → emission resumes. `recompile(compiled)` on the runtime has the same reset semantics.

### 7.6 Device loss

WebGPU device loss is routine on mobile. On `device.lost`: BackendProvider re-acquires; pipelines rebuild from retained `CompiledSystem` sources (cheap — no graph recompile); pools reset; `onDeviceRestored` fires so hosts re-trigger ambient effects. PipelineCache entries are device-scoped. WebGL2 handles `webglcontextlost/restored` identically (M2).

---

## 8. Domain Model — Persistence context

- **Storage vs interchange:** internally (IndexedDB) the project document references assets by `blobId`; binaries live in a separate store — autosave never rewrites base64. `serializeProject({inlineAssets:true})` produces a single self-contained JSON with data-URI assets for export/recipes; import decodes back into the blob store. One format; no binary variant.
- **Versioning:** `format: "pylinka/v1"` + integer `version`; pure tested migration chain `migrate[n→n+1]`. **Node catalog:** documents carry `catalogVersion`; the catalog ships a kind **alias table** + per-kind param migrations; an **unknown kind** loads as an error-badged placeholder preserving raw JSON — the system won't compile but **no data is ever dropped**.
- Compiled artifacts are derived, never stored.
- Editor autosaves (debounced 800 ms) with incrementing local `revision`; last-write-wins locally.
- `ProjectRepository` is a port (§11.8); a future cloud adapter drops in without touching the domain.

---

## 9. Domain Model — Recipes / Gallery context

Adopts the **pixi-reels MDX/Astro recipe convention verbatim**, plus two enhancements: automatic preview generation and "Open in editor".

- **Convention:** MDX with YAML frontmatter under `apps/site/src/content/recipes/*.mdx` (`title`, `group` from a fixed `RECIPE_GROUPS` list — proposal: `trails/fire/magic/ambient/ui/abstract`, `oneLiner`, `order`, `steps[]`, `apis[]`, `tags[]`; slug from filename). Registry via `import.meta.glob()`; gallery + `[slug]` pages via Astro content collections; optional Keystatic (dev-only). Card media convention-discovered at `public/recipes/<slug>/card.<ext>`; deterministic text placeholder when absent.
- **Pylinka binding:** a recipe's payload is a **PylinkaProject**: `<slug>.recipe.ts` re-exports co-located `<slug>.pylinka.json`; `<RecipeDemo code="<slug>"/>` mounts it via `@pylinka/core`. Frontmatter `apis[]` lists showcased node kinds.
- **Preview generation (`tools/gen-previews`):** **offline frame-stepped rendering** — fixed dt (1/60), fixed seed, render-on-demand frame by frame (no realtime requirement, so a software adapter in CI is acceptable: slow, not wrong). Output: soundless **`card.webm`** + **`card.jpg`** poster (no GIF). Idempotent by `card.hash` = hash(project + render settings). Media generated at site build/deploy (or LFS), **not committed**.
- **Open in editor:** gallery → `/editor?recipe=<slug>` → load, **fork** (fresh UUIDs → new IndexedDB project), open. The shipped recipe is never mutated.

---

## 10. — (reserved)

*(Section intentionally empty; numbering kept stable for cross-references.)*

---

## 11. TypeScript Contracts (normative — every public export)

### 11.1 Shared kernel types (`@pylinka/graph`)

```ts
export type PortType = 'f32' | 'vec2' | 'vec4' | 'color' | 'bool';
export type EvalTime = 'init' | 'update' | 'both';
export type Impact = 'low' | 'medium' | 'high';
export type Backend = 'webgpu' | 'webgl2';

export type Literal =
  | { t: 'f32';   v: number }
  | { t: 'vec2';  v: [number, number] }
  | { t: 'vec4';  v: [number, number, number, number] }
  | { t: 'color'; v: string }           // '#rrggbbaa' lowercase, always 8 digits
  | { t: 'bool';  v: boolean };

export interface Node {
  id: string;                            // unique within graph, /^n[0-9]+$/ when editor-created
  kind: string;                          // must exist in NodeCatalog (after alias resolution)
  /** Structural params: change generated-code SHAPE. Hashed. Recompile on change. */
  structural?: Record<string, string>;   // enum keys only ('ease': 'power2.out', 'param': 'p1')
  /** Value defaults for UNCONNECTED input ports, keyed by portId. Live-tweakable (uniform slots).
      A connected port ignores its entry (kept for reconnect-friendliness). */
  values?: Record<string, Literal>;
  /** portId → ParamDef.id (promotion). */
  knobBindings?: Record<string, string>;
}

export interface Edge {
  id: string;
  from: { nodeId: string; portId: string };
  to:   { nodeId: string; portId: string };
}

export interface Graph { nodes: Node[]; edges: Edge[]; }

export interface ParamDef {
  id: string;                            // 'p1'
  name: string;                          // /^[a-zA-Z_][a-zA-Z0-9_]*$/
  type: 'f32' | 'vec2' | 'color';
  min?: number; max?: number;            // f32 only
  scale: 'linear' | 'log';               // 'log' requires min !== undefined && min > 0
  default: Literal;
  unit?: string;
  group?: string;
}

export interface Asset {
  id: string; name: string; width: number; height: number;
  pixiAssetKey?: string;
  source: { kind: 'blob'; blobId: string } | { kind: 'inline'; src: string };
}

export interface EmitterSettings {
  mode: 'flow' | 'burst' | 'once';
  rate: number;                          // particles/second (flow)
  rateOverDistance?: number;             // particles per px of emitter travel (flow)
  burst?: { count: number; interval: number };  // burst mode: count every interval seconds
  prewarm?: { seconds: number };         // clamped to 10s, substepped at 1/30
}

export interface System {
  id: string; name: string;
  capacity: number;                      // pool size; draw cost scales with this (§13.8); warn > 262144
  blendMode: 'normal' | 'add' | 'screen';
  enabled: boolean;
  space: 'world';                        // 'local' arrives M2; v1 parser rejects other values
  emitter: EmitterSettings;
  graph: Graph;
}

export interface PylinkaProject {
  format: 'pylinka/v1';
  version: number;                       // integer, starts at 1
  catalogVersion: number;
  id: string; name: string;
  createdAt: string; updatedAt: string;  // ISO-8601
  params: ParamDef[];
  assets: Asset[];
  systems: System[];
  editor?: EditorViewState;              // presentation-only: never hashed, never read by runtime
}

export interface EditorViewState {
  viewport: { x: number; y: number; zoom: number };
  nodePositions: Record<string, { x: number; y: number }>;
  activeSystemId?: string;
}

export interface SystemBundle {
  system: System;
  params: ParamDef[];
  assets: Asset[];
}
```

### 11.2 NodeSchema & catalog

```ts
export interface PortSpec {
  id: string;
  type: PortType;
  /** Inputs only: default literal when unconnected → materializes a value slot.
      Required on every input port (no "must-connect" inputs in v1). */
  defaultValue?: Literal;
}

export interface StructuralSpec { key: string; options: string[]; default: string; }

export interface NodeSchema {
  kind: string;                          // 'namespace.name'
  label: string;
  namespace: 'input' | 'param' | 'gen' | 'math' | 'field' | 'shape' | 'output' | 'tex';
  evalTime: EvalTime | 'inferred';
  impact: Impact;
  impactNote?: string;
  rngClass?: 'stable' | 'frame';         // gen.* only
  inputs: PortSpec[];
  outputs: PortSpec[];
  structural: StructuralSpec[];
  codegen: NodeCodegen;
}

export interface NodeCatalog {
  version: number;
  schemas: ReadonlyMap<string, NodeSchema>;
  aliases: ReadonlyMap<string, string>;  // old kind → new kind, applied on document load
}

/** A WGSL/GLSL expression string, e.g. 'V[3].xy' or 't_n11'. */
export type Expr = string;

export interface CodegenCtx {
  valueSlot(portId: string): Expr;       // reads the slot bound to (nodeId, portId), type-correct swizzle
  knobSlot(paramId: string): Expr;
  stableRandom(): Expr;                  // [0,1), constant per particle life; static index auto-assigned
  frameRandom(): Expr;                   // [0,1), per frame; update-eval only (enforced)
  line(stmt: string): void;              // emit a statement (multi-line nodes)
  temp(type: PortType): string;          // fresh declared temp name
  safeDiv(a: Expr, b: Expr): Expr;       // ALWAYS use instead of raw '/' (§13.10)
  safeNormalize(v: Expr): Expr;
  readonly consts: { PI: Expr; DT: Expr; TIME: Expr; AGE_N: Expr };
}

export interface NodeEmit { outputs: Record<string, Expr>; }

export type NodeCodegen = (
  ctx: CodegenCtx,
  inputs: Record<string, Expr>,          // connected → upstream temp; unconnected → valueSlot()
  structural: Record<string, string>,
) => NodeEmit;
```

Node-codegen author checklist: (1) pure function of arguments; (2) never raw divide/normalize — use ctx helpers; (3) single-expression nodes return inline, multi-statement nodes use `ctx.line` + `ctx.temp`; (4) structural params select code shapes with TS `if`/`switch` at compile time — never emit runtime branches for structural choices.

### 11.3 Graph functions (`@pylinka/graph`)

```ts
export function validateGraph(bundle: SystemBundle, catalog: NodeCatalog): Diagnostic[];
export function hashGraph(graph: Graph): string;      // §12.1
export function assignSlots(graph: Graph, params: ParamDef[]): UniformLayout;  // §12.2
```

### 11.4 Compiler (`@pylinka/compiler`)

```ts
export function compile(
  bundle: SystemBundle,
  catalog: NodeCatalog,
  target: Backend,                       // M1 implements 'webgpu' only; 'webgl2' throws NotImplemented
): CompiledSystem;                       // throws CompileError carrying Diagnostic[] on invalid input

export interface CompiledSystem {
  graphHash: string;
  backend: Backend;
  emitSrc: string;                       // full kernel source (scaffold + generated body)
  updateSrc: string;
  uniforms: UniformLayout;
  bindings: BindingLayout;               // fixed for v1 — §13.2 binding table
  textures: { assetId: string; binding: number }[];
  diagnostics: Diagnostic[];             // warnings only (errors throw)
}

export interface SlotEntry {
  slot: number;                          // index into the vec4 value array
  type: PortType | ParamDef['type'];
  origin: { kind: 'nodeValue'; nodeId: string; portId: string }
        | { kind: 'knob'; paramId: string };
}
export interface UniformLayout {
  slotCount: number;                     // ≥ 1 (emit a 1-length array even if unused)
  entries: SlotEntry[];
  systemUniformsSize: number;            // 48 — §13.3
}
```

### 11.5 Runtime (`@pylinka/core`)

```ts
export interface CreateOptions {
  renderer?: unknown;                    // pixi Renderer; backend + device/context derived from it
  device?: GPUDevice;                    // explicit device (headless); mutually exclusive with renderer
  resolveTexture?: (asset: Asset) => unknown | undefined;   // pixi Texture or undefined
  fixedStep?: number;                    // seconds; enables fixed-step mode (e.g. 1/60)
  maxDt?: number;                        // clamp, default 0.05
  onDeviceLost?: () => void;
  onDeviceRestored?: () => void;
}

export function createPylinka(project: PylinkaProject, opts: CreateOptions): Promise<PylinkaRuntime>;
export function createParticleSystem(bundle: SystemBundle, opts: CreateOptions): Promise<ParticleSystemView>;

export interface PylinkaRuntime {
  readonly systems: Record<string, ParticleSystemView>;    // keyed by System.name
  readonly params: KnobBus;              // project-wide fan-out
  update(dtSeconds: number): void;       // once per rAF tick; clamps / fixed-steps internally
  destroy(): void;
}

export interface KnobBus {
  set(name: string, x: number, y?: number, z?: number, w?: number): void;  // O(1), alloc-free
  get(name: string): number;             // .x component; editor convenience
}

export interface ParticleSystemView {
  readonly view: unknown;                // pixi Container — add to a STATIC layer (§7.3)
  readonly params: KnobBus;
  update(dtSeconds: number): void;       // no-op if driven via PylinkaRuntime.update
  setEmitterPosition(x: number, y: number): void;
  follow(target: unknown): void;         // pixi Container
  unfollow(): void;
  spawnBurst(count: number): void;       // adds to next frame's spawn count
  restart(): void;                       // pool + scheduler reset (+ prewarm if configured)
  recompile(compiled: CompiledSystem): void;   // swaps pipelines; POOL RESETS (§7.5)
  readonly stats: { aliveCount: number; overflowCount: number; gpuMs: number | null };
  destroy(): void;
}
```

Hot-path rules (enforced by the allocation test): `update`, `set`, `setEmitterPosition`, `spawnBurst` allocate nothing. `stats` fields are plain numbers refreshed asynchronously — reading never triggers a readback.

### 11.6 Format (`@pylinka/format`)

```ts
export function parseProject(json: string, catalog: NodeCatalog): { project: PylinkaProject; diagnostics: Diagnostic[] };
export function serializeProject(project: PylinkaProject, opts: { inlineAssets: boolean; assetLoader?: (blobId: string) => Promise<Blob> }): Promise<string>;
export function migrateDocument(doc: unknown): PylinkaProject;   // migrate[n→n+1] chain; throws on unknown format
```

`parseProject` applies catalog aliases, wraps unknown kinds in placeholder nodes (E201), never throws on preservable content.

### 11.7 Editor (`@pylinka/editor`)

React components (`<PylinkaEditor/>`, node UIs, `<ParamPanel/>`), plus the repositories in §11.8.

### 11.8 Persistence (editor)

IndexedDB database `pylinka`, version 1:

| Store | Key | Value | Indices |
|---|---|---|---|
| `projects` | `id` | PylinkaProject (assets as blob refs) + `revision: number` | `updatedAt` |
| `assets` | `id` (= blobId) | `{ id, name, width, height, blob: Blob }` | — |
| `previews` | `projectId` | `{ projectId, blob: Blob, capturedAt }` | — |

```ts
export interface ProjectRepository {
  list(): Promise<{ id: string; name: string; updatedAt: string }[]>;
  load(id: string): Promise<PylinkaProject | undefined>;
  save(project: PylinkaProject): Promise<void>;   // bumps revision, sets updatedAt
  remove(id: string): Promise<void>;
  fork(project: PylinkaProject, newName: string): Promise<PylinkaProject>;  // fresh UUIDs
}
export interface AssetStore {
  put(file: Blob, name: string): Promise<Asset>;  // decodes dims, stores blob, returns ref
  getBlob(blobId: string): Promise<Blob | undefined>;
  remove(blobId: string): Promise<void>;
}
```

---

## 12. Algorithms (exact)

### 12.1 Graph hashing (`hashGraph`)

Identical hash ⟺ identical generated code shape. Value literals and knob values NEVER affect the hash; connectivity and structural params ALWAYS do.

```
canonical string := "H1"                                   // hash-format version
  + for each node of LIVE(graph), sorted by node.id ascending (plain '<' string compare):
      "|N|" + id + "|" + kind
      + for each structural entry sorted by key: "|" + key + "=" + value
  + for each edge with both endpoints in LIVE(graph),
      sorted by (from.nodeId, from.portId, to.nodeId, to.portId):
      "|E|" + from.nodeId + "." + from.portId + ">" + to.nodeId + "." + to.portId
```

- `LIVE(graph)` = nodes from which an `output.*` node is reachable following edges forward, plus all `output.*` nodes. Dead nodes don't affect the hash (pruned before codegen).
- Hash: **FNV-1a 64-bit** over UTF-8 (BigInt: offset `0xcbf29ce484222325n`, prime `0x100000001b3n`, mask 64 bits per step). Output: 16-char lowercase hex. Not a hot path; BigInt is fine.
- EXCLUDED: `values`, `knobBindings`, `editor` state, node positions, ParamDef contents.

### 12.2 Value-slot assignment

After validation and live-pruning:

1. Collect every **unconnected input port** of every live node → candidate slots `(nodeId, portId)`.
2. Sort by `nodeId` ascending, then `portId` ascending (plain string compare). Assign indices 0..k−1.
3. Then every ParamDef referenced by a live `param.ref` or `knobBindings`, sorted by `ParamDef.id` → slots k..n−1.
4. Every slot occupies **one full `vec4<f32>`**: `f32` in `.x`, `vec2` in `.xy`, `vec4`/`color` full, `bool` as 0.0/1.0 in `.x`. Wasteful and deliberately so — do NOT pack tighter.

### 12.3 Validation — error taxonomy

`validateGraph` returns `Diagnostic[]`; errors block compile, warnings don't.

```ts
export interface Diagnostic {
  code: DiagnosticCode;
  severity: 'error' | 'warning';
  message: string;                       // human sentence, includes names not just ids
  nodeId?: string; portId?: string; edgeId?: string; paramId?: string; assetId?: string;
}
```

| Code | Sev | Condition |
|---|---|---|
| `V001_UNKNOWN_KIND` | error | node.kind not in catalog (after aliasing) |
| `V002_TYPE_MISMATCH` | error | edge connects incompatible PortTypes (coercion table below) |
| `V003_CYCLE` | error | directed cycle |
| `V004_MISSING_OUTPUT` | error | no `output.spawnPosition` or no `output.initLife` |
| `V005_DUPLICATE_WRITER` | error | 2nd writer to a single-writer output kind |
| `V006_SETVEL_WITH_ADDFORCE` | error | `output.setVelocity` coexists with `output.addForce` |
| `V007_EVALTIME` | error | node needs a value unavailable at its eval time (message names the input) |
| `V008_IMPURE_BOTH` | error | `both`-eval node depends on non-invariant input |
| `V009_MULTI_EDGE_INTO_PORT` | error | two edges into one input port |
| `V010_UNKNOWN_PARAM` | error | `param.ref`/knobBinding references missing ParamDef |
| `V011_UNKNOWN_ASSET` | error | tex.* references missing Asset |
| `V012_BAD_LOG_PARAM` | error | ParamDef scale 'log' with min ≤ 0 or undefined |
| `W101_CAPACITY_OVERFLOW` | warn | `rate × maxLifeEstimate > capacity` (when statically known) |
| `W102_HIGH_IMPACT` | warn | graph uses a `high`-impact node (message carries impactNote) |
| `W103_DEAD_NODE` | warn | node not in LIVE(graph) |
| `E201_UNKNOWN_KIND_PRESERVED` | error | document loaded with unknown kind (placeholder; system won't compile; data preserved) |

Coercion table (edge `from → to`): identical types OK; `f32 → vec2/vec4` OK (splat); `color ↔ vec4` OK; everything else `V002`. Narrowing requires an explicit `math.component`/`math.swizzle` node.

---

## 13. GPU Contract (WebGPU backend, M1)

### 13.1 Conventions (most "weak implementer" bugs live here)

- **Coordinates:** 2D, pixels, in the **view's local space** (world-space sim, §7.3). +Y is **down** (pixi). Angles in radians, 0 = +X, positive = clockwise (consistent with +Y down).
- **Units:** positions px; velocities px/s; forces px/s² (accelerations); drag coefficient 1/s; life & age seconds. The scaffold owns ALL multiplication by `dt` — generated node code never touches `dt` directly.
- **Color:** authored `#rrggbbaa` sRGB. No linear-light pipeline in v1 — colors pass through as-is (pixi 2D convention). Stored per particle as packed `rgba8unorm` u32.
- **Premultiplied alpha:** particle **textures are premultiplied** (pixi's default on upload). Fragment combine: `out = vec4(tex.rgb * tint.rgb * tint.a, tex.a * tint.a)` — §13.8.
- **Blend states** (`System.blendMode`), premultiplied output assumed:

| mode | color src | color dst | alpha src | alpha dst |
|---|---|---|---|---|
| `normal` | `one` | `one-minus-src-alpha` | `one` | `one-minus-src-alpha` |
| `add` | `one` | `one` | `one` | `one` |
| `screen` | `one` | `one-minus-src` | `one` | `one-minus-src-alpha` |

- **NaN reality check:** WGSL implementations may assume floats are never NaN and optimize `x != x` away. NaN is therefore **prevented** (guarded helpers §13.10) and runaways are killed by a **magnitude bound** (§13.6 step 5), never a NaN test.

### 13.2 Buffers, structs, bindings

```wgsl
struct ParticleHot  { pos: vec2f, vel: vec2f, age: f32, life: f32 }   // stride 24
struct ParticleRnd  { color: u32, size: f32, rot: f32 }               // stride 12; color = pack4x8unorm
struct ParticleMeta { seed: u32, flags: u32 }                         // stride 8
// flags: bit 0 = alive; bits 8..15 = texIndex (atlas cell)
struct Counters { freeTop: atomic<i32>, aliveCount: atomic<u32>, overflowCount: atomic<u32> }
```

Compute bind group — **group 0, fixed for every system** (this IS `BindingLayout` v1; do not renumber):

| binding | resource | type |
|---|---|---|
| 0 | `U: SystemUniforms` | uniform |
| 1 | `V: array<vec4f, SLOTS>` | uniform (value table) |
| 2 | `hot: array<ParticleHot>` | storage, read_write |
| 3 | `rnd: array<ParticleRnd>` | storage, read_write |
| 4 | `meta: array<ParticleMeta>` | storage, read_write |
| 5 | `cnt: Counters` | storage, read_write |
| 6 | `freeList: array<u32>` | storage, read_write |

All particle buffers created with usage `STORAGE | VERTEX` (they double as instance vertex buffers — §13.8; this sidesteps vertex-stage storage-buffer limits, which may be **0 in WebGPU compatibility mode**). Init: `freeList[i] = i`, `freeTop = capacity`, all flags 0.

### 13.3 Uniforms

```wgsl
struct SystemUniforms {
  emitterPos:     vec2f,   // offset 0
  prevEmitterPos: vec2f,   // offset 8
  emitterVel:     vec2f,   // offset 16
  dt:             f32,     // offset 24
  time:           f32,     // offset 28
  frame:          u32,     // offset 32
  spawnCount:     u32,     // offset 36
  capacity:       u32,     // offset 40
  baseSeed:       u32,     // offset 44
}                          // size 48 — do not reorder members
```

**Value table:** `@group(0) @binding(1) var<uniform> V: array<vec4f, SLOTS>;` with `SLOTS = max(1, slotCount)` baked as a literal. CPU staging = one `Float32Array(4 * SLOTS)`; flush = one `queue.writeBuffer` per frame (+ one for SystemUniforms). **Exactly two `writeBuffer` calls per system per frame in steady state — no more.**

### 13.4 PRNG

```wgsl
fn pcg(v: u32) -> u32 {
  var s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn hash2(a: u32, b: u32) -> u32 { return pcg(a ^ pcg(b)); }
fn rand01(h: u32) -> f32 { return f32(h) * 2.3283064365386963e-10; }   // h / 2^32 → [0,1)
fn srand(seed: u32, n: u32) -> f32 { return rand01(hash2(seed, n)); }  // stableRandom
fn frand(seed: u32, frame: u32, n: u32) -> f32 { return rand01(hash2(seed, hash2(frame, n))); }
```

- Particle seed at spawn: `seed = hash2(U.baseSeed, hash2(slot, U.frame))`.
- `ctx.stableRandom()` → `srand(seed, K)`, K a static index assigned in topo order starting at 0, one per call site. **Constant for the particle's whole life** (per-particle variation: drag coefficient, tint jitter, size).
- `ctx.frameRandom()` → `frand(seed, U.frame, K)` with its own index sequence (turbulence kicks, flicker).
- CPU: `baseSeed` from a user seed (default `Date.now() >>> 0`; fixed in capture mode), advanced per frame with the same pcg in TS.

### 13.5 Emit kernel — scaffold template (generated body spliced at the mark)

```wgsl
@compute @workgroup_size(64)
fn emit(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= U.spawnCount) { return; }
  let top = atomicSub(&cnt.freeTop, 1);
  if (top <= 0) {                                  // pool exhausted → drop-new
    atomicAdd(&cnt.freeTop, 1);
    atomicAdd(&cnt.overflowCount, 1u);
    return;
  }
  let slot = freeList[u32(top - 1)];
  let f = (f32(i) + 0.5) / f32(U.spawnCount);      // sub-frame fraction
  let spawnOrigin = mix(U.prevEmitterPos, U.emitterPos, f);
  let seed = hash2(U.baseSeed, hash2(slot, U.frame));

  // ---- GENERATED INIT BODY ----
  // must define: o_spawnLocal: vec2f, o_initLife: f32
  // may define:  o_initVel: vec2f (default vec2f(0)), o_texIndex: u32 (default 0u)
  // ---- END GENERATED ----

  hot[slot].pos  = spawnOrigin + o_spawnLocal;     // shapes are emitter-relative
  hot[slot].vel  = o_initVel;
  hot[slot].life = max(o_initLife, 1e-4);
  hot[slot].age  = U.dt * (1.0 - f);               // earlier-in-frame spawns are older
  meta[slot].seed  = seed;
  meta[slot].flags = 1u | (o_texIndex << 8u);
  rnd[slot] = ParticleRnd(0xffffffffu, 1.0, 0.0);  // update pass runs the same frame and overwrites
  atomicAdd(&cnt.aliveCount, 1u);
}
```

Dispatch: `ceil(spawnCount / 64)` workgroups; skipped entirely when `spawnCount == 0`.

### 13.6 Update kernel — scaffold template & integration order

```wgsl
const RUNAWAY: f32 = 1e7;                          // px magnitude bound (NaN-free kill backstop)

@compute @workgroup_size(256)
fn update(@builtin(global_invocation_id) gid: vec3u) {
  let slot = gid.x;
  if (slot >= U.capacity) { return; }
  if ((meta[slot].flags & 1u) == 0u) { return; }
  var p = hot[slot];
  let seed = meta[slot].seed;
  let ageN = clamp(p.age / p.life, 0.0, 1.0);      // life ≥ 1e-4 guaranteed at emit
  var force   = vec2f(0.0);
  var dragK   = 0.0;
  var kill    = false;
  var outColor = unpack4x8unorm(rnd[slot].color);
  var outSize  = rnd[slot].size;
  var outRot   = rnd[slot].rot;

  // ---- GENERATED UPDATE BODY ----
  // accumulates into: force (+=), dragK (+=), kill (|| =)
  // writes: outColor / outSize / outRot / p.vel (setVelocity) / p.pos (writePosition)
  // ---- END GENERATED ----

  p.vel += force * U.dt;                           // 1. accelerations → semi-implicit Euler
  p.vel *= exp(-dragK * U.dt);                     // 2. exponential drag (frame-rate independent)
  p.pos += p.vel * U.dt;                           // 3. integrate position
  p.age += U.dt;                                   // 4. age
  let runaway = any(abs(p.pos) > vec2f(RUNAWAY));  // 5. NaN-free runaway check
  if (p.age >= p.life || kill || runaway) {        // 6. death (end-of-life kill is AUTOMATIC)
    meta[slot].flags = meta[slot].flags & ~1u;
    let idx = atomicAdd(&cnt.freeTop, 1);
    freeList[u32(idx)] = slot;
    atomicSub(&cnt.aliveCount, 1u);
    return;
  }
  hot[slot] = p;
  rnd[slot].color = pack4x8unorm(clamp(outColor, vec4f(0.0), vec4f(1.0)));
  rnd[slot].size  = outSize;
  rnd[slot].rot   = outRot;
}
```

Ordering rules:
- `output.setVelocity` graphs: body assigns `p.vel = ...;` and the compiler omits scaffold lines 1–2 (force/drag alongside setVelocity is `V006`).
- `output.writePosition` (escape hatch): compiler places the assignment between integration (3) and aging (4).
- Frame order in one command encoder: **emit dispatch → update dispatch → draw.** Never merge or reorder: free-list safety depends on it — emit only pops, update only pushes, and the inter-dispatch barrier keeps `freeTop` consistent even though it goes transiently negative inside emit.

### 13.7 Spawn scheduling (CPU)

```ts
// state: acc = 0, pendingBurst = 0, burstClock = 0, startedOnce = false
// per frame, BEFORE flushing uniforms:
const dist = Math.hypot(ex - pex, ey - pey);           // emitter travel this frame
switch (mode) {
  case 'flow':  acc += rate * dt + (rateOverDistance ?? 0) * dist; break;
  case 'burst': burstClock += dt;
                while (burstClock >= burst.interval) { burstClock -= burst.interval; pendingBurst += burst.count; }
                break;
  case 'once':  if (!startedOnce) { pendingBurst += burst?.count ?? rate; startedOnce = true; } break;
}
acc += pendingBurst; pendingBurst = 0;
let count = Math.min(Math.floor(acc), capacity);       // hard clamp
acc -= count;
uniforms.spawnCount = count;
```

`spawnBurst(n)` adds to `pendingBurst`. `restart()` zeroes scheduler state, resets the pool (re-upload freeList/counters/flags), then prewarms if configured. **Fixed-step mode** (`opts.fixedStep = h`): accumulate real dt (clamped by `maxDt`), `while (acc >= h) step(h)`; no render interpolation in v1.

Also written per frame: `emitterVel = (emitterPos − prevEmitterPos) / dt` (feeds `input.emitterVelocity` — e.g. `initVelocity = randomVec2 − 0.3·emitterVelocity` throws sparks backward from a fast coin).

### 13.8 Render pipeline

One instanced draw per system: 6 vertices (two triangles from a const array — no index/vertex buffer), `instanceCount = capacity`. Dead particles render as zero-size degenerate quads. **Draw cost scales with `capacity`, not aliveCount** — by design until M2 compaction; keep authored capacities honest.

Vertex buffers (instance step mode, straight from the sim buffers):

| slot | buffer | stride | attributes |
|---|---|---|---|
| 0 | hot | 24 | `@location(0) pos: float32x2 @ 0` |
| 1 | rnd | 12 | `@location(1) color: unorm8x4 @ 0`, `@location(2) size: float32 @ 4`, `@location(3) rot: float32 @ 8` |
| 2 | meta | 8 | `@location(4) flags: uint32 @ 4` |

```wgsl
struct RenderUniforms {
  scaleOffset: vec4f,   // clip = world.xy * scaleOffset.xy + scaleOffset.zw
  atlas: vec4f,         // cols, rows, unused, unused
}
@group(0) @binding(0) var<uniform> R: RenderUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

const CORNERS = array<vec2f, 6>(
  vec2f(-0.5,-0.5), vec2f(0.5,-0.5), vec2f(-0.5,0.5),
  vec2f(-0.5,0.5),  vec2f(0.5,-0.5), vec2f(0.5,0.5));

struct VSOut { @builtin(position) clip: vec4f, @location(0) uv: vec2f, @location(1) tint: vec4f }

@vertex
fn vs(@builtin(vertex_index) vi: u32,
      @location(0) pos: vec2f, @location(1) color: vec4f,
      @location(2) size: f32,  @location(3) rot: f32, @location(4) flags: u32) -> VSOut {
  let corner = CORNERS[vi];
  let s = size * f32(flags & 1u);                  // dead → zero-size
  let c = cos(rot); let sn = sin(rot);
  let local = vec2f(corner.x * c - corner.y * sn, corner.x * sn + corner.y * c) * s;
  let world = pos + local;
  let texIndex = (flags >> 8u) & 0xffu;
  let cols = u32(R.atlas.x);
  let cell = vec2f(f32(texIndex % cols), f32(texIndex / cols));
  var o: VSOut;
  o.clip = vec4f(world * R.scaleOffset.xy + R.scaleOffset.zw, 0.0, 1.0);
  o.uv   = (corner + 0.5 + cell) / R.atlas.xy;
  o.tint = color;
  return o;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let t = textureSample(tex, samp, in.uv);         // premultiplied texture (§13.1)
  return vec4f(t.rgb * in.tint.rgb * in.tint.a, t.a * in.tint.a);
}
```

`scaleOffset` standalone/headless: `(2/w, -2/h, -1, 1)` for a w×h px viewport. The pixi-hosted transform hookup (inheriting the view's worldTransform) is the M1.0 spike's deliverable; until decided, the spike uses this ortho path with the view at identity.

**No depth sorting in v1**: additive/premultiplied recommended; unsorted alpha-blend smoke will pop — documented limitation.

### 13.9 Ease catalog (structural param `ease`; compiler inlines exactly one as `fn easeSel(t: f32) -> f32`)

`t ∈ [0,1]` (clamped `ageN`). GSAP naming: powerN = polynomial of degree N+1. Complete v1 set:

| key | formula |
|---|---|
| `linear` | `t` |
| `power1.in` | `t*t` |
| `power1.out` | `1-(1-t)*(1-t)` |
| `power1.inOut` | `t<0.5 ? 2*t*t : 1-2*(1-t)*(1-t)` |
| `power2.in` | `t^3` |
| `power2.out` | `1-(1-t)^3` |
| `power2.inOut` | `t<0.5 ? 4*t^3 : 1-4*(1-t)^3` |
| `power3.in` | `t^4` |
| `power3.out` | `1-(1-t)^4` |
| `sine.in` | `1-cos(t*PI/2)` |
| `sine.out` | `sin(t*PI/2)` |
| `sine.inOut` | `0.5-0.5*cos(t*PI)` |
| `expo.out` | `t>=1 ? 1 : 1-exp2(-10*t)` |
| `back.out` | `1+2.70158*(t-1)^3+1.70158*(t-1)^2` |

### 13.10 Guarded math

```wgsl
fn safeDiv(a: f32, b: f32) -> f32 {
  let s = select(1.0, sign(b), b != 0.0);          // sign(0)==0 in WGSL — never a zero denominator
  return a / select(b, s * 1e-6, abs(b) < 1e-6);
}
fn safeDiv2(a: vec2f, b: vec2f) -> vec2f { return vec2f(safeDiv(a.x,b.x), safeDiv(a.y,b.y)); }
fn safeNormalize(v: vec2f) -> vec2f {
  let len = length(v);
  return select(v / len, vec2f(0.0), len < 1e-6);
}
```

### 13.11 Per-frame CPU sequence (steady state — this exact order, nothing more)

```
1. follow(): sample target world transform → emitterPos           (if following)
2. SpawnScheduler: compute spawnCount, advance baseSeed
3. Write SystemUniforms staging; writeBuffer #1
4. Write value table; writeBuffer #2 (unconditional — small; simpler than dirty tracking)
5. encoder: [emit dispatch if spawnCount>0] → [update dispatch] → (pixi renders the draw)
6. prevEmitterPos = emitterPos
7. every 30 frames: async readback of Counters into stats (non-blocking, one reused staging buffer)
```

Zero allocations in steps 1–7. Timestamp queries (when `'timestamp-query'` available) wrap the update dispatch → `stats.gpuMs`.

### 13.12 IR neutrality rules (keeps the M2 WebGL2 backend possible)

Node codegen must never assume: atomics, storage buffers, compute stages, `pack4x8unorm`, workgroups — those live in per-backend **scaffolds**. Node codegen may only emit arithmetic, ctx helpers, texture sampling via ctx (M2), and reads of scaffold-provided variables (`ageN`, `p.pos`, `p.vel`, seed-based rands). WebGL2 mapping (M2): value table → `uniform vec4 V[SLOTS]`; particle state → TF varyings; spawning via **cursor-window** (no atomics: a slot self-respawns when dead AND its index ∈ `[spawnCursor, spawnCursor+spawnCount) mod N`; alive slots in the window simply don't respawn — effective drop-new, an accepted approximation on the fallback tier).

### 13.13 Multi-system & device sharing

Systems share device and PipelineCache; identical graph hashes share pipelines. Culling is **host-driven** (`enabled`/visibility): no GPU-side AABBs in v1 (would require readback — rejected).

---

## 14. GOLDEN EXAMPLE — coin-spark-trail

The compiler's north star: `packages/compiler/test/golden/coin-spark-trail.{emit,update}.wgsl` must match this **semantically**; byte-exact form is frozen by the first implementation and changed only deliberately.

### 14.1 Input project (`pylinka/v1` JSON — also the §15 format example)

Ember trail behind a flying coin: point spawn + rate-over-distance, upward random velocity, gravity + knob-driven wind, color fade, automatic end-of-life kill.

```jsonc
{
  "format": "pylinka/v1",
  "version": 1,
  "catalogVersion": 1,
  "id": "uuid",
  "name": "Coin Spark Trail",
  "createdAt": "2026-07-10T00:00:00Z",
  "updatedAt": "2026-07-10T00:00:00Z",
  "params": [
    { "id": "p1", "name": "windPower", "type": "f32", "min": 0, "max": 200, "scale": "log", "default": {"t":"f32","v":10}, "unit": "px/s²", "group": "Wind" },
    { "id": "p2", "name": "windDir",   "type": "f32", "min": -3.14159, "max": 3.14159, "scale": "linear", "default": {"t":"f32","v":0}, "unit": "rad", "group": "Wind" }
  ],
  "assets": [
    { "id": "a1", "name": "spark", "width": 32, "height": 32, "pixiAssetKey": "vfx/spark",
      "source": { "kind": "inline", "src": "data:image/png;base64,iVBORw0K…" } }
  ],
  "systems": [
    {
      "id": "s1", "name": "sparks", "capacity": 8192, "blendMode": "add", "enabled": true, "space": "world",
      "emitter": { "mode": "flow", "rate": 200, "rateOverDistance": 0.8 },
      "graph": {
        "nodes": [
          { "id": "n1",  "kind": "shape.point",          "values": { "offset": {"t":"vec2","v":[0,0]} } },
          { "id": "n2",  "kind": "output.spawnPosition" },
          { "id": "n3",  "kind": "gen.randomRange",      "values": { "min": {"t":"f32","v":0.5}, "max": {"t":"f32","v":1.2} } },
          { "id": "n4",  "kind": "output.initLife" },
          { "id": "n5",  "kind": "gen.randomVec2",       "values": { "min": {"t":"vec2","v":[-30,-80]}, "max": {"t":"vec2","v":[30,-160]} } },
          { "id": "n6",  "kind": "output.initVelocity" },
          { "id": "n7",  "kind": "field.gravity",        "values": { "g": {"t":"vec2","v":[0,300]} } },
          { "id": "n8",  "kind": "output.addForce" },
          { "id": "n9",  "kind": "param.ref",            "structural": { "param": "p1" } },
          { "id": "n10", "kind": "param.ref",            "structural": { "param": "p2" } },
          { "id": "n11", "kind": "field.directional" },
          { "id": "n12", "kind": "output.addForce" },
          { "id": "n13", "kind": "gen.colorOverLife",    "structural": { "ease": "power2.out" },
                         "values": { "from": {"t":"color","v":"#fff2a8ff"}, "to": {"t":"color","v":"#ff2a0000"} } },
          { "id": "n14", "kind": "output.writeColor" }
        ],
        "edges": [
          { "id": "e1", "from": {"nodeId":"n1","portId":"pos"},    "to": {"nodeId":"n2","portId":"pos"} },
          { "id": "e2", "from": {"nodeId":"n3","portId":"out"},    "to": {"nodeId":"n4","portId":"life"} },
          { "id": "e3", "from": {"nodeId":"n5","portId":"out"},    "to": {"nodeId":"n6","portId":"vel"} },
          { "id": "e4", "from": {"nodeId":"n7","portId":"force"},  "to": {"nodeId":"n8","portId":"force"} },
          { "id": "e5", "from": {"nodeId":"n9","portId":"out"},    "to": {"nodeId":"n11","portId":"strength"} },
          { "id": "e6", "from": {"nodeId":"n10","portId":"out"},   "to": {"nodeId":"n11","portId":"angle"} },
          { "id": "e7", "from": {"nodeId":"n11","portId":"force"}, "to": {"nodeId":"n12","portId":"force"} },
          { "id": "e8", "from": {"nodeId":"n13","portId":"out"},   "to": {"nodeId":"n14","portId":"color"} }
        ]
      }
    }
  ],
  "editor": {
    "viewport": { "x": 0, "y": 0, "zoom": 1 },
    "nodePositions": { "n1": {"x":40,"y":80}, "n5": {"x":40,"y":200} }
  }
}
```

Notes: every required output present; the wind is actually wired (knobs → `field.directional` → `addForce`); two `addForce` writers accumulate legally; end-of-life kill is scaffold-automatic — no kill node; `values` are all live uniforms; `structural` fields (`ease`, `param`) recompile on change; `editor` is presentation-only.

### 14.2 Expected slot assignment (§12.2)

| slot | origin | type |
|---|---|---|
| 0 | n1.offset | vec2 |
| 1 | n13.from | color |
| 2 | n13.to | color |
| 3 | n3.max | f32 |
| 4 | n3.min | f32 |
| 5 | n5.max | vec2 |
| 6 | n5.min | vec2 |
| 7 | n7.g | vec2 |
| 8 | knob p1 (windPower) | f32 |
| 9 | knob p2 (windDir) | f32 |

`SLOTS = 10`; `systemUniformsSize == 48`. Stable-random indices: n3→0; n5→1,2.

### 14.3 Expected generated init body (spliced into §13.5)

```wgsl
  // n1 shape.point
  let t_n1 = V[0].xy;
  // n3 gen.randomRange [stable #0]
  let t_n3 = mix(V[4].x, V[3].x, srand(seed, 0u));
  // n5 gen.randomVec2 [stable #1, #2]
  let t_n5 = mix(V[6].xy, V[5].xy, vec2f(srand(seed, 1u), srand(seed, 2u)));
  let o_spawnLocal: vec2f = t_n1;      // output.spawnPosition ← n1
  let o_initLife: f32 = t_n3;          // output.initLife ← n3
  let o_initVel: vec2f = t_n5;         // output.initVelocity ← n5
  let o_texIndex: u32 = 0u;
```

### 14.4 Expected generated update body (spliced into §13.6)

```wgsl
  // n7 field.gravity
  let t_n7 = V[7].xy;
  // n9 param.ref → windPower
  let t_n9 = V[8].x;
  // n10 param.ref → windDir
  let t_n10 = V[9].x;
  // n11 field.directional
  let t_n11 = vec2f(cos(t_n10), sin(t_n10)) * t_n9;
  force += t_n7;                       // output.addForce (n8)
  force += t_n11;                      // output.addForce (n12)
  // n13 gen.colorOverLife [ease=power2.out]
  let t_n13 = mix(V[1], V[2], easeSel(ageN));
  outColor = t_n13;                    // output.writeColor (n14)
```

With `fn easeSel(t: f32) -> f32 { let u = 1.0 - t; return 1.0 - u*u*u; }` emitted once above the kernel.

### 14.5 Acceptance behavior (drives the M1.0 spike demo)

Emitter moved on a circle at 600 px/s with `rate 200 + rateOverDistance 0.8` produces a **continuous** ring of sparks (no dashed clumps — sub-frame interpolation working), sparks fall under gravity, bend live with `windPower` (no recompile), fade amber→transparent-red, and the ring persists behind the moving emitter (world space).

---

## 15. Data Formats

### 15.1 `PylinkaProject` JSON — see the full validating example in §14.1. That example IS the format specification by example; §11.1 types are the schema.

### 15.2 Recipe MDX (pixi-reels convention)

```mdx
---
title: Coin Spark Trail
group: trails
oneLiner: World-space sparks that hang behind a flying coin, with a live wind knob.
order: 1
tags: [trail, additive, wind, beginner]
apis: [shape.point, gen.randomVec2, field.gravity, field.directional, param.ref, gen.colorOverLife]
steps:
  - Spawn along the emitter's path (rate-over-distance) with upward random velocity
  - Gravity plus a wind force driven by the windPower knob
  - Fade colour over life; particles die automatically at end of life
---

<RecipeDemo code="coin-spark-trail" />

Prose explaining the effect…
```

`apps/site/src/recipes/coin-spark-trail.pylinka.json` holds the project; `public/recipes/coin-spark-trail/card.{webm,jpg}` + `card.hash` are emitted by `tools/gen-previews` at build time.

---

## 16. Node Catalog (v1 set — schemas ship ports+defaults, eval-time, RNG class, structural split, Impact Tag, codegen, editor UI descriptor)

**Inputs** (`input.*`): `position`, `velocity`, `age`, `ageNormalized`, `life`, `time`, `frame`, `spawnIndex` (init-only), `emitterPosition`, `emitterVelocity`.
**Params** (`param.*`): `ref` (reads a knob; structural = which knob).
**Generators** (`gen.*`): `random` (stable), `randomRange` (stable), `randomVec2` (stable), `frameRandom` (per-frame), `curveOverLife` (structural ease), `colorOverLife`, `scaleOverLife`, `noise` (impact **medium**), `curl` (M2, impact **high**).
**Math** (`math.*`): `add`, `sub`, `mul`, `div` (guarded), `mad`, `mix`, `clamp`, `min`, `max`, `sin`, `cos`, `abs`, `length`, `normalize` (guarded), `rotate2d`, `splat`, `swizzle`, `makeVec2/4`, `component`. — `expression` is **M2** (scalar-only, whitelisted fns, parsed to AST and compiled — never string-spliced).
**Fields** (`field.*`): `gravity`, `directional` (strength+angle — the wind), `radial` (attract/repel), `drag` (exponential, §13.6), `vortex` (M2), `curlField` (M2, impact **high**), `drawnVectorField` (M2, texture-sampled, impact **high** on T1).
**Spawn shapes** (`shape.*`, feed `output.spawnPosition`, emitter-relative): `point`, `circle`/`torus`, `rectangle`, `polygonalChain`, `burstRing`, `drawnArea` (M2, SDF).
**Outputs** (`output.*`): `spawnPosition` (required, single), `initVelocity`, `initLife` (required, single), `addForce` (accumulating), `drag` (accumulating), `setVelocity` (single, excludes addForce), `writePosition` (escape hatch), `writeColor`, `writeAlpha` (post-color lane mask), `writeScale`, `writeRotation`, `initTexIndex`, `killIf` (bool, additive OR), `killIfOutOfRect` (reference engine's `deathZone`), `reflectInRect` (reference `collide`). **End-of-life kill is automatic scaffolding — there is no `killIfAgeOverLife` node.**
**Texture** (`tex.*`, render-side config): `single`, `random` (via `initTexIndex`, v1); `ordered`, `animated` (M2).

---

## 17. Editor Requirements (`@pylinka/editor`, M1.5)

Design system: zvuk shadcn/Tailwind-v4, dark default, violet accent.

### 17.1 Layout (fixed — do not invent)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TopBar: [Project name ▾] [System tabs: embers | sparks | +] ······       │
│         [▶︎/⏸] [↺ restart] [alive 3 412 / 8 192 · 0.41 ms] [● Recompiling…]│
├──────────┬─────────────────────────────────────────────┬─────────────────┤
│ Palette  │            Graph canvas (React Flow)        │  Right panel    │
│ 240px    │                                             │  360px          │
│ search   │                                             │ ┌─────────────┐ │
│ ▸ gen    │                                             │ │  Preview    │ │
│ ▸ math   │                                             │ │  (pixi)     │ │
│ ▸ field  │                                             │ │  ~40% h     │ │
│ ▸ shape  │                                             │ ├─────────────┤ │
│ ▸ output │                                             │ │ Tabs:       │ │
│ ▸ input  │                                             │ │ Inspector / │ │
│          │                                             │ │ Knobs /     │ │
│          │                                             │ │ Assets      │ │
└──────────┴─────────────────────────────────────────────┴─────────────────┘
```

- **TopBar:** project name (inline rename; ▾ menu: New / Open / Fork / Export JSON / Import); system tabs (double-click rename, `+` adds a system seeded with the default well-formed graph); play/pause + restart; live stats (`aliveCount / capacity · gpuMs`); compile status chip (hidden when idle, `Recompiling…` amber pulse, `Error` red — click scrolls to first offending node).
- **Palette:** search + collapsible namespace groups; click or drag to add; impact dot on `high` entries (tooltip = impactNote).
- **Preview:** pixi Application running the real runtime. Dark checkerboard. **Emitter gizmo:** draggable crosshair → `setEmitterPosition`. **Orbit toggle** (`⟳`): moves the emitter on a 200 px-radius circle at adjustable px/s — the built-in trail eyeball test. During recompile: particles hidden + "Recompiling…" overlay; on error: overlay lists diagnostics.
- **Inspector tab:** selected node → structural dropdowns + inline value inputs for unconnected ports; selected edge → delete; no selection → System settings (capacity, blendMode, emitter) + Project params overview.
- **Knobs tab:** ParamDefs grouped by `group`; row = name, slider, value input, unit, reset. Log sliders: `value = min·(max/min)^t`; linear: `min + (max−min)·t`. Knob edits write through the KnobBus live AND update `ParamDef.default` on commit (pointer-up).
- **Assets tab:** grid (name, dims, editable `pixiAssetKey`); import via file-drop anywhere or button.

### 17.2 Nodes on canvas

- Custom React Flow node per schema: header (label + namespace tint), input handles left, outputs right. Handle colors: `f32` zinc, `vec2` sky, `vec4/color` violet (swatch), `bool` amber.
- **Unconnected input ports render inline mini-inputs** (Blender-style): drag to scrub (fine w/ `Shift`, snap w/ `Ctrl`), click to type, color swatch opens picker with alpha. Scrubbing writes the value slot through the UniformBus **live**; document commit on pointer-up (one undo entry per gesture).
- Right-click a mini-input → **Promote to knob…** (dialog: name/min/max/scale/group → ParamDef + knobBinding; zero recompile), **Reset to default**, **Disconnect**.
- Node right-click: Duplicate / Delete / Disconnect all.
- `isValidConnection` runs the coercion table (§12.3); invalid targets dim while dragging.
- Diagnostics render as node badges (red error / amber warning, tooltip = message); editing is never blocked — compile just doesn't run until errors clear.

### 17.3 Editing semantics

| Action | Effect |
|---|---|
| Scrub/type a value or knob | UniformBus write, live; doc patch on commit; **no recompile** |
| Promote/demote knob | Doc patch; **no recompile** (slot exists) |
| Add/remove node/edge, structural dropdown, codegen-affecting system setting | Doc patch + recompile pipeline |
| Capacity/blendMode change | Pool/pipeline rebuild (same path as recompile) |

**Recompile pipeline:** structural change → debounce 200 ms → `validateGraph`; errors → badges, stop → else `compile()` in a **Web Worker** (plain postMessage `{id, bundle} → {id, compiled | diagnostics}`) → `system.recompile(compiled)` (pool resets) → chip clears. Newer edits cancel in-flight compiles by id.

### 17.4 State architecture (zustand, 3 stores)

- **`projectStore`** — the document + undo. All mutations via `apply(command)` producing immer patches; undo stack = inverse patches, **cap 100**, scrub gestures coalesce. Autosave debounce 800 ms → `ProjectRepository.save`.
- **`sessionStore`** — selection, active system, palette search, panel tab, compile status, diagnostics.
- **`runtimeStore`** — non-reactive refs to pixi app + PylinkaRuntime + stats snapshot (4 Hz for TopBar; never per-frame through React).

React Flow is **controlled** from projectStore-derived nodes/edges (memoized selectors); `nodeTypes` module-scope. Node positions live in `editor.nodePositions` and bypass undo (position drags not undoable — deliberate).

### 17.5 Shortcuts

`Ctrl/Cmd+Z` undo · `Ctrl/Cmd+Shift+Z` redo · `Del` delete selection · `Ctrl/Cmd+D` duplicate · `Ctrl/Cmd+S` force-save · `Space+drag` pan · `Ctrl/Cmd+K` palette search · `F` fit view · `1..9` system tabs.

### 17.6 Routes & flows (site, M1-beta)

`/editor` → project list + New · `/editor?id=<uuid>` → open · `/editor?recipe=<slug>` → fork shipped recipe → redirect to `?id=<new>` · Export = `serializeProject({inlineAssets:true})` download · Import = file-drop on list.

### 17.7 First-run

New system seeds the **default well-formed graph**: `shape.point → output.spawnPosition`, `gen.randomRange(0.8..1.2) → output.initLife`, `gen.randomVec2 → output.initVelocity`, `gen.colorOverLife(white→transparent) → output.writeColor` — compiles and shows particles immediately. Never present a dead empty canvas.

---

## 18. Execution Plan

### 18.1 M1.0 — Spike (BLOCKING; `/spike`, hand-written WGSL from §13 templates)

- [ ] **S1** Standalone WebGPU page: 1M pool, hand-written emit/update (gravity + wind knob + colorOverLife hardcoded), render per §13.8. Timestamp-query measurements.
- [ ] **S2** Same sim inside a **pixi v8 WebGPU** scene: shared `renderer.gpu.device`, sprites above AND below the particles to prove z-interleaving. Resolve the view-transform hookup; document the contract in `docs/SPIKE-RESULTS.md`.
- [ ] **S3** Moving-emitter trail demo (orbit 600 px/s, rate 200 + rateOverDistance 0.8): visually continuous ring per §14.5.
- [ ] **S4** Tier runs: T4 desktop (1M@60, update ≤ ~2 ms), T2 real phone (250k@60). Record numbers.
- [ ] **S5** Zero-alloc check on the frame loop (Chrome allocation profiler, 600 frames).
- [ ] **S6** Color packing decision: `vec4<f32>` vs packed u32 — measure both at 1M, decide, record.
- [ ] **S7** PRNG sanity across two GPUs (same seeds → same u32 streams; note float trajectory drift).
- [ ] **S8** WebGL2 probe (½ day cap): TF ping-pong sim, 50k particles, drawn inside a pixi **WebGL** scene as an instanced mesh. Feasible? Approach + blockers.
- [ ] **S9** Write `docs/SPIKE-RESULTS.md` (numbers + decisions; template corrections fold back into §13 in the same PR). Delete `/spike`.

**Gate:** if S2 or S4-T2 fails badly, STOP and escalate via QUESTIONS.md — do not proceed to M1.1 on a broken premise.

### 18.2 M1-alpha task tables

**M1.1 — `@pylinka/graph`**
- [x] **G1** `types.ts` verbatim from §11.1–11.2.
- [x] **G2** Catalog registry + all §16 v1 schemas WITHOUT codegen (ports/defaults/structural/impact).
- [x] **G3** `validate.ts` — full §12.3 taxonomy; unit test per code (valid + invalid fixture each).
- [x] **G4** `hash.ts` — §12.1 exactly; tests: value-edit invariance, edge/structural sensitivity, dead-node invariance, key-order stability.
- [x] **G5** `slots.ts` — §12.2; test against the golden slot table (§14.2).

**M1.2 — `@pylinka/compiler`**
- [x] **C1** Live-pruning, eval-time inference (incl. V007/V008), deterministic topo sort.
- [x] **C2** `CodegenCtx` (WGSL): temps, valueSlot/knobSlot, stable/frame random indices, safe helpers, `line`.
- [x] **C3** Scaffold assembly from §13.5–13.6 (string templates in `scaffold/`, one source of truth).
- [x] **C4** Codegen for every G2 node; ease catalog §13.9.
- [x] **C5** Golden test: coin-spark-trail → byte-compare emit/update/UniformLayout vs `test/golden/` (seeded from §14). Plus per-node snippet goldens.
- [x] **C6** Determinism test (run twice, byte-equal) + error paths (each V-code surfaces).

**M1.3 — `@pylinka/core`**
- [ ] **R1** `BackendProvider` (webgpu only): device from pixi renderer or explicit; `timestamp-query` detection.
- [ ] **R2** `Pool` (§13.2 buffers/init), `UniformBus` (§13.3, two writeBuffer/frame), `PipelineCache` keyed (device, backend, hash).
- [ ] **R3** `SpawnScheduler` §13.7 incl. modes, spawnBurst, restart, prewarm, fixed-step.
- [ ] **R4** `ParticleSystemView`: pixi container facade, frame sequence §13.11, follow/unfollow, stats readback (30-frame cadence), recompile (pool reset), destroy.
- [ ] **R5** `PylinkaRuntime` + project KnobBus fan-out; `TextureResolver` (pixiAssetKey override → blob decode fallback).
- [ ] **R6** Device-loss recovery (§7.6) + test via `device.destroy()`.
- [ ] **R7** Allocation test (600-frame window, zero pylinka-path allocations) in CI; bench harness + `baseline.json` (local).
- [ ] **R8** Integration smoke: compile coin-spark-trail with the real compiler, run 120 frames headless, assert aliveCount in expected band, no errors.

**M1.4 — `@pylinka/format`**
- [x] **F1** parse/serialize per §11.6 (inline↔blob transform), validation to Diagnostics.
- [x] **F2** Migration chains (document + catalog aliasing); unknown-kind preservation (E201) tested.

**M1.5 — `@pylinka/editor`**
- [ ] **E1** Stores + command/undo core (immer patches, cap 100, gesture coalescing).
- [ ] **E2** IndexedDB `ProjectRepository`/`AssetStore` per §11.8.
- [ ] **E3** Canvas: React Flow controlled setup, custom nodes w/ typed handles + inline mini-inputs, connection validation, diagnostic badges.
- [ ] **E4** Right panel: Preview (runtime + gizmo + orbit + overlays), Inspector, Knobs, Assets.
- [ ] **E5** Compile worker + debounce + status chip; promote-to-knob dialog.
- [ ] **E6** TopBar: system tabs, play/restart, stats, project menu; default graph on new system (§17.7); shortcuts (§17.5).
- [ ] **E7** E2E happy path (Playwright): new project → add wind field → scrub value (no recompile) → promote to knob → move knob → add node (recompile overlay) → reload → state restored.

### 18.3 M1-beta / M2 / M3

- **M1-beta:** `apps/site` (Astro + shadcn dark, `/editor` route, gallery, open-in-editor fork) + `tools/gen-previews` (offline frame-stepped webm+poster, idempotent by hash, build-time). Launches with hand-captured previews if needed. Task tables written when M1-alpha ships.
- **M2:** **WebGL2 TF backend** (GLSL ES 3.00 codegen from the same IR, cursor-window spawning §13.12, pixi-WebGL-context integration — the T1 ship requirement), field nodes (vortex/curl/radial/drawn), drawn spawn areas, `space:'local'`, stream compaction (if profiling justifies), `tex.ordered/animated`, `math.expression` (with grammar spec), optional CPU reference interpreter (post-spike decision).
- **M3:** rich undo history UI, large recipe library, docs, npm publish via OIDC trusted publishing, sorting investigation, sub-emitter/death-event exploration, possible cloud repo.

### 18.4 Definition of Done (every task)

Typecheck + lint clean · unit tests for the task's surface · goldens updated deliberately if touched · no new deps (or QUESTIONS.md entry) · hot-path rule respected (core) · checkbox ticked in §18 in the same commit.

---

## 19. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Host-renderer mismatch**: studio games run pixi WebGL; a WebGPU-only lib can't interleave with their scenes | **Critical (risk #0)** | Dual backend is core architecture: backend follows host renderer; WebGL2 probe in the spike (S8); T1 budget defined. v1 (WebGPU-only) honestly scoped to WebGPU-renderer hosts + the editor until M2. |
| pixi v8 WebGPU exposes no public compute API; device sharing + drawing from compute-written buffers may be awkward | High | Spike S2 dedicated to it; `STORAGE\|VERTEX` instance buffers sidestep the worst constraints; standalone fallback exists for the editor. |
| WebGL2 TF semantics diverge (no atomics → cursor-window spawning) | Medium | Documented approximation on the fallback tier; capacity headroom; differential tests vs WebGPU on shared recipes. |
| Compiler correctness | Medium | Pure functions, golden tests, small starter catalog, optional differential CPU interpreter. |
| Cross-GPU float divergence vs "determinism" expectations | Medium | Claims pre-scoped (§2.1.7): same-device + fixed-step only. |
| Free-list atomic contention at high spawn rates | Low/Med | Bounded spawn/frame; measured in spike; compaction as M2 alternative. |
| Headless preview flakiness in CI | Low | Offline frame-stepped rendering (no realtime requirement); regen-by-hash; poster fallback. |

## 20. Open questions (only these — everything else is decided)

1. **Color storage** — `vec4<f32>` vs packed `rgba8unorm u32`: spike S6 decides (the templates assume packed; S6 may amend them).
2. **CPU reference interpreter** — build for differential testing, or rely on headless GPU backends? Decide after the spike.
3. **`RECIPE_GROUPS`** — confirm `trails/fire/magic/ambient/ui/abstract`.
4. **Pixi view-transform hookup** for the render pass — spike S2 deliverable.
5. **WebGL2 mesh/attribute contract** for TF output buffers — early-M2 spike, informed by S8.

---

*End of REQUIREMENTS.md v1.0 — the complete, self-contained requirement. Hand this file (plus repo access) to the implementer; nothing else is needed.*
