/**
 * Recipe group ordering and prose, derived from the recipe data.
 *
 * This lives apart from the page so it can be tested. The gallery's `<head>`
 * used to carry hardcoded facts: the count drifted to 44 while the gallery grew
 * past it, and the group list in the description missed `physics` entirely for
 * the whole of 1.0. Nobody reads the `<head>`, so those numbers sat in social
 * cards long after they stopped being true.
 */
import { RECIPES, type RecipeGroup } from './data';

/** Curated display order. Groups outside this list still appear, at the end. */
const GROUP_ORDER: readonly string[] = [
  'trails',
  'fire',
  'magic',
  'ambient',
  'ui',
  'abstract',
  'swirl',
  'drawn',
  'physics',
  'combo',
];

/** How each group reads inside a sentence. */
const GROUP_PROSE: Record<string, string> = {
  trails: 'trails',
  fire: 'fire',
  magic: 'magic',
  ambient: 'ambient drift',
  ui: 'UI feedback',
  abstract: 'abstract',
  swirl: 'swirling vortexes',
  drawn: 'drawn emission areas',
  physics: 'collisions and moving obstacles',
  combo: 'multi-emitter combos',
};

/** Every group that actually has recipes, in display order. */
export function orderedGroups(recipes: readonly { group: RecipeGroup }[] = RECIPES): string[] {
  const present = [...new Set(recipes.map((r) => r.group as string))];
  return [
    ...GROUP_ORDER.filter((g) => present.includes(g)),
    ...present.filter((g) => !GROUP_ORDER.includes(g)),
  ];
}

/** Filter tabs for the gallery. */
export function filterTabs(recipes: readonly { group: RecipeGroup }[] = RECIPES): string[] {
  return ['all', ...orderedGroups(recipes)];
}

/** The group list as it appears in the meta description. */
export function groupBlurb(recipes: readonly { group: RecipeGroup }[] = RECIPES): string {
  return orderedGroups(recipes)
    .map((g) => GROUP_PROSE[g] ?? g)
    .join(', ');
}

export { GROUP_PROSE };
