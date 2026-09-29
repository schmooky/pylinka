import { describe, expect, it } from 'vitest';
import { gridForReplacement } from '../src/editor/textureFiles';

const sheet = { cols: 10, rows: 7, pad: 2, width: 1400, height: 980 };

describe('replacing a texture image', () => {
  it('keeps a sheet grid for a re-exported sheet of the same proportions', () => {
    expect(gridForReplacement(sheet, 1400, 980)).toEqual({});
    expect(gridForReplacement(sheet, 700, 490)).toEqual({});
  });

  it('turns a sheet into a single sprite when a differently shaped image replaces it', () => {
    expect(gridForReplacement(sheet, 48, 48)).toEqual({ cols: 1, rows: 1, pad: 0 });
  });

  it('leaves a single sprite a single sprite', () => {
    expect(gridForReplacement({ cols: 1, rows: 1, pad: 0, width: 64, height: 64 }, 128, 32)).toEqual({});
  });
});
