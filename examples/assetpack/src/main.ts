/**
 * pylinka × pixi — loading textures through the AssetPack pipeline.
 *
 * Same effects as the plain Assets.load demo, but the textures come from a
 * build step: `.assetpack.js` turns `raw-assets/` into `public/` + a
 * `manifest.json`. We boot pixi's Assets from that manifest and load each
 * texture by its ALIAS (its filename), then hand them to pylinka by system
 * name. `predev` regenerates the manifest, so `pnpm dev` just works.
 */
import { Application, Assets, type Texture } from 'pixi.js';
import { registerPylinka, createPylinka } from '@pylinka/core/pixi';
import type { TextureInput } from '@pylinka/core/pixi';
import { SCENES, buildScenes, scenesTextures } from '../../_shared/vfx';
import { createPreloader } from '../../_shared/preloader';

registerPylinka();

const app = new Application();
await app.init({ background: '#0b0f1a', resizeTo: window, antialias: false });
document.body.appendChild(app.canvas);

// 1 — boot pixi Assets from the AssetPack-generated manifest.
const pre = createPreloader('AssetPack manifest');
const manifest = await (await fetch('/manifest.json')).json();
await Assets.init({ manifest, basePath: '/' });

// 2 — load each texture by its manifest ALIAS (the file's basename shortcut).
const loaded: Record<string, TextureInput['image']> = {};
let n = 0;
for (const s of SCENES) {
  const alias = s.url.split('/').pop()!; // e.g. "spark_01.png" — resolved via the manifest
  loaded[s.url] = (await Assets.load(alias)) as Texture;
  pre.tick(alias, ++n, SCENES.length);
}

// 3 — hand the textures to the systems (keyed by system name) and lay them out.
const fx = await createPylinka(buildScenes(), {
  renderer: app.renderer,
  textures: scenesTextures(loaded),
});

const labels = SCENES.map((s) => {
  app.stage.addChild(fx.systems[s.name]!.view);
  const el = document.createElement('div');
  el.className = 'cell-label';
  el.textContent = s.label;
  document.body.appendChild(el);
  return el;
});

const COLS = 4;
function layout() {
  const rows = Math.ceil(SCENES.length / COLS);
  const cw = window.innerWidth / COLS;
  const ch = window.innerHeight / rows;
  SCENES.forEach((s, i) => {
    const cx = (i % COLS) * cw + cw / 2;
    const cy = Math.floor(i / COLS) * ch + ch * 0.6;
    fx.systems[s.name]!.setEmitterPosition(cx, cy);
    labels[i]!.style.left = `${cx}px`;
    labels[i]!.style.top = `${Math.floor(i / COLS) * ch + ch - 20}px`;
  });
}
layout();
window.addEventListener('resize', layout);

app.ticker.add((t) => fx.update(t.deltaMS / 1000));
pre.done();
