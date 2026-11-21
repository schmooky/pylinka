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

## WebGL1

WebGL1 has no transform feedback, so neither WebGL backend can simulate there. When pixi runs
WebGL1 (`preferWebGLVersion: 1`, or a device without WebGL2), `createPylinka` uses a third backend
on its own: the simulation runs on the CPU and the particles are drawn with one instanced WebGL1
draw in pixi's context, so masks, filters and z-order still work. `createParticles` from
`@pylinka/core/webgl` falls back the same way, and `simulation: 'cpu'` forces it on any context so
you can see what a WebGL1 device will show.

The CPU path reads the interpreted node set (`INTERPRETED_KINDS` in `@pylinka/core/webgl`). Nodes
that only the compiled backends implement do nothing there, and `createPylinka` prints one
`console.warn` per system that uses them. Its cost is CPU time per particle; it draws only the
particles that are alive.

### WebGL1: downsides and caveats

- **Fewer nodes.** Compiled-only nodes are skipped (with a warning). Check an effect on WebGL1 with
  `simulation: 'cpu'` before shipping it to devices that may run it.
- **CPU cost.** Every particle is stepped in JavaScript on the main thread. As a rough guide, on a
  desktop CPU 10k particles with no forces step in about 0.15 ms per frame. Turbulence, point
  fields and colliders raise that to about 2 ms. A low-end phone is several times slower. Keep
  pools in the low thousands, and treat turbulence as the expensive node.
- **Not bit-identical to the GPU.** The CPU runs the same formulas in float64, and the GPU runs
  them in float32. An effect looks the same, but no single particle lands in exactly the same place.
- **Seeds.** Under `createPylinka`, each view draws its own random particles. Pass `seed` for a
  repeatable result. Standalone `createParticles` takes no seed and uses the GPU's unseeded hashes,
  so two effects that start on the same frame match.
- **Knobs.** Only `f32` and `vec2` knobs reach the CPU simulation. Other knob types print a warning
  and have no effect.
- **Stats.** `stats.aliveCount` is exact and free. `overflowCount` is always 0, and `gpuMs` is
  `null`.
- **Context loss.** Particle state lives on the CPU, so it survives a lost context, both under pixi
  and standalone. Only the GL objects are rebuilt.
- **Bundle size.** Under `@pylinka/core/pixi`, the WebGL1 backend is a separate chunk (about 12 KB
  gzipped). `createPylinka` loads it only when pixi runs WebGL1, so WebGPU and WebGL2 apps never
  fetch it. Standalone `@pylinka/core/webgl` has a synchronous `createParticles`, so the CPU path
  ships inside that entry, which costs about 4.9 KB gzipped more. A custom pipeline that calls
  `getSimBackendFactory('webgl1')` itself should `await ensureSimBackend('webgl1')` first.
- **Instancing required.** WebGL1 needs `ANGLE_instanced_arrays`, which every WebGL1 browser in use
  exposes. Without it, an effect under `createPylinka` warns once and simulates but draws nothing.
  Standalone `createParticles` throws.
- **Sub-emitters.** A child fires only on parent steps it has not seen yet. While its parent is
  hidden, a visible child stops emitting instead of repeating the last event. The GPU backends do
  not have this guard yet.

## When the GPU disappears

Phones take the GPU away: background the tab, reset the driver, let another page get greedy. Both
WebGL2 backends survive it. They pause while the context is gone, rebuild every GPU object when the
browser hands it back, and carry your knobs and emitter position across. The particles that were
alive do not come back, so the pool refills from the emitter.

```ts
const fx = await createCompiledParticles(canvas, project, {
  onContextLost: () => hud.showReconnecting(),
  onContextRestored: () => hud.hideReconnecting(),
});
```

On WebGPU the device is shared, and on the pixi path the renderer owns it, so a lost device is
reported through the same callback and left for you to replace.

```bash
npm i @pylinka/core
```

Docs, the node editor and the recipe gallery: **https://pylinka.schmooky.dev**

MIT © pylinka contributors
