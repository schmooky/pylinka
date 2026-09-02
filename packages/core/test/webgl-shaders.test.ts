/**
 * The interpreted runtime builds ONE uber-shader, so every optional feature it
 * grows is a tax on effects that never use it. These lock in that the
 * interaction blocks (field.obstacle / output.collide*) are spliced in only
 * when the effect's graph actually contains them — an effect without them must
 * link exactly the shader it linked before those nodes existed.
 */
import { describe, expect, it } from 'vitest';
import {
  EASE_CH_ROT,
  EASE_LUT_CHANNELS,
  RENDER_VS,
  updateVs,
  updateVsSub,
  type ForceFeatures,
} from '../src/webgl/shaders.js';
import { featuresOf } from '../src/webgl/engine.js';
import { playCode } from '../src/atlas.js';
import type { EngineParams } from '../src/webgl/params.js';

const OBSTACLE_TOKENS = ['obstacleForces', 'u_obCount', 'u_obA', 'u_obSoft', 'u_obRel'];
const COLLIDER_TOKENS = ['resolveColliders', 'u_colCount', 'u_colA', 'u_colRel'];

const build = (ft?: ForceFeatures) => [updateVs(ft), updateVsSub(ft)];

describe('interpreted shader — pay only for what you use', () => {
  it('an effect with no interaction nodes gets none of the code', () => {
    for (const src of build()) {
      for (const token of [...OBSTACLE_TOKENS, ...COLLIDER_TOKENS]) {
        expect(src, token).not.toContain(token);
      }
      // the pre-existing force model is untouched
      expect(src).toContain('pointForces(i_pos, u_emitter)');
      expect(src).toContain('turbForce(i_pos)');
      // and integration is the plain single-expression form
      expect(src).toContain('o_pos  = i_pos + vel * u_dt;');
    }
  });

  it('obstacles alone pull in the obstacle block only', () => {
    for (const src of build({ obstacles: true, colliders: false })) {
      for (const token of OBSTACLE_TOKENS) expect(src, token).toContain(token);
      for (const token of COLLIDER_TOKENS) expect(src, token).not.toContain(token);
      expect(src).toContain('+ obstacleForces(i_pos, i_vel, u_emitter)');
    }
  });

  it('colliders alone pull in the collider block only', () => {
    for (const src of build({ obstacles: false, colliders: true })) {
      for (const token of COLLIDER_TOKENS) expect(src, token).toContain(token);
      for (const token of OBSTACLE_TOKENS) expect(src, token).not.toContain(token);
      // integration splits so the resolve pass can see the crossed surface
      expect(src).toContain('vec2 pos = i_pos + vel * u_dt;');
      expect(src).toContain('resolveColliders(pos, vel, u_emitter);');
    }
  });

  it('featuresOf reads the flags off the extracted params', () => {
    const base = { obstacles: [], colliders: [] } as unknown as EngineParams;
    expect(featuresOf(base)).toEqual({ obstacles: false, colliders: false });
    expect(featuresOf({ ...base, obstacles: [{}] } as unknown as EngineParams)).toEqual({
      obstacles: true,
      colliders: false,
    });
    expect(featuresOf({ ...base, colliders: [{}] } as unknown as EngineParams)).toEqual({
      obstacles: false,
      colliders: true,
    });
  });
});

/**
 * Rotation is DERIVED in the render VS from seed + age (the sim state has no
 * angle field). These lock the three terms in, and that the atlas lookup is
 * left alone — rotating the UVs instead of the quad shears the sprite.
 */
