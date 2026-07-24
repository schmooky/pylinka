/**
 * pylinka × pixi — loading textures through the AssetPack pipeline.
 *
 * Same effects as the plain Assets.load demo, but the textures come from a
 * build step: `.assetpack.js` turns `raw-assets/` into `public/` + a
 * `manifest.json`. We READ that manifest to discover where AssetPack wrote each
 * file, then load it the normal pixi way and hand it to pylinka by system name.
 * `predev` regenerates the manifest, so `pnpm dev` just works.
 */
import { Application, Assets, type Texture } from 'pixi.js';
import { registerPylinka, createPylinka } from '@pylinka/core/pixi';
import type { TextureInput } from '@pylinka/core/pixi';
import { SCENES, buildScenes, scenesTextures } from '../../_shared/vfx';
import { createPreloader } from '../../_shared/preloader';

interface ManifestAsset { alias?: string | string[]; src?: string | string[] }
interface Manifest { bundles?: { assets?: ManifestAsset[] }[] }
const first = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);

// Wrapped in an async function (no entry-level top-level await): TLA in the
// entry can deadlock with pixi's dynamic-import chunks in a production build.
async function main() {
  registerPylinka();

  const app = new Application();
  await app.init({ background: '#0b0f1a', resizeTo: window, antialias: false, preference: 'webgl' });
  document.body.appendChild(app.canvas);

  // 1 — read the AssetPack manifest and index every asset by its basename, so
  //     we can find where AssetPack wrote each scene's texture.
  const pre = createPreloader('AssetPack manifest');
  const manifest: Manifest = await (await fetch('/manifest.json')).json();
  const srcByBase = new Map<string, string>();
  for (const b of manifest.bundles ?? []) {
    for (const a of b.assets ?? []) {
      const src = first(a.src);
      if (!src) continue;
      srcByBase.set(src.split('/').pop()!, src);
    }
  }

  // 2 — load each texture the normal pixi way, from the manifest-declared path.
  const loaded: Record<string, TextureInput['image']> = {};
  let n = 0;
  for (const s of SCENES) {
    const base = s.url.split('/').pop()!;
    const src = srcByBase.get(base) ?? s.url.replace(/^\//, '');
    loaded[s.url] = (await Assets.load(`/${src}`)) as Texture;
    pre.tick(base, ++n, SCENES.length);
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
  const layout = () => {
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
  };
  layout();
  window.addEventListener('resize', layout);

  app.ticker.add((t) => fx.update(t.deltaMS / 1000));
  pre.done();
}

void main();
