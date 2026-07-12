# @pylinka/compiler

Compiler of [Pylinka](https://pylinka.schmooky.dev) — a GPU-driven, node-based particle system
for PixiJS.

Turns a validated node graph (`SystemBundle` from
[`@pylinka/graph`](https://www.npmjs.com/package/@pylinka/graph)) into a backend-neutral IR and
then into GPU programs. **Zero runtime dependencies**, and the codegen output is golden
byte-locked in tests — the same graph always produces the same shader bytes.

- **WGSL** target (`compile(bundle, catalog, 'webgpu')`) — the §13 compute kernels the
  `@pylinka/core/webgpu` backend dispatches.
- **GLSL ES 3.00** target (`compile(bundle, catalog, 'webgl2')`) — a fused transform-feedback
  step shader (spawn + update in one pass, cursor-window scheme) run by `@pylinka/core/webgl2`;
  the interleaved state layout ships as `WEBGL2_LAYOUT`.
- Knobs and inline values compile to **live uniforms** (one vec4 slot table) — tweaking a value
  at runtime never triggers a recompile; only structural edits do.

```bash
npm i @pylinka/compiler
```

Most users don't call the compiler directly — `@pylinka/core`'s `createCompiledParticles()` /
`createPylinka()` compile projects for you.

Docs, node editor, and a 60+ effect recipe gallery: **https://pylinka.schmooky.dev**

MIT © pylinka contributors
