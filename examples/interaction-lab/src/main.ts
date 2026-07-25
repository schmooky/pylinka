/**
 * pylinka — Interaction Lab (standalone).
 *
 * A particle field you can shove around: a flying orb plows through it, the
 * cursor pushes it, and the heavier embers collide with real geometry (walls,
 * floor, a crate, and the orb itself). All on the interpreted WebGL2 backend
 * (`@pylinka/core/webgl`) — the obstacles read live vec2 knobs, so there's no
 * recompile and no graph edit per frame.
 */
import { createParticles, type ParticlesHandle } from '@pylinka/core/webgl';
import { buildProject, geometryFor, type SceneGeometry } from './scene';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true });
const hud = document.getElementById('hud')!;
const orbEl = document.getElementById('orb') as HTMLDivElement;
const crateEl = document.getElementById('crate') as HTMLDivElement;
const floorEl = document.getElementById('floor') as HTMLDivElement;

if (!gl) {
  hud.textContent = 'WebGL2 is not available in this browser.';
} else {
  // 1 world px == 1 device px, so geometry and pointer maths stay honest on
  // hidpi screens (see the CSS-px conversion in `css()` below).
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  type Handles = Record<'dust' | 'embers' | 'trail', ParticlesHandle>;
  let geo!: SceneGeometry;
  let handles: Handles | undefined;

  const toggles = {
    dust: document.getElementById('t-dust') as HTMLInputElement,
    orb: document.getElementById('t-orb') as HTMLInputElement,
    cursor: document.getElementById('t-cursor') as HTMLInputElement,
    embers: document.getElementById('t-embers') as HTMLInputElement,
  };
  const pushSlider = document.getElementById('s-push') as HTMLInputElement;
  const pushLabel = document.getElementById('v-push')!;
  let push = 1;
  pushSlider.addEventListener('input', () => {
    push = Number(pushSlider.value) / 100;
    pushLabel.textContent = `${pushSlider.value}%`;
  });

  function build() {
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    geo = geometryFor(canvas.width, canvas.height);
    const project = buildProject(geo);
    if (handles) for (const old of Object.values(handles)) old.destroy();
    const h: Handles = {
      dust: createParticles(gl!, project, { systemName: 'dust', sizeScale: dpr }),
      embers: createParticles(gl!, project, { systemName: 'embers', sizeScale: dpr * 1.4 }),
      trail: createParticles(gl!, project, { systemName: 'trail', sizeScale: dpr * 1.6 }),
    };
    // exactly one clear per frame — the driver picks the owner
    h.embers.autoClear = false;
    h.trail.autoClear = false;
    h.dust.setEmitter(geo.width / 2, geo.height / 2);
    h.embers.setEmitter(geo.width / 2, -20);
    handles = h;
    placeStatics();
  }

  /** device px → CSS px, for the DOM overlay */
  const css = (n: number) => n / dpr;

  function placeStatics() {
    const { crate, floorY, height } = geo;
    crateEl.style.cssText = `left:${css(crate.x)}px;top:${css(crate.y)}px;width:${css(crate.w)}px;height:${css(crate.h)}px;border:1px solid rgba(190,220,255,.28);border-radius:3px;background:linear-gradient(180deg,rgba(140,180,255,.10),rgba(140,180,255,.03));box-shadow:inset 0 0 30px rgba(120,170,255,.10)`;
    floorEl.style.cssText = `top:${css(floorY)}px;height:${css(height - floorY)}px;border-top:1px solid rgba(190,220,255,.3);background:linear-gradient(180deg,rgba(140,180,255,.10),transparent)`;
  }

  function placeOrb(x: number, y: number, visible: boolean) {
    const r = geo.orbRadius;
    orbEl.style.cssText =
      `left:${css(x - r)}px;top:${css(y - r)}px;width:${css(r * 2)}px;height:${css(r * 2)}px;` +
      `border-radius:9999px;opacity:${visible ? 1 : 0};transition:opacity .2s;` +
      'background:radial-gradient(circle at 38% 34%,#ffffff,#bfe4ff 32%,#3aa0ff 62%,rgba(20,60,140,.15) 78%,transparent 82%);' +
      'box-shadow:0 0 40px rgba(90,180,255,.55),0 0 120px rgba(60,140,255,.30)';
  }

  // ---- pointer --------------------------------------------------------------
  let px = -9999;
  let py = -9999;
  let pvx = 0;
  let pvy = 0;
  let lastPx = -9999;
  let lastPy = -9999;
  let pointerInside = false;
  const onMove = (e: PointerEvent) => {
    px = e.clientX * dpr;
    py = e.clientY * dpr;
    if (!pointerInside) {
      lastPx = px;
      lastPy = py;
      pointerInside = true;
    }
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerleave', () => { pointerInside = false; });

  // ---- the flying orb -------------------------------------------------------
  // A lissajous crossing, so it re-enters the field from a different angle every
  // pass instead of tracing one groove.
  let t = 0;
  const orbAt = (time: number): [number, number] => [
    geo.width * (0.5 + 0.42 * Math.sin(time * 0.41)),
    geo.height * (0.44 + 0.3 * Math.sin(time * 0.67 + 1.1)),
  ];

  build();
  window.addEventListener('resize', () => build());

  let frames = 0;
  let acc = 0;
  let fps = 0;
  let last = performance.now();

  function step(dt: number) {
    const fx = handles;
    if (!fx) return;
    t += dt;

    // orb: position from the path, velocity by finite difference (that's what
    // `carry` and the collider kick read)
    const [ox, oy] = orbAt(t);
    const [px2, py2] = orbAt(t + 1 / 60);
    const ovx = (px2 - ox) * 60;
    const ovy = (py2 - oy) * 60;
    const orbOn = toggles.orb.checked;
    placeOrb(ox, oy, orbOn);

    // pointer velocity, smoothed — raw per-frame deltas are far too spiky to
    // drive a force with
    const dx = px - lastPx;
    const dy = py - lastPy;
    pvx += ((dx / Math.max(dt, 1e-3)) - pvx) * 0.25;
    pvy += ((dy / Math.max(dt, 1e-3)) - pvy) * 0.25;
    lastPx = px;
    lastPy = py;

    const cursorOn = toggles.cursor.checked && pointerInside;
    for (const h of [fx.dust, fx.embers]) {
      h.setKnob('orb', orbOn ? ox : -99999, orbOn ? oy : -99999);
      h.setKnob('orbVel', ovx * push, ovy * push);
      h.setKnob('cursor', cursorOn ? px : -99999, cursorOn ? py : -99999);
      h.setKnob('cursorVel', pvx * push, pvy * push);
    }

    // whichever system draws first owns the clear
    const dustOn = toggles.dust.checked;
    fx.dust.autoClear = dustOn;
    fx.embers.autoClear = !dustOn;
    if (dustOn) fx.dust.update(dt);
    if (toggles.embers.checked) fx.embers.update(dt);
    if (orbOn) {
      fx.trail.setEmitter(ox, oy);
      fx.trail.update(dt);
    }

    frames++;
    acc += dt;
    if (acc >= 0.5) {
      fps = Math.round(frames / acc);
      frames = 0;
      acc = 0;
      const alive =
        fx.dust.aliveCount() +
        (toggles.embers.checked ? fx.embers.aliveCount() : 0) +
        (orbOn ? fx.trail.aliveCount() : 0);
      hud.textContent = `${fps} fps · ${alive.toLocaleString()} alive`;
    }
  }

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    step(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
