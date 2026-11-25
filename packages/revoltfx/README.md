# @pylinka/revoltfx

Play [RevoltFX](https://github.com/bma73/revolt-fx) effect bundles with Pylinka.

- `convertEffect(bundle, name, { sheet })` turns one RevoltFX emitter or
  sequence into a `PylinkaProject`. It returns the texture each system needs, a
  timeline (start delays, durations, RevoltFX's spawn clock, triggers) and a
  **fidelity report**: every setting that did not carry over exactly, marked
  `approximate` or `unsupported`, with the measured error where there is one.
- `createRevoltFxEffect(bundle, name, { renderer, sheet, image })` from
  `@pylinka/revoltfx/pixi` plays it through `createPylinka`. It crops the
  textures out of the spritesheet, runs the timeline, and calls `onTrigger`
  for sequence triggers.

```ts
import { registerPylinka } from '@pylinka/core/pixi';
import { createRevoltFxEffect } from '@pylinka/revoltfx/pixi';

registerPylinka();
await app.init({ preference: 'webgpu' });
const torch = await createRevoltFxEffect(bundle, 'side-torch', {
  renderer: app.renderer,
  sheet: await (await fetch('revoltfx-spritesheet.json')).json(),
  image: 'revoltfx-spritesheet.png',
});
app.stage.addChild(torch.view);
torch.x = 400;
torch.y = 300;
app.ticker.add((t) => torch.update(t.deltaMS / 1000));
console.table(torch.issues);
```

[MAPPING.md](./MAPPING.md) maps each RevoltFX setting to Pylinka, says how
faithful the mapping is, and lists what Pylinka cannot express yet. Converted
effects need WebGPU or WebGL2. The WebGL1 CPU backend does not run these graphs.

The test fixtures are the official RevoltFX example bundle and spritesheet
(bma73/revolt-fx-examples, MIT, see `test/fixtures/LICENSE-revolt-fx-examples.md`).
