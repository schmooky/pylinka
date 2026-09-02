/**
 * Building a whole project, links and all.
 *
 * `createParticles` and `createCompiledParticles` each build ONE system, and a
 * sub-emitter has to be handed its parent's live handle as an option — the two
 * share GPU buffers, so the parent must exist first. That left every consumer
 * writing the same topological sort, and most of them not writing it at all: a
 * project exported from the editor with a sub-emitter came back as a set of
 * unrelated systems, the child spawning at its own emitter instead of on its
 * parent's deaths. It looked like the link had not been saved. It had; nothing
 * on the loading side was reading it.
 */
import type { PylinkaProject, System } from '@pylinka/graph';

/**
 * Enabled systems, parents before children.
 *
 * A link to a system that is missing or disabled is dropped rather than
 * throwing: muting one emitter should not take its children down with it. A
 * cycle keeps its systems, in declaration order — unbuildable as a chain, but
 * dropping them would be worse than ignoring the link.
 */
export function systemsInBuildOrder(project: PylinkaProject): {
  systems: System[];
  /** child system id → parent system id, filtered to what is actually there */
  links: Map<string, string>;
} {
  const enabled = project.systems.filter((s) => s.enabled);
  const present = new Set(enabled.map((s) => s.id));
  const links = new Map<string, string>();
  for (const [child, parent] of Object.entries(project.subEmitters ?? {})) {
    if (present.has(child) && present.has(parent) && child !== parent) links.set(child, parent);
  }

  const out: System[] = [];
  const placed = new Set<string>();
  let guard = enabled.length + 1;
  while (out.length < enabled.length && guard-- > 0) {
    for (const s of enabled) {
      if (placed.has(s.id)) continue;
      const parent = links.get(s.id);
      if (parent === undefined || placed.has(parent)) {
        out.push(s);
        placed.add(s.id);
      }
    }
  }
  for (const s of enabled) if (!placed.has(s.id)) out.push(s);
  return { systems: out, links };
}

/** A project's systems, running together. */
export interface ProjectParticles<H> {
  /** by system id, in build order */
  readonly handles: H[];
  /** system id → handle */
  readonly byId: Map<string, H>;
  /** Step every system, parents first, and draw. */
  update(dtSeconds: number): void;
  destroy(): void;
}

/**
 * Build every enabled system of a project with its sub-emitter links wired.
 *
 * `create` is the per-system constructor — `createParticles` for the
 * interpreted backend, `createCompiledParticles` for a compiled one — called
 * with the parent's handle where the project declares one.
 */
export async function buildProject<H extends { update(dt: number): void; destroy(): void }>(
  project: PylinkaProject,
  create: (system: System, parent: H | undefined) => H | Promise<H>,
): Promise<ProjectParticles<H>> {
  const { systems, links } = systemsInBuildOrder(project);
  const byId = new Map<string, H>();
  const handles: H[] = [];
  for (const sys of systems) {
    const parentId = links.get(sys.id);
    const handle = await create(sys, parentId !== undefined ? byId.get(parentId) : undefined);
    byId.set(sys.id, handle);
    handles.push(handle);
  }
  return {
    handles,
    byId,
    update(dt) {
      // build order is also step order: a child reads the parent's state from
      // THIS frame, so the parent has to have moved first
      for (const h of handles) h.update(dt);
    },
    destroy() {
      for (const h of handles) h.destroy();
      handles.length = 0;
      byId.clear();
    },
  };
}
