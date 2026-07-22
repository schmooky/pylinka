/**
 * The interpreted runtime builds ONE uber-shader, so every optional feature it
 * grows is a tax on effects that never use it. These lock in that the
 * interaction blocks (field.obstacle / output.collide*) are spliced in only
 * when the effect's graph actually contains them — an effect without them must
 * link exactly the shader it linked before those nodes existed.
 */
import { describe, expect, it } from 'vitest';
import { updateVs, updateVsSub, type ForceFeatures } from '../src/webgl/shaders.js';
import { featuresOf } from '../src/webgl/engine.js';
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
