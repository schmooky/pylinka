# @pylinka/compiler

Compiler of [Pylinka](https://pylinka.schmooky.dev) — a GPU-driven, node-based particle system
for PixiJS.

Turns a validated node graph (`SystemBundle` from
[`@pylinka/graph`](https://www.npmjs.com/package/@pylinka/graph)) into a backend-neutral IR and
then into GPU programs. **Zero runtime dependencies**, and the codegen output is golden
byte-locked in tests — the same graph always produces the same shader bytes.

- **WGSL** codegen for the (planned) WebGPU compute backend.
- **GLSL ES 3.00** codegen for the shipping WebGL2 transform-feedback engine in
  [`@pylinka/core`](https://www.npmjs.com/package/@pylinka/core).
- Knobs compile to **live uniforms** — tweaking a value at runtime never triggers a recompile.

```bash
npm i @pylinka/compiler
```

Most users don't call the compiler directly — `@pylinka/core`'s `createParticles()` compiles
projects for you.

Docs, node editor, and a 60+ effect recipe gallery: **https://pylinka.schmooky.dev**

MIT © pylinka contributors
