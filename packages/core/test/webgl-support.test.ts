/**
 * A tripwire for the "what can this backend run" list.
 *
 * `INTERPRETED_KINDS` is a hand-written mirror of what `extractParams` reads,
 * and the editor marks nodes with it. A mirror that drifts is worse than no
 * mirror: it would mark a node as ignored while the backend happily runs it,
 * or stay quiet about one that does nothing. So this reads the source of
 * `params.ts` and holds the two together.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INTERPRETED_KINDS, isInterpreted, unsupportedNodes } from '../src/webgl/support.js';
import type { System } from '@pylinka/graph';

const SRC = readFileSync(fileURLToPath(new URL('../src/webgl/params.ts', import.meta.url)), 'utf8');

/** Every 'namespace.kind' string literal in the extractor. */
function kindsInSource(): string[] {
  return [...new Set([...SRC.matchAll(/'([a-z]+\.[A-Za-z0-9]+)'/g)].map((m) => m[1]!))];
}

describe('INTERPRETED_KINDS', () => {
  it('lists every kind the extractor reads', () => {
    const missing = kindsInSource().filter((k) => !INTERPRETED_KINDS.has(k));
    expect(missing, `params.ts reads these but the list does not name them: ${missing.join(', ')}`).toEqual([]);
  });

  it('names nothing the extractor does not read', () => {
    const inSource = new Set(kindsInSource());
    const stale = [...INTERPRETED_KINDS].filter((k) => !inSource.has(k));
    expect(stale, `listed but unread: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('isInterpreted', () => {
  it('counts the outputs whose meaning comes from the node behind them', () => {
    // this backend reads field.gravity, not the addForce it feeds — the force
    // still lands, so calling addForce unsupported would be a lie
    for (const k of ['output.addForce', 'output.drag', 'output.writeColor']) {
      expect(isInterpreted(k), k).toBe(true);
    }
  });

  it('does not count the expression graph it cannot evaluate', () => {
    for (const k of ['math.add', 'input.age', 'gen.noise', 'output.killIf', 'output.setVelocity']) {
      expect(isInterpreted(k), k).toBe(false);
    }
  });
});

describe('unsupportedNodes', () => {
  it('returns the ids of nodes this backend will ignore', () => {
    const system: System = {
      id: 's', name: 'x', capacity: 10, blendMode: 'add', enabled: true, space: 'world',
      emitter: { mode: 'flow', rate: 1 },
      graph: {
        nodes: [
          { id: 'ok', kind: 'shape.circle' },
          { id: 'nope', kind: 'math.mul' },
          { id: 'also-nope', kind: 'output.killIfOutOfRect' },
        ],
        edges: [],
      },
    };
    expect(unsupportedNodes(system)).toEqual(['nope', 'also-nope']);
  });
});
