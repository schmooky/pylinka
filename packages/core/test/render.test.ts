import { describe, expect, it } from 'vitest';
import { RendererType } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import {
  getSimBackendFactory,
  registerSimBackend,
  resolveBackend,
} from '../src/render/index.js';
import type { SimBackend } from '../src/render/index.js';

describe('resolveBackend — §7.2 (backend follows host)', () => {
  it('shares the device for a WebGPU renderer', () => {
    const device = { fake: 'GPUDevice' };
    const renderer = { type: RendererType.WEBGPU, gpu: { device } } as unknown as Renderer;
    const b = resolveBackend(renderer);
    expect(b.kind).toBe('webgpu');
    expect(b.device).toBe(device);
  });

  it('selects the WebGL2 backend for a WebGL renderer, sharing its context', () => {
    const gl = { fake: 'WebGL2RenderingContext' };
    const renderer = { type: RendererType.WEBGL, gl } as unknown as Renderer;
    const b = resolveBackend(renderer);
    expect(b.kind).toBe('webgl2');
    expect(b.device).toBe(gl);
  });
});

describe('SimBackend registry — GPU seam', () => {
  it('registers and retrieves per-kind backend factories', () => {
    const factory = () => ({}) as unknown as SimBackend;
    registerSimBackend('webgpu', factory);
    expect(getSimBackendFactory('webgpu')).toBe(factory);
  });

  it('the built-in compiled backends self-register for both kinds', async () => {
    const { registerCompiledBackends } = await import('../src/render/index.js');
    registerCompiledBackends();
    expect(getSimBackendFactory('webgpu')).toBeDefined();
    expect(getSimBackendFactory('webgl2')).toBeDefined();
  });
});
