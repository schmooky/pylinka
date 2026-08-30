/**
 * A canvas gets exactly one context, ever.
 *
 * The preview's render loop starts before its handles do, and on a compiled
 * backend the pixi stage is built asynchronously. If anything in that window
 * asks the canvas for a `webgl2` context, the element is bound to WebGL for
 * good, and pixi's later `getContext('webgpu')` returns null — which surfaces
 * as `Cannot read properties of null (reading 'configure')` from inside the
 * renderer, on a canvas that looks perfectly healthy. It is a race, so it
 * reproduces on some machines and not others.
 *
 * This reads the source and holds the line: the raw context may only be taken
 * when the INTERPRETED backend is the one chosen, never merely because the
 * pixi stage has not finished loading.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(
  fileURLToPath(new URL('../src/editor/components/Preview.tsx', import.meta.url)),
  'utf8',
);

describe('the preview canvas context', () => {
  it('is only ever taken on the interpreted backend', () => {
    const calls = [...SRC.matchAll(/canvas\.getContext\(/g)];
    expect(calls.length, 'more than one getContext call — check each one').toBe(1);

    // the guard immediately above the call has to name the backend
    const at = SRC.indexOf('canvas.getContext(');
    const before = SRC.slice(Math.max(0, at - 300), at);
    expect(before).toContain("backendRef.current === 'webgl'");
  });

  it('does not gate it on the stage, which is null while pixi is still loading', () => {
    const at = SRC.indexOf('canvas.getContext(');
    const guard = SRC.slice(Math.max(0, at - 120), at);
    expect(guard).not.toMatch(/if \(stage === null\) \{\s*$/);
  });
});