describe('interpreted render shader — rotation', () => {
  it('sums a birth angle, a spin integrated over age, and an eased ramp', () => {
    expect(RENDER_VS).toContain('mix(u_rotStart.x, u_rotStart.y,');
    expect(RENDER_VS).toContain('mix(u_spin.x, u_spin.y,');
    expect(RENDER_VS).toContain('* a_age');
    expect(RENDER_VS).toContain('mix(u_rotFrom, u_rotTo, easeCh(u_rotEase,');
  });

  it('rotates the quad corners, not the atlas cell', () => {
    expect(RENDER_VS).toContain('vec2 off = a_corner * size;');
    expect(RENDER_VS).toContain('vec2(off.x * rc - off.y * rs, off.x * rs + off.y * rc)');
    // the UV path still reads the cell straight
    expect(RENDER_VS).toContain('v_uv = (cellPx + (a_corner + 0.5) * u_frameSize) / u_atlasSize;');
  });

  it('gives rotation its own ease-LUT channel above alpha', () => {
    expect(EASE_CH_ROT).toBe(3);
    expect(EASE_LUT_CHANNELS).toBe(4);
  });
});

/**
 * Sprite-sheet playback. `once` stretches the strip across the lifetime and
 * ignores fps, which is why a changed fps could look like it did nothing —
 * `hold` is the mode that plays at fps. These lock the three branches in, and
 * that `once` and `loop` keep the exact expressions they had before `hold`
 * existed (a project authored on either must not shift a frame).
 */
describe('interpreted render shader — atlas playback', () => {
  it('maps the three modes to the codes the shaders branch on', () => {
    expect(playCode('once')).toBe(0);
    expect(playCode('loop')).toBe(1);
    expect(playCode('hold')).toBe(2);
    expect(playCode(undefined)).toBe(1); // loop stays the default
  });

  it('branches once / loop / hold, and only two of them read fps', () => {
    expect(RENDER_VS).toContain('(u_play > 1.5)');
    expect(RENDER_VS).toContain('clamp(floor(a_age * u_fps), 0.0, u_grid.x - 1.0)'); // hold
    expect(RENDER_VS).toContain('mod(floor(a_age * u_fps), u_grid.x)'); // loop
    expect(RENDER_VS).toContain('clamp(floor(tN * u_grid.x), 0.0, u_grid.x - 1.0)'); // once, no fps
  });
});

/**
 * Spawn shapes live in one helper shared by both update shaders, so the two
 * spawn paths cannot drift apart — they did, quietly, for four of the six
 * shapes: only circle and rect were branched on and everything else fell
 * through to a point.
 */
describe('interpreted shader — spawn shapes', () => {
  it('branches on all six shape codes, in both shaders', () => {
    for (const src of build()) {
      expect(src).toContain('vec2 shapeOffset(float s, float t)');
      for (const code of [1, 2, 3, 4, 5]) expect(src, `u_shape == ${code}`).toContain(`u_shape == ${code}`);
      // the point is the fallthrough, and it returns its offset rather than zero
      expect(src).toContain('return u_shapeA; // point, at its offset');
    }
  });

  it('lays the burst ring out by spawn index where there is one', () => {
    // the emit shader spawns into a numbered window, so the ring is even
    expect(updateVs()).toContain('shapeOffset(s, rel / max(u_spawnCount, 1.0))');
    // a sub-emitter spawns on parent deaths instead: no index, random angle
    expect(updateVsSub()).toContain('shapeOffset(s, -1.0)');
    // unless it is a death BURST, where the copy number spaces them out
    expect(updateVsSub(undefined, true, 'death')).toContain('float(u_burstK) / max(float(burstN), 1.0)');
  });

  it('spawns a circle on the ring, not across the disc', () => {
    for (const src of build()) {
      // the compiled backends have always been `vec2(cos, sin) * radius`; this
      // one used to multiply by sqrt(random) as well, filling the disc, so the
      // same graph looked different in a preview and in a game
      expect(src).toContain('if (u_shape == 1) { float a = 6.2831853 * rnd(s, 1.0); return vec2(cos(a), sin(a)) * u_shapeR; }');
      expect(src).not.toContain('u_shapeR * sqrt(');
    }
  });

  it('declares the two per-shape vectors in both shaders', () => {
    for (const src of build()) {
      expect(src).toContain('uniform vec2  u_shapeA');
      expect(src).toContain('uniform vec2  u_shapeB');
    }
  });
});
