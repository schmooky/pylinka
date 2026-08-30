/**
 * A tripwire, not a unit test.
 *
 * Undo works by recording a snapshot inside `commit`. An action that writes the
 * store with a raw `set` therefore changes the document invisibly to history —
 * which is exactly how adding and removing an emitter ended up un-undoable
 * while every other edit worked. Nothing about `set` looks wrong at the call
 * site, so this reads the store's own source and holds the line: an action may
 * only reach for `set` if it is listed here as UI-only state.
 *
 * If this fails, either route the new action through `commit` (usually right),
 * or add it below with a reason (only for state that is not part of the
 * document — panel visibility, selection, which tab is open).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(
  fileURLToPath(new URL('../src/editor/store.ts', import.meta.url)),
  'utf8',
);

/**
 * The three keys that make up the DOCUMENT. A raw `set` touching any of them
 * changes what the user would expect Ctrl+Z to bring back; a raw `set` touching
 * only selection or panel state is fine and stays out of history on purpose.
 */
const DOCUMENT_KEYS = ['project', 'positions', 'activeSystemId'];

/**
 * Navigation, not an edit. Switching emitter tabs must NOT create an undo step
 * — but `activeSystemId` stays inside the snapshot so that undoing a change
 * made on another emitter takes you back to that emitter to see it happen.
 */
const NAVIGATION = new Set(['setActiveSystem']);

/** Every method on the store object, with its body. */
function actions(): { name: string; body: string }[] {
  const lines = SRC.split('\n');
  const out: { name: string; body: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {4}([a-zA-Z][a-zA-Z0-9]*)\(/.exec(lines[i]!);
    if (!m) continue;
    const body: string[] = [];
    for (let j = i; j < lines.length; j++) {
      body.push(lines[j]!);
      if (lines[j] === '    },') break;
    }
    if (m[1] !== 'set') out.push({ name: m[1]!, body: body.join('\n') });
    i += body.length - 1;
  }
  return out;
}

describe('store — every document change is undoable', () => {
  const all = actions();

  it('finds the action surface at all (guards the parser itself)', () => {
    const names = all.map((a) => a.name);
    expect(names).toContain('addNode');
    expect(names).toContain('deleteNode');
    expect(names).toContain('addSystem');
    expect(names).toContain('removeSystem');
    expect(all.length).toBeGreaterThan(30);
  });

  it('no action writes document state outside commit', () => {
    const offenders = all
      .filter((a) => !NAVIGATION.has(a.name))
      .filter((a) => {
        // every raw set( in the body, with what it assigns
        const writes = [...a.body.matchAll(/(?:^|[^a-zA-Z])set\(([\s\S]*?)\);/g)].map((m) => m[1]!);
        return writes.some((w) => DOCUMENT_KEYS.some((k) => new RegExp(`\\b${k}\\s*:`).test(w)));
      })
      .map((a) => a.name);
    expect(offenders).toEqual([]);
  });

  it('the two emitter actions in particular go through commit', () => {
    // these were the ones that silently bypassed it
    for (const name of ['addSystem', 'removeSystem']) {
      const a = all.find((x) => x.name === name)!;
      expect(a.body, name).toMatch(/commit\(/);
      expect(a.body, name).not.toMatch(/(^|[^a-zA-Z])set\(/m);
    }
  });

  it('undo carries the asset libraries forward instead of snapshotting them', () => {
    // data-URL images must never end up duplicated across history entries
    expect(SRC).toMatch(/delete rest\.textures;/);
    expect(SRC).toMatch(/delete rest\.references;/);
  });
});
