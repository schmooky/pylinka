# @pylinka/core

The runtime of [Pylinka](https://pylinka.schmooky.dev), a GPU-driven node-based particle system for
PixiJS, built for slot games running on phones.

Design an effect in the [node editor](https://pylinka.schmooky.dev/editor), or start from one of the
69 recipes, export the project JSON, and play it back in your game:

```ts
import { createCompiledParticles } from '@pylinka/core/gpu';

const fx = await createCompiledParticles(canvas, project); // WebGPU compute, else WebGL2
fx.setEmitter(x, y);
app.ticker.add(() => fx.update(1 / 60)); // or your own rAF loop
fx.setKnob('windPower', 40); // live uniform, no recompile
fx.setKnob('cursor', pointerX, pointerY); // vec2 knobs take a second component
```

To run it inside a **pixi.js v8** stage instead, the backend follows the host renderer. A WebGPU
renderer shares its device, a WebGL renderer shares its GL context, and the particles interleave
with the rest of your scene:

```ts
import { registerPylinka, createPylinka } from '@pylinka/core/pixi';

registerPylinka();
const app = new Application();
await app.init({ preference: 'webgpu' });
const fx = await createPylinka(project, { renderer: app.renderer });
app.stage.addChild(fx.systems['sparks'].view);
app.ticker.add((t) => fx.update(t.deltaMS / 1000));
```

## Entry points

`@pylinka/core/gpu` gives you `createCompiledParticles`, which runs your graph as generated GPU code
on the best backend available (`'auto'`, `'webgpu'` or `'webgl2'`). Start here.

`@pylinka/core/webgpu` and `@pylinka/core/webgl2` are those two backends on their own, if you want
to pin one. The first dispatches compute kernels, the second runs a fused transform-feedback step
shader.

`@pylinka/core/pixi` is the scene integration: `createPylinka`, the render pipe, `follow()`. Pixi is
an optional peer dependency.

`@pylinka/core/webgl` is the interpreted engine. It carries the editor extras that the compiled
backends do not have yet: textured atlas sequences, emission masks, sub-emitters and spline
trajectories.

The base `@pylinka/core` entry holds the CPU scheduler, the knob bus and the timing helpers that
every backend shares.

```bash
npm i @pylinka/core
```

Docs, the node editor and the recipe gallery: **https://pylinka.schmooky.dev**

MIT © pylinka contributors
