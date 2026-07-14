import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile';
import { V1_CATALOG } from '@pylinka/graph';
import { RECIPES } from '../../../apps/site/src/recipes/data';

describe('every gallery recipe compiles on both targets', () => {
  for (const r of RECIPES) {
    for (const system of r.project.systems) {
      for (const target of ['webgpu', 'webgl2'] as const) {
        it(`${r.slug} / ${system.id} / ${target}`, () => {
          const bundle = { system, params: r.project.params, assets: r.project.assets };
          expect(() => compile(bundle, V1_CATALOG, target)).not.toThrow();
        });
      }
    }
  }
});
