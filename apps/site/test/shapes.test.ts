/**
 * `shape.circle` is the RING in both backends. The recipes and templates here
 * were authored against an interpreted preview that filled the disc instead,
 * so every one of them that wants a blob has to say `shape.torus` from 0 —
 * otherwise the gallery quietly turns into a set of outlines.
 */
import { describe, expect, it } from 'vitest';
import { RECIPES } from '../src/recipes/data';
import { EMITTER_TEMPLATES } from '../src/editor/templates';

/** Every spawn-shape node across the gallery and the template picker. */
function shapeNodes(): { where: string; kind: string }[] {
  const out: { where: string; kind: string }[] = [];
  for (const r of RECIPES) {
    for (const s of r.project.systems) {
      for (const n of s.graph.nodes) {
        if (n.kind.startsWith('shape.')) out.push({ where: `recipe ${r.slug}`, kind: n.kind });
      }
    }
  }
  for (const t of EMITTER_TEMPLATES) {
    for (const n of t.system.graph.nodes) {
      if (n.kind.startsWith('shape.')) out.push({ where: `template ${t.id}`, kind: n.kind });
    }
  }
  return out;
}

describe('spawn shapes in the gallery', () => {
  it('asks for a ring only where a ring is meant', () => {
    const rings = shapeNodes().filter((s) => s.kind === 'shape.circle');
    expect(rings.map((r) => r.where)).toEqual([]);
  });

  it('still has plenty of blobs, as torus', () => {
    const torus = shapeNodes().filter((s) => s.kind === 'shape.torus');
    expect(torus.length).toBeGreaterThan(5);
  });
});
