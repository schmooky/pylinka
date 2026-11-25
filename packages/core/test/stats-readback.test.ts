/**
 * CreateOptions.stats: false must switch off the GPU particle-count readback.
 * On WebGL2 that readback is a synchronous getBufferSubData every 30 frames,
 * which stalls the pipeline, so production builds need a way to skip it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimBackendDeps } from '../src/render/index.js';

const calls = { aliveCount: 0, encodeStats: 0 };

vi.mock('../src/webgl2/engine.js', () => ({
  WebGL2CompiledSim: class {
    clock = { ex: 0, ey: 0, spawnBurst: () => undefined };
    stats = { aliveCount: 0, overflowCount: 0, gpuMs: null };
    step(): void {}
    aliveCount(): number {
      calls.aliveCount++;
      return 0;
    }
  },
}));

vi.mock('../src/webgpu/engine.js', () => ({
  WebGPUSystemSim: class {
    clock = { ex: 0, ey: 0, spawnBurst: () => undefined };
    stats = { aliveCount: 0, overflowCount: 0, gpuMs: null };
    prepare(): void {}
    encodeCompute(): void {}
    maybeEncodeStats(): boolean {
      calls.encodeStats++;
      return false;
    }
    resolveStats(): void {}
    endFrame(): void {}
  },
}));

const { getSimBackendFactory, registerCompiledBackends } = await import('../src/render/index.js');

function deps(kind: 'webgl2' | 'webgpu', stats?: boolean): SimBackendDeps {
  const renderer = { resetState: () => undefined, gl: {} };
  const device = { createCommandEncoder: () => ({ finish: () => ({}) }), queue: { submit: () => undefined } };
  return {
    backend: kind,
    device,
    renderer,
    system: {} as never,
    params: [],
    knobs: {} as never,
    ...(stats !== undefined ? { stats } : {}),
  };
}

function run(kind: 'webgl2' | 'webgpu', stats: boolean | undefined, frames: number): void {
  registerCompiledBackends();
  const sim = getSimBackendFactory(kind)!(deps(kind, stats));
  for (let i = 0; i < frames; i++) {
    sim.prepare(1 / 60);
    sim.simulate();
  }
}

describe('stats readback opt-out', () => {
  beforeEach(() => {
    calls.aliveCount = 0;
    calls.encodeStats = 0;
  });

  it('WebGL2 reads aliveCount back every 30 frames by default', () => {
    run('webgl2', undefined, 90);
    expect(calls.aliveCount).toBe(3);
  });

  it('WebGL2 never reads back with stats: false', () => {
    run('webgl2', false, 90);
    expect(calls.aliveCount).toBe(0);
  });

  it('WebGPU never encodes the counter copy with stats: false', () => {
    run('webgpu', undefined, 5);
    expect(calls.encodeStats).toBe(5);
    calls.encodeStats = 0;
    run('webgpu', false, 5);
    expect(calls.encodeStats).toBe(0);
  });
});
