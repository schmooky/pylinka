# @pylinka/core

Runtime of [Pylinka](https://pylinka.schmooky.dev) — a GPU-driven, node-based particle system
for PixiJS, built for slot games on real phones.

Design an effect in the [node editor](https://pylinka.schmooky.dev/editor) (or start from one of
60+ recipes), export the project JSON, and play it back in your game:

```ts
import { createParticles } from '@pylinka/core/webgl';

const fx = createParticles(canvas, project); // WebGL2 transform-feedback, GPU-simulated
fx.setEmitter(x, y);
app.ticker.add(() => fx.update(1 / 60)); // or your own rAF loop
fx.setKnob('windPower', 40); // live uniform — no recompile
```

- **`@pylinka/core/webgl`** — shipping WebGL2 transform-feedback engine: GPU simulation +
  rendering, textured atlas sequences, emission masks, spline trajectories, vector fields.
- **`@pylinka/core`** — CPU scheduler, knob bus, and timing shared by all backends.
- **`@pylinka/core/pixi`** — render pipe for **pixi.js v8** scenes (peer dependency, optional).
- **WebGPU compute backend** — planned; the WGSL codegen already exists in
  [`@pylinka/compiler`](https://www.npmjs.com/package/@pylinka/compiler).

```bash
npm i @pylinka/core
```

Docs, node editor, and the recipe gallery: **https://pylinka.schmooky.dev**

MIT © pylinka contributors
