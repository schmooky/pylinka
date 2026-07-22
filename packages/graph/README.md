# @pylinka/graph

The shared kernel of [Pylinka](https://pylinka.schmooky.dev), a GPU-driven node-based particle
system for PixiJS.

Everything the editor, the compiler and the runtime have to agree on lives here, with no runtime
dependencies. That means the graph model itself (nodes, edges, systems, knobs), the node catalog
with its typed ports and defaults, the validator that checks a graph before anyone tries to compile
it, and the content hashing and uniform slot assignment that the compiler and runtime both depend
on.

The catalog is the interesting part. It covers spawn shapes, generators, math, force fields
including the `obstacle` body, and the output sinks, which is where the `collide` family for
floors, walls, boxes and discs sits.

```bash
npm i @pylinka/graph
```

You rarely install this on purpose. It arrives as a dependency of
[`@pylinka/compiler`](https://www.npmjs.com/package/@pylinka/compiler) and
[`@pylinka/core`](https://www.npmjs.com/package/@pylinka/core).

Docs, the node editor and 69 recorded effects: **https://pylinka.schmooky.dev**

MIT © pylinka contributors
