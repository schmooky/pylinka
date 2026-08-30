/**
 * The preview's pixi path.
 *
 * The compiled backends run inside a host pixi renderer, which is how a game
 * uses this library — so the editor runs them the same way rather than driving
 * a canvas of its own. That buys the thing this module exists for: pan and zoom
 * are a Container transform, applied when the particles are DRAWN. Transforming
 * the canvas element instead magnifies a finished image and slides the drawn
 * area out of its own viewport.
 *
 * The interpreted backend cannot come along: pixi owns the canvas context and a
 * canvas has exactly one. It keeps its own path in Preview, where the same view
 * is expressed as the handles' `zoom` and `viewOffset`.
 */
import { Application, Container, Texture, TilingSprite } from 'pixi.js';
import {
  createPylinka,
  registerPylinka,
  type CompiledMaskOptions,
  type ParticleSystemView,
  type PylinkaRuntime,
} from '@pylinka/core/pixi';
import type { PylinkaProject } from '@pylinka/graph';

import type { EditorProject } from './types';

export interface PixiStageOptions {
  canvas: HTMLCanvasElement;
  project: EditorProject;
  /** 'webgl2' | 'webgpu' — which renderer pixi should build */
  backend: 'webgl2' | 'webgpu';
  textures?: Record<string, { image: TexImageSource | string; cols?: number; rows?: number; pad?: number; fps?: number }>;
  masks?: Record<string, CompiledMaskOptions>;
  /** checkerboard colours and square size, in CSS px */
  backdrop: { a: string; b: string; size: number };
}

export interface PixiStage {
  /** system id → view, for the per-system driving Preview does */
  readonly views: Map<string, ParticleSystemView>;
  /** the order systems were built in, parents first */
  readonly order: string[];
  /**
   * Point the view at a world position and a zoom.
   *
   * `cx, cy` is the world point under the middle of the canvas. The container
   * carries it: scale for the zoom, position for the pan, both applied at draw
   * time so every zoom level is rendered rather than stretched.
   */
  setView(z: number, cx: number, cy: number): void;
  /** Advance every system and draw one frame. */
  frame(dt: number): void;
  setBackdrop(b: { a: string; b: string; size: number }): void;
  /** Match the renderer to the canvas box (CSS px) and the display density. */
  resize(width: number, height: number, resolution: number): void;
  /** Re-read an edited project; false when a rebuild is needed. */
  apply(project: PylinkaProject): boolean;
  destroy(): void;
}

/** A 2x2 checker cell, tiled — one tiny texture instead of a shader. */
function checkerTexture(a: string, b: string, size: number): Texture {
  const c = document.createElement('canvas');
  c.width = size * 2;
  c.height = size * 2;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, size * 2, size * 2);
  ctx.fillStyle = b;
  ctx.fillRect(size, 0, size, size);
  ctx.fillRect(0, size, size, size);
  return Texture.from(c);
}

export async function createPixiStage(opts: PixiStageOptions): Promise<PixiStage> {
  // the render pipe is what actually draws a ParticleView; without it pixi has
  // no handler for the view's renderPipeId and the particles never appear.
  // Registering twice is harmless — pixi's extension system de-duplicates.
  registerPylinka();
  const app = new Application();
  await app.init({
    canvas: opts.canvas,
    preference: opts.backend === 'webgpu' ? 'webgpu' : 'webgl',
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    // pixi must NOT write canvas.style: the element is laid out by the editor
    // (a flex child filling the preview pane), and an inline width would fight
    // it. Preview drives `resize` from the box it measures instead.
    autoDensity: false,
    antialias: false,
    // opaque, because a light blend mode adds to the pixels in THIS buffer: over
    // a transparent clear there is nothing to add to and `add` behaves as if the
    // backdrop were black, however the page behind it is painted
    backgroundAlpha: 1,
    backgroundColor: opts.backdrop.a,
    // the editor drives the clock: a frame is stepped and drawn by Preview's
    // loop, which also runs the trajectory drivers and the spawn tool
    autoStart: false,
    sharedTicker: false,
  });

  // bottom to top: backdrop, then the particles under the view transform
  let checker = new TilingSprite({ texture: checkerTexture(opts.backdrop.a, opts.backdrop.b, opts.backdrop.size), width: 1, height: 1 });
  app.stage.addChild(checker);
  const world = new Container();
  app.stage.addChild(world);

  const runtime: PylinkaRuntime = await createPylinka(opts.project as PylinkaProject, {
    renderer: app.renderer,
    ...(opts.textures ? { textures: opts.textures as never } : {}),
    ...(opts.masks ? { emissionMasks: opts.masks } : {}),
  });

  // views come back keyed by NAME; the editor works in system IDs
  const views = new Map<string, ParticleSystemView>();
  const order: string[] = [];
  for (const sys of opts.project.systems) {
    if (!sys.enabled) continue;
    const v = runtime.systems[sys.name];
    if (v === undefined) continue;
    views.set(sys.id, v);
    order.push(sys.id);
    world.addChild(v.view as unknown as Container);
  }

  /** Stage units are CSS px, so the backdrop spans the renderer's CSS size. */
  const fitBackdrop = () => {
    checker.width = app.renderer.width;
    checker.height = app.renderer.height;
  };
  fitBackdrop();

  let bg = opts.backdrop;

  return {
    views,
    order,
    setView(z, cx, cy) {
      const w = app.renderer.width;
      const h = app.renderer.height;
      world.scale.set(z);
      // put the world point (cx, cy) in the middle of the canvas
      world.position.set(w / 2 - cx * z, h / 2 - cy * z);
      fitBackdrop();
    },
    frame(dt) {
      fitBackdrop();
      runtime.update(dt);
      app.render();
    },
    resize(width, height, resolution) {
      if (width <= 0 || height <= 0) return;
      app.renderer.resize(width, height, resolution);
      fitBackdrop();
    },
    setBackdrop(next) {
      if (next.a === bg.a && next.b === bg.b && next.size === bg.size) return;
      bg = next;
      const old = checker;
      checker = new TilingSprite({ texture: checkerTexture(next.a, next.b, next.size), width: old.width, height: old.height });
      app.stage.addChildAt(checker, 0);
      old.destroy({ texture: true });
      app.renderer.background.color = next.a;
    },
    apply(project) {
      let ok = true;
      for (const v of views.values()) if (!v.apply(project)) ok = false;
      return ok;
    },
    destroy() {
      runtime.destroy();
      // `false`: the canvas belongs to React, and pixi would tear it out
      app.destroy(false, { children: true, texture: true });
    },
  };
}
