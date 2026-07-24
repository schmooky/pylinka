/**
 * pylinka × pixi — announcer / modal, done the scene-graph way.
 *
 * The point of this demo is LAYERING. Three static containers stack on the
 * stage: the background scene, a dimming layer, and the announcer card. Two
 * particle systems live INSIDE the announcer container — a star burst behind
 * the card and confetti in front of the text — so they render at exactly their
 * place in the scene graph, above the dim and interleaved with pixi Graphics /
 * Text. That "just works" because the pylinka render pipe respects z-order and
 * never leaks GL state onto sibling containers.
 */
import { Application, Assets, Container, Graphics, Text, type Texture } from 'pixi.js';
import { registerPylinka, createPylinka } from '@pylinka/core/pixi';
import type { TextureInput } from '@pylinka/core/pixi';
import { emitter, project } from '../../_shared/scene';
import { createPreloader } from '../../_shared/preloader';

registerPylinka();

const app = new Application();
await app.init({ background: '#0b0f1a', resizeTo: window, antialias: true });
document.body.appendChild(app.canvas);

// ── 1 · preload textures + the Fira Code face used by the card ───────────────
const TEX = {
  ambient: '/vfx/opaque/magic_01.png',
  confetti: '/vfx/opaque/spark_01.png',
  star: '/vfx/opaque/star_01.png',
};
const pre = createPreloader('best-practices demo');
const urls = Object.values(TEX);
const img: Record<string, TextureInput['image']> = {};
let n = 0;
for (const url of urls) { img[url] = (await Assets.load(url)) as Texture; pre.tick(url, ++n, urls.length); }
await document.fonts.load("600 44px 'Fira Code'").catch(() => {});

// ── 2 · one project: ambient backdrop + two on-demand announcer systems ──────
const single = { cols: 1, rows: 1, fps: 1, play: 'loop', pick: 'per-particle' } as const;
const proj = project('announcer', [
  emitter('ambient', 'a', {
    blend: 'add', capacity: 1400, rate: 55, shape: 'rect', size: [1800, 1100],
    velMin: [-14, -34], velMax: [14, -10], lifeMin: 2, lifeMax: 3.6,
    colorFrom: '#8aa0ffff', colorTo: '#3a1f9900', colorEase: 'sine.inOut', scaleFrom: 1.6, scaleTo: 0.7,
  }),
  emitter('confetti', 'b', {
    blend: 'add', capacity: 900, rate: 0, // rate 0 → only emits on spawnBurst()
    velMin: [-260, -120], velMax: [260, 40], lifeMin: 1.2, lifeMax: 2.2, gravity: [0, 520], drag: 0.2,
    colorFrom: '#ffe6a8ff', colorTo: '#ff5a0000', colorEase: 'sine.in', scaleFrom: 1.5, scaleTo: 0.5,
  }),
  emitter('starPop', 'c', {
    blend: 'add', capacity: 500, rate: 0, shape: 'circle', radius: 8,
    velMin: [-320, -320], velMax: [320, 320], lifeMin: 0.7, lifeMax: 1.4, drag: 0.6,
    colorFrom: '#fff4c0ff', colorTo: '#ffb02a00', colorEase: 'sine.in', scaleFrom: 2.8, scaleTo: 0.6,
  }),
]);
const fx = await createPylinka(proj, {
  renderer: app.renderer,
  textures: {
    ambient: { image: img[TEX.ambient]!, ...single },
    confetti: { image: img[TEX.confetti]!, ...single },
    starPop: { image: img[TEX.star]!, ...single },
  },
});

// ── 3 · build the layered scene graph ────────────────────────────────────────
// background: ambient particles behind everything
const bgLayer = new Container();
bgLayer.addChild(fx.systems.ambient!.view);

// dim: a full-screen black rectangle we fade in over the background
const dim = new Graphics();
const dimLayer = new Container();
dimLayer.addChild(dim);
dimLayer.alpha = 0;
dimLayer.visible = false;

// announcer card: starPop (behind) · card + text · confetti (in front)
const card = new Graphics();
const title = new Text({ text: 'LEVEL UP', style: { fontFamily: 'Fira Code', fontSize: 44, fontWeight: '600', fill: 0xffffff, align: 'center' } });
const subtitle = new Text({ text: 'particles above the dim, layered by the scene graph', style: { fontFamily: 'Fira Code', fontSize: 13, fill: 0x9fb0d0, align: 'center' } });
title.anchor.set(0.5);
subtitle.anchor.set(0.5);
const announceLayer = new Container();
announceLayer.addChild(fx.systems.starPop!.view, card, title, subtitle, fx.systems.confetti!.view);
announceLayer.visible = false;

// stack order on the stage: background → dim → announcer
app.stage.addChild(bgLayer, dimLayer, announceLayer);

// ── 4 · layout (also on resize) ──────────────────────────────────────────────
const CARD_W = 460;
const CARD_H = 190;
function place() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cx = w / 2;
  const cy = h / 2;
  dim.clear().rect(0, 0, w, h).fill({ color: 0x05070d, alpha: 1 });
  card.clear().roundRect(cx - CARD_W / 2, cy - CARD_H / 2, CARD_W, CARD_H, 18)
    .fill({ color: 0x131a2b, alpha: 0.96 }).stroke({ color: 0xfbbf24, width: 1.5, alpha: 0.7 });
  title.position.set(cx, cy - 24);
  subtitle.position.set(cx, cy + 34);
  fx.systems.ambient!.setEmitterPosition(cx, cy);
  fx.systems.confetti!.setEmitterPosition(cx, cy - 150); // rain down over the card
  fx.systems.starPop!.setEmitterPosition(cx, cy - 6); // burst from behind the card
}
place();
window.addEventListener('resize', place);

// ── 5 · open / close with a simple alpha tween + confetti shower ─────────────
let open = false;
let dimTarget = 0;
let shower = 0;

function announce() {
  open = true;
  dimTarget = 0.62;
  dimLayer.visible = true;
  announceLayer.visible = true;
  fx.systems.starPop!.spawnBurst(70); // one big pop
  fx.systems.confetti!.spawnBurst(120);
}
function dismiss() {
  open = false;
  dimTarget = 0;
}

document.getElementById('go')!.addEventListener('click', announce);
// click the dim (but not the card) to dismiss
dim.eventMode = 'static';
dim.on('pointertap', dismiss);

// ── 6 · one ticker: tween the dim, drip confetti while open, drive the sim ───
app.ticker.add((t) => {
  const dt = t.deltaMS / 1000;
  dimLayer.alpha += (dimTarget - dimLayer.alpha) * Math.min(1, dt * 9);
  if (!open && dimLayer.alpha < 0.02) { dimLayer.visible = false; announceLayer.visible = false; }
  if (open) {
    shower += dt;
    while (shower > 0.12) { shower -= 0.12; fx.systems.confetti!.spawnBurst(9); }
  }
  fx.update(dt);
});

pre.done();
