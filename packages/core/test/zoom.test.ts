/**
 * `zoom` is settable while the effect runs.
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
