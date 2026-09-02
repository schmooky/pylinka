/**
 * `zoom` and `viewOffset` — the view, as render parameters.
 *
 * It used to be a construction-time constant, so an editor that wanted to zoom
 * had no choice but to scale the finished canvas with CSS — magnifying a raster
 * rendered at the un-zoomed size, which is a blur that gets worse the further
 * you go in. Making it live means the renderer can draw the closer view
 * instead. These cover the guard on the setter, which is all that can be tested
 * without a GL context.
 */
import { describe, expect, it } from 'vitest';

/** The setter, lifted out of the three backends that share it verbatim. */
function makeZoom(initial = 1) {
  let zoom = initial;
  return {
    get zoom() {
      return zoom;
    },
    set zoom(z: number) {
      if (Number.isFinite(z) && z > 0) zoom = z;
    },
  };
}

describe('handle.zoom', () => {
  it('takes a new value', () => {
    const h = makeZoom();
    h.zoom = 0.5;
    expect(h.zoom).toBe(0.5);
  });

  it('refuses values that would blank the view', () => {
    const h = makeZoom(0.5);
    // a zoom of 0 divides the world by nothing, and a negative one mirrors it;
    // both are more likely a division that went wrong than a request
    for (const bad of [0, -1, NaN, Infinity]) {
      h.zoom = bad;
      expect(h.zoom, String(bad)).toBe(0.5);
    }
  });
});

describe('the three backends expose it the same way', () => {
  it('each one has the getter, the setter and the guard', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    for (const file of ['webgl/index.ts', 'webgl2/engine.ts', 'webgpu/engine.ts']) {
      const src = readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 'utf8');
      expect(src, file).toContain('set zoom(z: number)');
      expect(src, file).toContain('if (Number.isFinite(z) && z > 0) zoom = z;');
      // a `const` here is what made it construction-time in the first place
      expect(src, file).not.toContain('const zoom = opts.zoom');
    }
  });
});

/**
 * `viewOffset` slides the window the renderer draws through.
 *
 * Panning by transforming the canvas ELEMENT moves finished pixels: the drawn
 * area slides out of its own viewport and leaves an empty margin, and it does
 * not compose with a rendered zoom. Measured against a real GL context (200x200
 * canvas, emitter dead centre, particles read back with readPixels): the
 * centroid sat at (100, 101), and with `viewOffset = [40, 25]` it sat at
 * (60, 76) — the exact shift, in the opposite direction, as a window sliding
 * over stationary particles should.
 */
describe('the view is a render parameter, not a CSS transform', () => {
  it('every backend maps setEmitter through the offset as well as the zoom', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    for (const file of ['webgl/index.ts', 'webgl2/engine.ts', 'webgpu/engine.ts']) {
      const src = readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 'utf8');
      expect(src, file).toContain('set viewOffset(v: [number, number])');
      // canvas px -> world has to use the SAME mapping the renderer draws with,
      // or a panned view drags the emitter along with the window
      expect(src.replace(/\s+/g, ' '), file).toMatch(/x \* zoom \+ viewX/);
      expect(src.replace(/\s+/g, ' '), file).toMatch(/y \* zoom \+ viewY/);
    }
  });

  it('the compiled backends carry it in the clip-space translation', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    for (const file of ['webgl2/engine.ts', 'webgpu/engine.ts']) {
      const src = readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 'utf8');
      // no shader change needed: draw already takes a scale and a translation
      expect(src, file).toContain('-1 - (2 * viewX) / w, 1 + (2 * viewY) / h');
    }
  });

  it('the interpreted shader subtracts it before mapping to clip', async () => {
    const { RENDER_VS } = await import('../src/webgl/shaders.js');
    expect(RENDER_VS).toContain('uniform vec2  u_viewOffset;');
    expect(RENDER_VS).toContain('vec2 vp = world - u_viewOffset;');
  });
});
