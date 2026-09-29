/**
 * A project exported with external assets holds `assets/flame.png` where it
 * used to hold a data URI. `assetBase` makes those resolve next to the JSON
 * rather than against whatever page happens to load it.
 */
import { describe, expect, it } from 'vitest';
import { resolveAssetUrl } from '../src/render/runtime.js';

describe('resolveAssetUrl', () => {
  it('resolves relative paths against the base', () => {
    expect(
      resolveAssetUrl('assets/flame.png', 'https://cdn.example.com/fx/coin/project.json'),
    ).toBe('https://cdn.example.com/fx/coin/assets/flame.png');
    expect(resolveAssetUrl('assets/flame.png', new URL('https://cdn.example.com/fx/'))).toBe(
      'https://cdn.example.com/fx/assets/flame.png',
    );
  });

  it('passes data, absolute and protocol-relative URLs through', () => {
    const base = 'https://cdn.example.com/fx/';
    expect(resolveAssetUrl('data:image/png;base64,AAAA', base)).toBe('data:image/png;base64,AAAA');
    expect(resolveAssetUrl('https://other.example.com/a.png', base)).toBe(
      'https://other.example.com/a.png',
    );
    expect(resolveAssetUrl('blob:https://x/123', base)).toBe('blob:https://x/123');
    expect(resolveAssetUrl('//other.example.com/a.png', base)).toBe('//other.example.com/a.png');
  });

  it('leaves paths untouched without a base', () => {
    expect(resolveAssetUrl('assets/flame.png', undefined)).toBe('assets/flame.png');
  });
});
