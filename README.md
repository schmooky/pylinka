# Pylinka

> A GPU-driven, node-based particle system for [PixiJS](https://pixijs.com) — a Neutrino-style
> dataflow editor whose graph compiles to GPU programs, with everything live-tweakable, a recipe
> gallery, and a versionable project format. **WebGPU first, WebGL2 fallback, built for slot games
> on real phones.**

**License:** MIT · **Site:** `pylinka.schmooky.dev`

The complete, normative specification lives in [`REQUIREMENTS.md`](./REQUIREMENTS.md) — that file is
the single source of truth. This README is only a pointer.

## Packages

| Package | Description | Status |
| --- | --- | --- |
| [`@pylinka/graph`](./packages/graph) | Shared kernel: graph types, node catalog, validation, hashing, slot assignment. Zero deps. | **in progress (M1.1)** |
| [`@pylinka/compiler`](./packages/compiler) | SystemBundle → IR → GPU program codegen (WGSL M1, GLSL ES 3.00 M2). Zero deps. | **in progress (M1.2)** — golden green |
| [`@pylinka/core`](./packages/core) | Runtime. **`@pylinka/core/webgl` — a working WebGL2 transform-feedback engine** (`createParticles(canvas, project)`); CPU scheduler/knobs/timing; pixi-v8 render integration (`/pixi`). Peer `pixi.js@^8` (optional). | **usable (M1.3)** — WebGL2 runtime runs; WebGPU compute backend gated on the M1.0 spike |
| [`@pylinka/format`](./packages/format) | Serialize / parse / migrate the `pylinka` project format. | **shipped (M1.4)** |
| [`@pylinka/editor`](./packages/editor) | React Flow editor + IndexedDB persistence. | scaffold |

## Development

```bash
pnpm install
pnpm typecheck   # tsc across all packages
pnpm lint        # eslint 9 flat config
pnpm test        # vitest (unit + golden + allocation)
```

Requires Node ≥ 22 and pnpm ≥ 9. See `REQUIREMENTS.md §4.4` for the full toolchain and `§18` for the
execution plan.
