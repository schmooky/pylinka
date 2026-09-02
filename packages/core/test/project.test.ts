/**
 * A project's sub-emitter links have to survive being loaded.
 *
 * `createParticles` builds ONE system, and a sub-emitter needs its parent's
 * live handle passed in — the two share GPU buffers. Every consumer therefore
 * had to write the same topological sort, and most wrote none at all: a
 * project exported from the editor came back as a set of unrelated systems,
 * with the child spawning at its own emitter instead of on its parent's
 * deaths. It read as "the link was not saved". It was saved; nothing on the
 * loading side read it.
 */
import { describe, expect, it } from 'vitest';
import type { PylinkaProject, System } from '@pylinka/graph';
import { buildProject, systemsInBuildOrder } from '../src/project.js';

const sys = (id: string, enabled = true): System => ({
  id, name: id, capacity: 10, blendMode: 'add', enabled, space: 'world',
  emitter: { mode: 'flow', rate: 1 }, graph: { nodes: [], edges: [] },
});

const project = (systems: System[], subEmitters?: Record<string, string>): PylinkaProject =>
  ({ version: 1, id: 'p', name: 'p', params: [], assets: [], systems, subEmitters }) as unknown as PylinkaProject;

describe('systemsInBuildOrder', () => {
  it('puts a parent before its child', () => {
    const { systems, links } = systemsInBuildOrder(project([sys('child'), sys('parent')], { child: 'parent' }));
    expect(systems.map((s) => s.id)).toEqual(['parent', 'child']);
    expect(links.get('child')).toBe('parent');
  });

  it('orders a chain', () => {
    const { systems } = systemsInBuildOrder(
      project([sys('c'), sys('b'), sys('a')], { c: 'b', b: 'a' }),
    );
    expect(systems.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops a link to a muted parent instead of dropping the child', () => {
    const { systems, links } = systemsInBuildOrder(
      project([sys('child'), sys('parent', false)], { child: 'parent' }),
    );
    expect(systems.map((s) => s.id)).toEqual(['child']);
    expect(links.size).toBe(0);
  });

  it('keeps every system when the links form a cycle', () => {
    const { systems } = systemsInBuildOrder(project([sys('a'), sys('b')], { a: 'b', b: 'a' }));
    expect(systems.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('ignores a system parented to itself', () => {
    const { links } = systemsInBuildOrder(project([sys('a')], { a: 'a' }));
    expect(links.size).toBe(0);
  });
});

describe('buildProject', () => {
  const fake = (id: string) => ({ id, steps: 0, update() { this.steps++; }, destroy() {} });

  it('hands each child its parent handle', async () => {
    const seen: [string, string | undefined][] = [];
    const built = await buildProject(project([sys('child'), sys('parent')], { child: 'parent' }), (s, parent) => {
      seen.push([s.id, (parent as { id: string } | undefined)?.id]);
      return fake(s.id);
    });
    expect(seen).toEqual([['parent', undefined], ['child', 'parent']]);
    expect(built.byId.get('child')).toBeDefined();
  });

  it('steps parents before children — a child reads this frame’s parent state', async () => {
    const order: string[] = [];
    const built = await buildProject(project([sys('child'), sys('parent')], { child: 'parent' }), (s) => ({
      update() { order.push(s.id); },
      destroy() {},
    }));
    built.update(1 / 60);
    expect(order).toEqual(['parent', 'child']);
  });

  it('destroys everything it built', async () => {
    let alive = 2;
    const built = await buildProject(project([sys('a'), sys('b')]), () => ({
      update() {},
      destroy() { alive--; },
    }));
    built.destroy();
    expect(alive).toBe(0);
    expect(built.handles).toHaveLength(0);
  });
});

/**
 * The composite a bare `createParticles(canvas, project)` returns.
 *
 * Loading a project should just run it. The pieces below are the ones every
 * caller was getting wrong by hand: one clear per frame rather than one per
 * system, and a burst that reaches the roots rather than the children — a
 * sub-emitter's particles come from its parent's, so bursting it directly
 * means nothing.
 */
describe('a project handle', () => {
  interface Fake {
    id: string;
    bursts: number;
    autoClear: boolean;
    update(dt: number): void;
    destroy(): void;
  }
  const make = (id: string): Fake => ({
    id,
    bursts: 0,
    autoClear: true,
    update() {},
    destroy() {},
  });

  it('gives the clear to the first system only', async () => {
    const built = await buildProject(project([sys('a'), sys('b'), sys('c')]), (s) => make(s.id));
    // buildProject itself does not set autoClear — the backends' composite does
    // — so this documents the ORDER the composite relies on
    expect(built.handles.map((h) => (h as unknown as Fake).id)).toEqual(['a', 'b', 'c']);
  });

  it('reports the roots, which is what a burst should reach', async () => {
    const { systems, links } = systemsInBuildOrder(
      project([sys('spark'), sys('rocket')], { spark: 'rocket' }),
    );
    const roots = systems.filter((s) => !links.has(s.id)).map((s) => s.id);
    expect(roots).toEqual(['rocket']);
  });
});
