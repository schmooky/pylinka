# Pylinka

> A GPU-driven, node-based particle system for [PixiJS](https://pixijs.com) — a Neutrino-style
> dataflow editor whose graph compiles to GPU programs, with everything live-tweakable, a recipe
> gallery, and a versionable project format. **WebGPU first, WebGL2 fallback, built for slot games
> on real phones.**

**License:** MIT · **Site:** `pylinka.schmooky.dev`

The complete, normative specification lives in [`REQUIREMENTS.md`](./REQUIREMENTS.md) — that file is
the single source of truth. This README is only a pointer.

## Install

```bash
npm i @pylinka/core        # runtime — createParticles(canvas, project)
npm i @pylinka/format      # load/save/migrate editor-exported projects
```

Design an effect in the [editor](https://pylinka.schmooky.dev/editor), export the project JSON,
and play it back with `createParticles` — see [`packages/core`](./packages/core/README.md).

## Packages

| Package | Description | Status |
| --- | --- | --- |
| [`@pylinka/graph`](./packages/graph) | Shared kernel: graph types, node catalog, validation, hashing, slot assignment. Zero deps. | ✅ shipped |
| [`@pylinka/compiler`](./packages/compiler) | SystemBundle → IR → GPU program codegen (WGSL; GLSL ES 3.00 is M2). Zero deps. Golden byte-locked. | ✅ shipped |
| [`@pylinka/format`](./packages/format) | Serialize / parse / migrate the `pylinka` project format. | ✅ shipped |
| [`@pylinka/core`](./packages/core) | Runtime. **Compiled backends** — `/gpu` (`createCompiledParticles`, auto), `/webgpu` (compute kernels), `/webgl2` (fused TF step shader); **pixi-v8 integration** — `/pixi` (`createPylinka`, render pipe, device/context sharing); `/webgl` interpreted engine (masks, atlas sequences, sub-emitters); CPU scheduler/knobs/timing. Peer `pixi.js@^8` (optional). | ✅ WebGPU compute + compiled WebGL2 + pixi pipe all run |
| [`apps/site`](./apps/site) | Docs + **`/editor`** (React Flow node editor with live preview) + **`/recipes`** (44-effect webm gallery). | ✅ shipped |
| [`tools/atlas-extract`](./tools/atlas-extract) · [`tools/gen-previews`](./tools/gen-previews) | Extract sprite sequences from a Spine atlas · record recipe webm/poster previews. | ✅ shipped |

## Development

```bash
pnpm install
pnpm typecheck   # tsc across all packages
pnpm lint        # eslint 9 flat config
pnpm test        # vitest (unit + golden + allocation)
```

Try it — one dev server hosts everything:

```bash
pnpm --filter @pylinka/site dev
# → localhost:5212         docs
#   localhost:5212/editor   node editor + live preview
#   localhost:5212/recipes  effect gallery
```

Requires Node ≥ 22 and pnpm ≥ 9. See `REQUIREMENTS.md §4.4` for the full toolchain and `§18` for the
execution plan.
