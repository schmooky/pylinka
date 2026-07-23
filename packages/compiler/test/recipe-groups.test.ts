/**
 * Guards against the gallery's `<head>` drifting away from the gallery.
 *
 * The recipe count sat at a hardcoded 44 while the gallery grew past it, and
 * when the `physics` group landed, the meta description kept listing the old
 * groups. Both were invisible in the page itself, so nothing caught them. These
 * assert the derived metadata still covers every group that has recipes.
 */
import { describe, expect, it } from 'vitest';
import { RECIPES } from '../../../apps/site/src/recipes/data';
import { filterTabs, groupBlurb, orderedGroups, GROUP_PROSE } from '../../../apps/site/src/recipes/groups';

describe('recipe gallery metadata', () => {
  it('covers every group that actually has recipes', () => {
    const used = [...new Set(RECIPES.map((r) => r.group))].sort();
    expect(orderedGroups().slice().sort()).toEqual(used);
  });

  it('gives every group prose for the meta description', () => {
    const missing = orderedGroups().filter((g) => GROUP_PROSE[g] === undefined);
    expect(missing, `add these to GROUP_PROSE: ${missing.join(', ')}`).toEqual([]);
  });

  it('names every group in the blurb the description is built from', () => {
    const blurb = groupBlurb();
    for (const g of orderedGroups()) {
      expect(blurb, `group "${g}" missing from the meta description`).toContain(GROUP_PROSE[g]!);
    }
  });

  it('opens the filter tabs with "all" and lists nothing empty', () => {
    const tabs = filterTabs();
    expect(tabs[0]).toBe('all');
    for (const tab of tabs.slice(1)) {
      expect(RECIPES.some((r) => r.group === tab), `tab "${tab}" has no recipes`).toBe(true);
    }
  });

  it('appends an unknown group instead of dropping it', () => {
    const fake = [...RECIPES, { group: 'brand-new' as never }];
    expect(orderedGroups(fake)).toContain('brand-new');
    expect(groupBlurb(fake)).toContain('brand-new');
  });
});
