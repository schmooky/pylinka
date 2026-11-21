/**
 * The pixi-side WebGL1 backend, driven against a recording fake GL context.
 * These cover what only shows up inside a host: the pixi state re-sync, the
 * attribute state the raw draw leaves behind, context loss and restore, the
 * missing-extension path, per-instance seeds, the unsupported-node warning,
 * and `apply()` leaving the backend untouched when it says no.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PylinkaProject, System } from '@pylinka/graph';
import { KnobStore } from '../src/knobs.js';
import { getSimBackendFactory, type SimBackend, type SimBackendDeps } from '../src/render/index.js';
import { ensureSimBackend } from '../src/render/backends.js';
import { CPU_STATE_FLOATS, type CpuSim } from '../src/webgl1/sim.js';
import { createParticles } from '../src/webgl/index.js';

interface Call {
  name: string;
  args: unknown[];
}

/** A WebGL1-shaped context that records every call and succeeds at everything. */
function fakeGl(opts: { instancing?: boolean; proto?: object } = {}) {
  const calls: Call[] = [];
  const canvas = Object.assign(new EventTarget(), { width: 100, height: 100 });
  let lost = false;
  let objects = 0;
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };
  const ext = {
    vertexAttribDivisorANGLE: record('vertexAttribDivisorANGLE'),
    drawElementsInstancedANGLE: record('drawElementsInstancedANGLE'),
  };
  const vao = { bindVertexArrayOES: record('bindVertexArrayOES') };
  const target: Record<string, unknown> = {
    canvas,
    isContextLost: () => lost,
    getExtension: (n: string) => {
      calls.push({ name: 'getExtension', args: [n] });
      return n === 'ANGLE_instanced_arrays'
        ? opts.instancing === false
          ? null
          : ext
        : n === 'OES_vertex_array_object'
          ? vao
          : null;
    },
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_p: unknown, n: string) => ({ n }),
  };
  if (opts.proto) Object.setPrototypeOf(target, opts.proto);
  const gl = new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      if (/^[A-Z_0-9]+$/.test(key)) return key; // constants: their own name is enough
      if (key.startsWith('create')) {
        return (...args: unknown[]) => {
          calls.push({ name: key, args });
          objects++;
          return { id: objects, kind: key };
        };
      }
      return record(key);
    },
  });
  return {
    gl: gl as unknown as WebGLRenderingContext,
    calls,
    canvas,
    count: (name: string) => calls.filter((c) => c.name === name).length,
    lose() {
      lost = true;
      canvas.dispatchEvent(new Event('webglcontextlost'));
    },
    restore() {
      lost = false;
      canvas.dispatchEvent(new Event('webglcontextrestored'));
    },
  };
}

function fakeRenderer() {
  const resets = { shader: 0, geometry: 0, state: 0, texture: 0 };
  const sys = (k: keyof typeof resets) => ({ resetState: () => void resets[k]++ });
  return {
    resets,
    renderer: {
      shader: sys('shader'),
      geometry: sys('geometry'),
      state: sys('state'),
      texture: sys('texture'),
      renderTarget: { projectionMatrix: { a: 2 / 100, b: 0, c: 0, d: -2 / 100, tx: -1, ty: 1 } },
    },
  };
}

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function system(over: Partial<System> = {}): System {
  return {
    id: 'sys-1',
    name: 'sparks',
    capacity: 8,
    blendMode: 'add',
    enabled: true,
    space: 'world',
    emitter: { mode: 'flow', rate: 1000 },
    graph: { nodes: [], edges: [] },
    ...over,
  };
}

await ensureSimBackend('webgl1');

function backend(
  over: Partial<SimBackendDeps> & {
    gl?: ReturnType<typeof fakeGl>;
    host?: ReturnType<typeof fakeRenderer>;
  } = {},
) {
  const gl = over.gl ?? fakeGl();
  const host = over.host ?? fakeRenderer();
  const sys = over.system ?? system();
  const deps: SimBackendDeps = {
    backend: 'webgl1',
    device: gl.gl,
    renderer: host.renderer,
    system: sys,
    params: [],
    knobs: new KnobStore([]),
    ...over,
  };
  const b = getSimBackendFactory('webgl1')!(deps) as SimBackend & { sim: CpuSim };
  return { b, gl, host };
}

