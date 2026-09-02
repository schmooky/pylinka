import { systemsInBuildOrder } from '../project.js';
/**
 * @pylinka/core/gpu — one call, best available compiled backend.
 *
 * `createCompiledParticles` compiles the project graph to real GPU code and
 * runs it: WebGPU compute kernels where available, the compiled WebGL2
 * transform-feedback path everywhere else. Same handle either way.
 *
 * @example
 * ```ts
 * import { createCompiledParticles } from '@pylinka/core/gpu';
 * const fx = await createCompiledParticles(canvas, project); // picks webgpu|webgl2
 * console.log(fx.backendName);
 * ```
 */
import type { PylinkaProject } from '@pylinka/graph';
import type { CompiledParticlesHandle, CompiledParticlesOptions } from '../compiled/types.js';
import { createParticles as createWebgl2 } from '../webgl2/engine.js';
import { createParticles as createWebgpu } from '../webgpu/engine.js';

export type CompiledBackend = 'auto' | 'webgpu' | 'webgl2';

export interface CreateCompiledOptions extends CompiledParticlesOptions {
  /** 'auto' (default): webgpu when the browser has it, else webgl2. */
  backend?: CompiledBackend;
}

/**
 * Run a project on a compiled backend.
 *
 * With no `systemName`, this builds EVERY enabled system and wires the
 * sub-emitter links the project declares — see the note on the interpreted
 * `createParticles`. Name a system to get just that one.
 */
export async function createCompiledParticles(
  canvas: HTMLCanvasElement,
  project: PylinkaProject,
  opts: CreateCompiledOptions = {},
): Promise<CompiledParticlesHandle> {
  const { backend = 'auto', ...rest } = opts;
  const hasWebGPU = typeof navigator !== 'undefined' && (navigator as { gpu?: unknown }).gpu !== undefined;
  // webgpu's creator is async and webgl2's is not; normalise so the build loop
  // below can await either
  const one = async (p: PylinkaProject, o: CompiledParticlesOptions): Promise<CompiledParticlesHandle> =>
    backend === 'webgpu' || (backend === 'auto' && hasWebGPU)
      ? createWebgpu(canvas, p, o)
      : createWebgl2(canvas, p, o);

  if (opts.systemName === undefined && opts.subParent === undefined) {
    const { systems, links } = systemsInBuildOrder(project);
    if (systems.length > 1 || links.size > 0) {
      const byId = new Map<string, CompiledParticlesHandle>();
      const built: CompiledParticlesHandle[] = [];
      for (const sys of systems) {
        const parentId = links.get(sys.id);
        const parent = parentId !== undefined ? byId.get(parentId) : undefined;
        const h = await one(project, {
          ...rest,
          systemName: sys.name,
          ...(parent !== undefined ? { subParent: parent } : {}),
        });
        // one clear per frame, done by the first; the rest composite on top
        h.autoClear = built.length === 0;
        byId.set(sys.id, h);
        built.push(h);
      }
      return combineCompiled(built, new Set([...links.keys()].map((id) => byId.get(id)!)));
    }
  }
  return one(project, rest);
}

/** One handle over several systems — see `combine` in the interpreted backend. */
function combineCompiled(
  handles: CompiledParticlesHandle[],
  children: Set<CompiledParticlesHandle>,
): CompiledParticlesHandle {
  const first = handles[0]!;
  const roots = handles.filter((h) => !children.has(h));
  return {
    update(dt: number) {
      for (const h of handles) h.update(dt);
    },
    setEmitter(x: number, y: number, teleport?: boolean) {
      for (const h of handles) h.setEmitter(x, y, teleport);
    },
    spawnBurst(count: number) {
      // a sub-emitter's particles come from its parent's: bursting it directly
      // means nothing, so only the roots hear this
      for (const h of roots) h.spawnBurst(count);
    },
    setKnob(name: string, x: number, y?: number) {
      for (const h of handles) h.setKnob(name, x, y);
    },
    apply(next: PylinkaProject) {
      let ok = true;
      for (const h of handles) if (!h.apply(next)) ok = false;
      return ok;
    },
    get autoClear() {
      return first.autoClear;
    },
    set autoClear(v: boolean) {
      first.autoClear = v;
    },
    get clearColor() {
      return first.clearColor;
    },
    set clearColor(v: [number, number, number, number]) {
      first.clearColor = v;
    },
    get zoom() {
      return first.zoom;
    },
    set zoom(v: number) {
      for (const h of handles) h.zoom = v;
    },
    get viewOffset(): [number, number] {
      return first.viewOffset;
    },
    set viewOffset(v: [number, number]) {
      for (const h of handles) h.viewOffset = v;
    },
    get stats() {
      return first.stats;
    },
    destroy() {
      for (const h of handles) h.destroy();
    },
  } as CompiledParticlesHandle;
}

export type {
  CompiledParticlesHandle,
  CompiledParticlesOptions,
  CompiledStats,
} from '../compiled/types.js';
export type { CompiledAtlasOptions } from '../compiled/sprite.js';
export { ValueTable, writeLiteral, writeHexColor, pcg } from '../compiled/staging.js';
export { SystemClock } from '../compiled/emitter.js';
export { resolveSprite, softDisc } from '../compiled/sprite.js';
