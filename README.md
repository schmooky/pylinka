# Pylinka

A node-based particle system for [PixiJS](https://pixijs.com) that runs on the GPU. You wire a
graph, it compiles to WGSL or GLSL, and particle state stays in GPU memory for as long as the
effect plays. It was built for slot games running on phones, so the WebGL2 path gets the same
care as the WebGPU one.

**License:** MIT · **Site:** `pylinka.schmooky.dev`

[`REQUIREMENTS.md`](./REQUIREMENTS.md) is the normative spec. Where it disagrees with this file,
it wins.

## Install

```bash
npm i @pylinka/core        # runtime
npm i @pylinka/format      # load, save and migrate editor projects
```

Design an effect in the [editor](https://pylinka.schmooky.dev/editor), export the project JSON,
play it back with `createParticles`. The [core README](./packages/core/README.md) has the shortest
version of that loop.

## Packages

| Package | What it does |
| --- | --- |
| [`@pylinka/graph`](./packages/graph) | The shared kernel every other package speaks: graph types, the node catalog, validation, hashing, uniform slot assignment. No dependencies. |
| [`@pylinka/compiler`](./packages/compiler) | Turns a system into GPU code. WGSL for WebGPU, GLSL ES 3.00 for the WebGL2 transform-feedback path. Both are byte-locked against golden files. |
| [`@pylinka/format`](./packages/format) | Reads, writes and migrates the `pylinka` project format. |
| [`@pylinka/core`](./packages/core) | The runtime. `/pixi` mounts systems inside a pixi v8 scene, `/gpu` drives a bare canvas on whichever compiled backend is available, `/webgl` is the interpreted engine that carries emission masks, animated atlases and sub-emitters. `pixi.js@^8` is an optional peer. |
| [`apps/site`](./apps/site) | Docs, the node editor at `/editor`, 69 recorded effects at `/recipes`, and an interaction sandbox at `/interactive`. |
| [`tools/atlas-extract`](./tools/atlas-extract) · [`tools/gen-previews`](./tools/gen-previews) | Pull sprite sequences out of a Spine atlas · record the gallery previews. |

## Development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

One dev server hosts everything:

```bash
pnpm --filter @pylinka/site dev
# localhost:5212              docs
# localhost:5212/editor       node editor with live preview
# localhost:5212/recipes      effect gallery
# localhost:5212/interactive  cursor and collision sandbox
```

Needs Node 22 or newer and pnpm 9 or newer. `REQUIREMENTS.md` §4.4 lists the full toolchain.
