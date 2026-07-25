/**
 * pylinka × pixi — container features.
 *
 * Proof that a pylinka particle view is an ordinary pixi Container child: put
 * each emitter in its own Container and drive it with the SAME pixi APIs you'd
 * use on any sprite —
 *   • zIndex  — two systems in a sortable parent; swapping zIndex flips which
 *               colour renders in front.
 *   • mask    — a system whose container is masked by a circle Graphics, so its
 *               particles are clipped to that shape.
 *   • filters — a system whose container has [BlurFilter, ColorMatrixFilter];
 *               the particles are blurred and their hue rotates over time.
 * The last two also prove the render pipe draws into pixi's current render
 * target (a filter/mask renders the subtree to an off-screen texture first).
 */
import { Application, Container, Graphics, BlurFilter, ColorMatrixFilter, Rectangle } from 'pixi.js';
import { registerPylinka, createPylinka } from '@pylinka/core/pixi';
import { emitter, project } from '../../_shared/scene';
import { createPreloader } from '../../_shared/preloader';

async function main() {
  registerPylinka();

  const app = new Application();
  await app.init({ background: '#1b2436', resizeTo: window, antialias: true, preference: 'webgl' });
  document.body.appendChild(app.canvas);

  const pre = createPreloader('container features');

  // Four systems, no textures (soft-disc). zRed/zBlue use normal blend so the
  // front one OCCLUDES the back one (additive is order-independent); tight +
  // short-lived so each stays a compact blob in its own column.
  const cloud = (name: string, idp: string, color: string) =>
    emitter(name, idp, {
      blend: 'normal', capacity: 500, rate: 260, shape: 'circle', radius: 16,
      velMin: [-7, -7], velMax: [7, 7], lifeMin: 0.7, lifeMax: 1.1, drag: 0.6,
      colorFrom: color, colorTo: `${color.slice(0, 7)}00`, colorEase: 'sine.in', scaleFrom: 6, scaleTo: 4,
    });
  const proj = project('containers', [
    cloud('zRed', 'r', '#ff5a4bff'),
    cloud('zBlue', 'b', '#4b9bffff'),
    emitter('masked', 'm', {
      blend: 'add', capacity: 1400, rate: 900, shape: 'rect', size: [300, 360],
      velMin: [-8, -8], velMax: [8, 8], lifeMin: 1, lifeMax: 1.8, drag: 0.4,
      colorFrom: '#aee6ffff', colorTo: '#3a7bff00', colorEase: 'sine.inOut', scaleFrom: 2, scaleTo: 1.2,
    }),
    emitter('filtered', 'f', {
      blend: 'add', capacity: 700, rate: 260, shape: 'point',
      velMin: [-40, -175], velMax: [40, -110], lifeMin: 0.7, lifeMax: 1.2, gravity: [0, 260], drag: 0.1,
      colorFrom: '#ffd060ff', colorTo: '#ff5a0000', colorEase: 'sine.in', scaleFrom: 2.6, scaleTo: 1,
    }),
  ]);
  const fx = await createPylinka(proj, { renderer: app.renderer });

  // faint column panels behind everything (added first → lowest z)
  const panels = new Graphics();
  app.stage.addChild(panels);

  // ── column 1 · zIndex ── two views in one sortable container
  const zWrap = new Container();
  zWrap.sortableChildren = true;
  zWrap.addChild(fx.systems.zRed!.view, fx.systems.zBlue!.view);
  fx.systems.zRed!.view.zIndex = 2;
  fx.systems.zBlue!.view.zIndex = 1;

  // ── column 2 · mask ── the container is clipped to a circle
  const maskShape = new Graphics();
  const maskWrap = new Container();
  maskWrap.addChild(fx.systems.masked!.view);
  maskWrap.mask = maskShape;

  // ── column 3 · filters ── blur + animated hue on the container
  const blur = new BlurFilter({ strength: 4 });
  const hue = new ColorMatrixFilter();
  const filterWrap = new Container();
  filterWrap.addChild(fx.systems.filtered!.view);
  filterWrap.filters = [blur, hue];

  app.stage.addChild(zWrap, maskWrap, maskShape, filterWrap);

  const vZ = document.getElementById('v-z')!;
  const lZ = document.getElementById('l-z')!;
  const lM = document.getElementById('l-m')!;
  const lF = document.getElementById('l-f')!;

  let maskR = 120;
  const layout = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const colW = w / 3;
    const midY = h * 0.52;

    panels.clear();
    for (let i = 0; i < 3; i++) {
      panels.roundRect(i * colW + 10, 70, colW - 20, h - 130, 14)
        .fill({ color: 0x28324a, alpha: 0.5 }).stroke({ color: 0xffffff, alpha: 0.06, width: 1 });
    }

    // zIndex column — two clouds fully overlapping at the centre
    fx.systems.zRed!.setEmitterPosition(colW * 0.5, midY);
    fx.systems.zBlue!.setEmitterPosition(colW * 0.5, midY);
    // mask column — a circle in the middle
    const mx = colW * 1.5;
    maskR = Math.min(colW, h) * 0.26;
    fx.systems.masked!.setEmitterPosition(mx, midY);
    maskShape.clear().circle(mx, midY, maskR).fill(0xffffff);
    // filter column — a fountain from low-centre. A particle view keeps EMPTY
    // bounds (its particles live on the GPU, so the CPU can't measure them), so
    // we must tell the filtered container what area to capture — otherwise pixi
    // sizes the filter's off-screen texture to nothing and the particles fall
    // outside it. We use the whole stage so the capture starts at the origin
    // (pixi offsets a filter's contents by its bounds' top-left, which our GPU
    // draw doesn't apply); a sub-region starting away from 0,0 would shift.
    fx.systems.filtered!.setEmitterPosition(colW * 2.5, h * 0.72);
    filterWrap.boundsArea = new Rectangle(0, 0, w, h);

    for (const [el, cx] of [[lZ, colW * 0.5], [lM, colW * 1.5], [lF, colW * 2.5]] as const) {
      (el as HTMLElement).style.left = `${cx}px`;
      (el as HTMLElement).style.top = `${h - 54}px`;
    }
  };
  layout();
  window.addEventListener('resize', layout);

  let t = 0;
  let lastSwap = 0;
  let redFront = true;
  vZ.textContent = 'front: RED';
  app.ticker.add((tk) => {
    const dt = tk.deltaMS / 1000;
    t += dt;
    // animate the container filter — pure proof it processes the particle output
    hue.hue((t * 70) % 360, false);
    blur.strength = 3 + Math.sin(t * 1.5) * 2;
    // swap zIndex every 1.6s so the front colour flips
    if (t - lastSwap > 1.6) {
      lastSwap = t;
      redFront = !redFront;
      fx.systems.zRed!.view.zIndex = redFront ? 2 : 1;
      fx.systems.zBlue!.view.zIndex = redFront ? 1 : 2;
      vZ.textContent = `front: ${redFront ? 'RED' : 'BLUE'}`;
    }
    fx.update(dt);
  });
  pre.done();
}

void main();
