/**
 * What the pixi runtime can carry, beyond a bare project.
 *
 * `createPylinka` built every enabled system independently: no emission masks
 * (the option did not exist) and no sub-emitter links, though the compiled sims
 * underneath support both. An editor preview built on it would have quietly
 * lost painted spawn areas and cross-system sub-emitters — features that look
 * like they are simply broken rather than unsupported.
 *
 * The GPU parts need a device, so what is unit-testable is the wiring: which
 * links survive, and in what order systems get built.
 */
import { describe, expect, it } from 'vitest';
import type { PylinkaProject, System } from '@pylinka/graph';
import { __testing } from '../src/render/runtime.js';

const { linksByName, parentsFirst } = __testing;

const sys = (id: string, name: string, enabled = true): System => ({
  id, name, capacity: 10, blendMode: 'add', enabled, space: 'world',
  emitter: { mode: 'flow', rate: 1 }, graph: { nodes: [], edges: [] },
});

const project = (systems: System[], subEmitters?: Record<string, string>): PylinkaProject =>
  ({ version: 1, id: 'p', name: 'p', params: [], assets: [], systems, ...(subEmitters ? { subEmitters } : {}) }) as unknown as PylinkaProject;

describe('sub-emitter links', () => {
  it('reads the project map, which is keyed by system ID, and returns names', () => {
    const p = project([sys('s1', 'smoke'), sys('s2', 'embers')], { s2: 's1' });
    expect(linksByName(p, { renderer: {} })).toEqual(new Map([['embers', 'smoke']]));
  });

  it('drops a link whose parent is muted rather than failing the build', () => {
    // muting one emitter should not take its children down with it
    const p = project([sys('s1', 'smoke', false), sys('s2', 'embers')], { s2: 's1' });
    expect(linksByName(p, { renderer: {} }).size).toBe(0);
  });

  it('drops a system parented to itself', () => {
    const p = project([sys('s1', 'smoke')], { s1: 's1' });
    expect(linksByName(p, { renderer: {} }).size).toBe(0);
  });

  it('lets the option override the project, by name', () => {
    const p = project([sys('s1', 'smoke'), sys('s2', 'embers')], { s2: 's1' });
    const links = linksByName(p, { renderer: {}, subEmitters: { smoke: 'embers' } });
    expect(links).toEqual(new Map([['smoke', 'embers']]));
  });
});

describe('build order', () => {
  it('puts a parent before its child — they share GPU buffers', () => {
    const list = [sys('s1', 'child'), sys('s2', 'parent')];
    const order = parentsFirst(list, new Map([['child', 'parent']]));
    expect(order.map((s) => s.name)).toEqual(['parent', 'child']);
  });

  it('handles a chain', () => {
    const list = [sys('s3', 'c'), sys('s2', 'b'), sys('s1', 'a')];
    const order = parentsFirst(list, new Map([['c', 'b'], ['b', 'a']]));
    expect(order.map((s) => s.name)).toEqual(['a', 'b', 'c']);
  });

  it('keeps every system when the links form a cycle', () => {
    // a cycle cannot be ordered, but dropping the systems would be worse than
    // building them in the order they were declared
    const list = [sys('s1', 'a'), sys('s2', 'b')];
    const order = parentsFirst(list, new Map([['a', 'b'], ['b', 'a']]));
    expect(order.map((s) => s.name).sort()).toEqual(['a', 'b']);
  });
});