/** One host frame: tick, simulate, draw. */
function frame(b: SimBackend, dt = 0.1): void {
  b.prepare(dt);
  b.simulate();
  b.draw(IDENTITY);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WebGL1SimBackend — pixi state', () => {
  it('re-syncs pixi right after it creates its GL objects', () => {
    const { host } = backend();
    expect(host.resets).toEqual({ shader: 1, geometry: 1, state: 1, texture: 1 });
  });

  it('draws the alive particles and leaves the default attribute state clean', () => {
    const { b, gl, host } = backend();
    frame(b);
    const draw = gl.calls.find((c) => c.name === 'drawElementsInstancedANGLE');
    expect(draw?.args[4]).toBe(8); // capacity 8, spawn rate fills it
    expect(b.stats.aliveCount).toBe(8);
    const after = gl.calls.slice(gl.calls.indexOf(draw!));
    for (const loc of [1, 2, 3, 4]) {
      expect(
        after.some(
          (c) => c.name === 'vertexAttribDivisorANGLE' && c.args[0] === loc && c.args[1] === 0,
        ),
      ).toBe(true);
    }
    for (const loc of [0, 1, 2, 3, 4]) {
      expect(after.some((c) => c.name === 'disableVertexAttribArray' && c.args[0] === loc)).toBe(
        true,
      );
    }
    expect(after.some((c) => c.name === 'bindBuffer' && c.args[1] === null)).toBe(true);
    expect(host.resets.geometry).toBe(2); // construction + this draw
  });

  it('unbinds the host VAO before touching attributes', () => {
    const { b, gl } = backend();
    frame(b);
    const firstAttr = gl.calls.findIndex((c) => c.name === 'vertexAttribPointer');
    const unbind = gl.calls.findIndex(
      (c, i) => i < firstAttr && c.name === 'bindVertexArrayOES' && c.args[0] === null,
    );
    expect(unbind).toBeGreaterThanOrEqual(0);
  });
});

describe('WebGL1SimBackend — context loss', () => {
  it('keeps simulating while lost, then rebuilds and draws the same particles', () => {
    const { b, gl } = backend();
    frame(b);
    const programs = gl.count('createProgram');
    gl.lose();
    const drawsBefore = gl.count('drawElementsInstancedANGLE');
    frame(b);
    expect(gl.count('drawElementsInstancedANGLE')).toBe(drawsBefore); // nothing drawn while lost
    const aliveWhileLost = b.sim.aliveCount();
    expect(aliveWhileLost).toBe(8);
    const extAsks = gl.calls.filter(
      (c) => c.name === 'getExtension' && c.args[0] === 'ANGLE_instanced_arrays',
    ).length;
    gl.restore();
    frame(b);
    expect(gl.count('createProgram')).toBe(programs + 1);
    // extension objects die with the old context, so they are fetched again
    expect(
      gl.calls.filter((c) => c.name === 'getExtension' && c.args[0] === 'ANGLE_instanced_arrays')
        .length,
    ).toBe(extAsks + 1);
    expect(gl.count('drawElementsInstancedANGLE')).toBe(drawsBefore + 1);
  });

  it('stops listening after destroy', () => {
    const { b, gl } = backend();
    b.destroy();
    const programs = gl.count('createProgram');
    gl.restore();
    frame(b);
    expect(gl.count('createProgram')).toBe(programs);
  });
});

