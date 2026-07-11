# @pylinka/graph

Shared kernel of [Pylinka](https://pylinka.schmooky.dev) — a GPU-driven, node-based particle
system for PixiJS.

This package holds everything the editor, compiler, and runtime agree on, with **zero runtime
dependencies**:

- **Graph types** — nodes, edges, systems, knobs.
- **Node catalog** — the full set of node schemas (emitters, forces, fields, masks, splines,
  render) with typed sockets and defaults.
- **Validation** — structural + type checking of a graph before compile.
- **Hashing & slot assignment** — stable content hashes and GPU slot layout shared by the
  compiler and runtime.

```bash
npm i @pylinka/graph
```

Most users don't consume this directly — it arrives as a dependency of
[`@pylinka/compiler`](https://www.npmjs.com/package/@pylinka/compiler) and
[`@pylinka/core`](https://www.npmjs.com/package/@pylinka/core).

Docs, node editor, and a 60+ effect recipe gallery: **https://pylinka.schmooky.dev**

MIT © pylinka contributors
