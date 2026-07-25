/**
 * pylinka × pixi — loading textures with pixi's built-in Assets.load.
 *
 * A pylinka project describes the SIMULATION only — it carries no art. You load
 * the textures yourself (here, the plain `Assets.load` way) and hand them to the
 * matching systems by name. This demo lays out one system per Brackeys texture
 * so you can see opaque (additive), alpha (normal-blend) and animated flipbook
 * sprites all driven by the same runtime.
 */
import { Application, Assets, Graphics, type Texture } from 'pixi.js';
import { registerPylinka, createPylinka } from '@pylinka/core/pixi';
import type { TextureInput } from '@pylinka/core/pixi';
import { SCENES, buildScenes, scenesTextures } from '../../_shared/vfx';
import { createPreloader } from '../../_shared/preloader';

// Kept inside an async function (not top-level await): entry-level TLA can
// deadlock with pixi's internal dynamic-import chunks in a production build.
async function main() {
  registerPylinka(); // once, before app.init — installs the render pipe

  const app = new Application();
  // A non-black background (+ per-cell tiles below) so the OPAQUE textures read
  // as sprites sitting on a surface — additive glow over slate — not just light
  // on a void. Alpha textures composite normally over the same tiles.
  await app.init({ background: '#1b2436', resizeTo: window, antialias: false, preference: 'webgl' });
  document.body.appendChild(app.canvas);

  // tiles render behind every particle view (added first → lower z-order).
  const tiles = new Graphics();
  app.stage.addChild(tiles);

  // 1 — preload every texture the normal pixi way, updating the progress bar.
  const pre = createPreloader('Assets.load()');
  const loaded: Record<string, TextureInput['image']> = {};
  let n = 0;
  for (const s of SCENES) {
    loaded[s.url] = (await Assets.load(s.url)) as Texture;
    pre.tick(s.url, ++n, SCENES.length);
  }

  // 2 — one project (a system per scene) + the textures map keyed by system name.
  const fx = await createPylinka(buildScenes(), {
    renderer: app.renderer,
    textures: scenesTextures(loaded),
  });

  // 3 — each system.view is a plain pixi container. Add them all and drop a
  //     Fira Code caption under each cell.
  const labels = SCENES.map((s) => {
    app.stage.addChild(fx.systems[s.name]!.view);
    const el = document.createElement('div');
    el.className = 'cell-label';
    el.textContent = s.label;
    document.body.appendChild(el);
    return el;
  });

  // 4 — arrange the emitters into a responsive grid.
  const COLS = 4;
  const layout = () => {
    const rows = Math.ceil(SCENES.length / COLS);
    const cw = window.innerWidth / COLS;
    const ch = window.innerHeight / rows;
    tiles.clear();
    SCENES.forEach((s, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cx = col * cw + cw / 2;
      const cy = row * ch + ch * 0.6; // emit a touch below centre
      // a slate tile per cell — makes it obvious the particles sit on a surface
      tiles
        .roundRect(col * cw + 6, row * ch + 6, cw - 12, ch - 12, 12)
        .fill({ color: 0x28324a, alpha: 0.55 })
        .stroke({ color: 0xffffff, alpha: 0.06, width: 1 });
      fx.systems[s.name]!.setEmitterPosition(cx, cy);
      labels[i]!.style.left = `${cx}px`;
      labels[i]!.style.top = `${row * ch + ch - 20}px`;
    });
  };
  layout();
  window.addEventListener('resize', layout);

  // 5 — drive the sim once per frame.
  app.ticker.add((t) => fx.update(t.deltaMS / 1000));
  pre.done();
}

void main();
