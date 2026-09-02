/**
 * Which system a handle drives, and what happens when the name changes.
 *
 * A handle remembered the NAME it bound to, and `apply` re-resolved by that
 * name on every live edit with a fall-through to "the first enabled system".
 * So renaming an emitter did not fail — it silently bound the handle to a
 * DIFFERENT system, and the effect on screen quietly became a copy of another
 * one. In the editor, where renaming a tab does not rebuild the preview, that
 * is exactly what happened.
 *
 * Ids survive a rename; names are the thing a person edits.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PylinkaProject, System } from '@pylinka/graph';
import { pickSystem } from '../src/system.js';

const sys = (id: string, name: string, enabled = true): System => ({
  id, name, capacity: 10, blendMode: 'add', enabled, space: 'world',
  emitter: { mode: 'flow', rate: 1 }, graph: { nodes: [], edges: [] },
});

const project = (systems: System[]): PylinkaProject => ({
  version: 1, id: 'p', name: 'p', params: [], assets: [], systems,
} as unknown as PylinkaProject);

afterEach(() => vi.restoreAllMocks());

describe('pickSystem', () => {
  it('finds by name', () => {
    const p = project([sys('s1', 'a'), sys('s2', 'b')]);
    expect(pickSystem(p, 'b')?.id).toBe('s2');
  });

  it('follows the id through a rename instead of rebinding', () => {
    const renamed = project([sys('s1', 'a'), sys('s2', 'swirl')]);
    // the handle was created when s2 was still called "b"
    expect(pickSystem(renamed, 'b', 's2')?.id).toBe('s2');
  });

  it('prefers the id when another system has taken the old name', () => {
    const p = project([sys('s1', 'b'), sys('s2', 'swirl')]);
    expect(pickSystem(p, 'b', 's2')?.id).toBe('s2');
  });

  it('still falls back when the name matches nothing, and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = project([sys('s1', 'a'), sys('s2', 'b')]);
    expect(pickSystem(p, 'typo-only-once')?.id).toBe('s1');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('typo-only-once');
    // the available names go in the message: the fix is usually a spelling
    expect(String(warn.mock.calls[0]?.[0])).toContain('a, b');

    // apply() runs on every live edit — a warning per frame would be its own bug
    pickSystem(p, 'typo-only-once');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('says nothing when re-resolving by id, even if the name is stale', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = project([sys('s1', 'a'), sys('s2', 'swirl')]);
    expect(pickSystem(p, 'the-old-name', 's2')?.id).toBe('s2');
    expect(warn).not.toHaveBeenCalled();
  });

  it('prefers an enabled system when asked for nothing', () => {
    const p = project([sys('s1', 'a', false), sys('s2', 'b')]);
    expect(pickSystem(p)?.id).toBe('s2');
  });
});
