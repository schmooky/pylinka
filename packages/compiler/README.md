# @pylinka/compiler

The compiler of [Pylinka](https://pylinka.schmooky.dev), a GPU-driven node-based particle system
for PixiJS.

It takes a validated node graph, a `SystemBundle` from
[`@pylinka/graph`](https://www.npmjs.com/package/@pylinka/graph), lowers it to a backend-neutral
IR, and emits a GPU program. No runtime dependencies. The output is locked against golden files in
the test suite, so the same graph always produces the same shader bytes.

There are two targets. `compile(bundle, catalog, 'webgpu')` emits the WGSL compute kernels that
`@pylinka/core/webgpu` dispatches. `compile(bundle, catalog, 'webgl2')` emits one fused
transform-feedback step shader, spawn and update in a single pass using the cursor-window scheme,
run by `@pylinka/core/webgl2`. Its interleaved state layout ships alongside as `WEBGL2_LAYOUT`.

Knobs and inline values become live uniforms in a single vec4 slot table, so changing a value at
runtime never triggers a recompile. Only structural edits do, and those reset the pool. The
generated code is built from your graph, which has a pleasant consequence: a graph without a
collider contains no collision instructions at all.

```bash
npm i @pylinka/compiler
```

You usually never call this yourself. `createCompiledParticles()` and `createPylinka()` in
`@pylinka/core` compile projects for you.

Docs, the node editor and 69 recorded effects: **https://pylinka.schmooky.dev**

MIT © pylinka contributors
