/** Shared per-namespace presentation: accent colour + human name, in palette order. */
export const NS_ORDER = ['shape', 'gen', 'field', 'input', 'param', 'math', 'tex', 'output'] as const;

/**
 * Namespace tints — hue at LOW chroma.
 *
 * Two things need encoding on a node and they must not fight: which family it
 * belongs to, and what type each port is. Family gets hue, type gets lightness
 * (see `--t-*` in editor.css). Keeping them on separate axes means a wire's
 * type stays readable against any node.
 *
 * Chroma is held at or under 0.08, so these read as tinted greys rather than
 * colour. A graph is dozens of nodes at once; at full saturation the canvas
 * would out-shout the preview, which is the one place colour actually carries
 * meaning here.
 */
export const NS_TINT: Record<string, string> = {
  shape: 'oklch(0.76 0.07 70)', // spawn — warm
  gen: 'oklch(0.74 0.06 195)', // generators — cyan
  field: 'oklch(0.72 0.07 150)', // forces — green
  output: 'oklch(0.70 0.08 25)', // sinks — rose
  param: 'oklch(0.80 0.06 95)', // knobs — amber
  tex: 'oklch(0.72 0.07 320)', // texture — magenta
  math: 'oklch(0.66 0.03 265)', // plumbing — barely tinted
  input: 'oklch(0.62 0.01 0)', // ambient reads — near-neutral
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