describe('WebGL1SimBackend — degraded hosts and graphs', () => {
  it('warns and draws nothing without ANGLE_instanced_arrays, instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { b, gl } = backend({ gl: fakeGl({ instancing: false }) });
    frame(b);
    expect(gl.count('drawElementsInstancedANGLE')).toBe(0);
    expect(b.stats.aliveCount).toBe(8); // it still simulates
    expect(warn.mock.calls.some((c) => String(c[0]).includes('ANGLE_instanced_arrays'))).toBe(true);
  });

  it('warns once about nodes the CPU simulation does not run', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sys = system({
      id: 'sys-unsupported',
      graph: { nodes: [{ id: 'n1', kind: 'compiled.onlyHere', inputs: {} } as never], edges: [] },
    });
    backend({ system: sys });
    backend({ system: sys });
    const hits = warn.mock.calls.filter((c) => String(c[0]).includes('n1'));
    expect(hits).toHaveLength(1);
  });
});

describe('WebGL1SimBackend — seeds', () => {
  const seeds = (b: { sim: CpuSim }) =>
    Array.from({ length: b.sim.capacity }, (_, i) => b.sim.state[i * CPU_STATE_FLOATS + 6]);

  it('gives two unseeded views of one system different particles', () => {
    const one = backend().b;
    const two = backend().b;
    frame(one);
    frame(two);
    expect(seeds(one)).not.toEqual(seeds(two));
  });

  it('repeats exactly with the same explicit seed', () => {
    const one = backend({ seed: 42 }).b;
    const two = backend({ seed: 42 }).b;
    frame(one);
    frame(two);
    expect(seeds(one)).toEqual(seeds(two));
  });
});

describe('WebGL1SimBackend — apply', () => {
  const project = (sys: System) => ({ params: [], systems: [sys] }) as unknown as PylinkaProject;

  it('takes a change that fits the pool', () => {
    const { b } = backend();
    expect(b.apply(project(system({ emitter: { mode: 'flow', rate: 5 } })))).toBe(true);
  });

  it('refuses a capacity change and keeps running as before', () => {
    const { b } = backend();
    frame(b);
    expect(b.apply(project(system({ capacity: 64 })))).toBe(false);
    frame(b);
    expect(b.sim.capacity).toBe(8);
    expect(b.stats.aliveCount).toBe(8);
  });

  it('needs a WebGL1 parent for a sub-emitter', () => {
    expect(() => backend({ subParent: {} as SimBackend })).toThrow(/WebGL1 backend too/);
  });

  it('never spawns a child from the emitter window', () => {
    const parent = backend().b;
    const child = backend({ subParent: parent, system: system({ id: 'c', name: 'c' }) }).b;
    child.prepare(0.1);
    child.simulate();
    expect(child.sim.aliveCount()).toBe(0); // parent has not stepped: no events
  });
});

describe('createParticles (standalone) — context choice', () => {
  const project = {
    format: 'pylinka/v1',
    version: 1,
    catalogVersion: 1,
    params: [],
    systems: [system()],
  } as unknown as PylinkaProject;

  it('falls back to a WebGL1 context when the canvas has no WebGL2, and draws on the CPU path', () => {
    const fake = fakeGl();
    const asked: string[] = [];
    const canvas = {
      getContext: (type: string) => {
        asked.push(type);
        return type === 'webgl2' ? null : fake.gl;
      },
    } as unknown as HTMLCanvasElement;
    const h = createParticles(canvas, project);
    h.update(0.05);
    expect(asked).toEqual(['webgl2', 'webgl']);
    expect(fake.count('drawElementsInstancedANGLE')).toBe(1);
    expect(h.aliveCount()).toBeGreaterThan(0);
    h.destroy();
  });

  it("runs simulation: 'cpu' on a WebGL2 context, and refuses a child on the other backend", () => {
    class FakeWebGL2 {}
    vi.stubGlobal('WebGL2RenderingContext', FakeWebGL2);
    try {
      const fake = fakeGl({ proto: FakeWebGL2.prototype });
      const gl = fake.gl as unknown as WebGL2RenderingContext;
      const parent = createParticles(gl, project, { simulation: 'cpu' });
      parent.update(0.05);
      expect(fake.count('drawElementsInstanced')).toBe(1); // native WebGL2 instancing
      expect(fake.count('drawElementsInstancedANGLE')).toBe(0);
      expect(() =>
        createParticles(gl, project, { subParent: parent, systemName: 'sparks' }),
      ).toThrow(/different simulation backend/);
      parent.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
