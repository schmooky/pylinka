# @pylinka/core

Runtime of [Pylinka](https://pylinka.schmooky.dev) — a GPU-driven, node-based particle system
for PixiJS, built for slot games on real phones.

Design an effect in the [node editor](https://pylinka.schmooky.dev/editor) (or start from one of
60+ recipes), export the project JSON, and play it back in your game:

```ts
import { createCompiledParticles } from '@pylinka/core/gpu';

const fx = await createCompiledParticles(canvas, project); // WebGPU compute, else WebGL2 TF
fx.setEmitter(x, y);
app.ticker.add(() => fx.update(1 / 60)); // or your own rAF loop
fx.setKnob('windPower', 40); // live uniform — no recompile
```

Or run it inside a **pixi.js v8** stage — the backend follows the host renderer (a WebGPU
renderer shares its device; a WebGL renderer shares its GL context):

```ts
import { registerPylinka, createPylinka } from '@pylinka/core/pixi';

registerPylinka();
const app = new Application();
await app.init({ preference: 'webgpu' });
const fx = await createPylinka(project, { renderer: app.renderer });
app.stage.addChild(fx.systems['sparks'].view);
app.ticker.add((t) => fx.update(t.deltaMS / 1000));
```

- **`@pylinka/core/gpu`** — `createCompiledParticles`: the graph as **generated GPU code**,
  best available backend (`'auto' | 'webgpu' | 'webgl2'`).
- **`@pylinka/core/webgpu`** — WebGPU compute backend: emit/update kernels + instanced draw.
- **`@pylinka/core/webgl2`** — compiled WebGL2 transform-feedback backend (fused step shader).
- **`@pylinka/core/pixi`** — pixi v8 integration: `createPylinka`, render pipe, `follow()`,
  scene interleaving (peer dependency, optional).
- **`@pylinka/core/webgl`** — interpreted WebGL2 engine with editor extras: textured atlas
  sequences, emission masks, sub-emitters, spline trajectories.
- **`@pylinka/core`** — CPU scheduler, knob bus, and timing shared by all backends.

```bash
npm i @pylinka/core
```

Docs, node editor, and the recipe gallery: **https://pylinka.schmooky.dev**

MIT © pylinka contributors
