/** Shared per-namespace presentation: accent colour + human name, in palette order. */
export const NS_ORDER = ['shape', 'gen', 'field', 'input', 'param', 'math', 'tex', 'output'] as const;

export const NS_TINT: Record<string, string> = {
  input: '#6b7280',
  param: '#a78bfa',
  gen: '#22d3ee',
  math: '#94a3b8',
  field: '#34d399',
  shape: '#fbbf24',
  output: '#f87171',
  tex: '#e879f9',
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
