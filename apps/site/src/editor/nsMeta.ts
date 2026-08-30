/** Shared per-namespace presentation: accent colour + human name, in palette order. */
export const NS_ORDER = ['shape', 'gen', 'field', 'input', 'param', 'math', 'tex', 'output'] as const;

/**
 * Namespace tints, as lightness steps on a grey ramp. The editor is
 * deliberately monochrome (see editor.css): a namespace still separates at a
 * glance, but the only colour on screen belongs to the effect being authored.
 */
export const NS_TINT: Record<string, string> = {
  input: 'oklch(0.48 0 0)',
  param: 'oklch(0.90 0 0)',
  gen: 'oklch(0.80 0 0)',
  math: 'oklch(0.55 0 0)',
  field: 'oklch(0.72 0 0)',
  shape: 'oklch(0.64 0 0)',
  output: 'oklch(0.86 0 0)',
  tex: 'oklch(0.60 0 0)',
};

export const NS_LABEL: Record<string, string> = {
  input: 'Particle inputs',
  param: 'Knobs',
  gen: 'Generators',
  math: 'Math',
  field: 'Forces',
  shape: 'Spawn shapes',
  output: 'Outputs',
  tex: 'Texture',
};
