/**
 * BackendProvider (REQUIREMENTS.md §7.2). The backend follows the host renderer:
 * a WebGPU renderer shares its device; a WebGL renderer runs the compiled
 * WebGL2 transform-feedback backend in the same GL context (so scene
 * interleaving works). Device is left opaque here — it is handed to the
 * SimBackend factory.
 */
import { RendererType, type Renderer, type WebGLRenderer, type WebGPURenderer } from 'pixi.js';

export interface ResolvedBackend {
  kind: 'webgpu' | 'webgl2';
  /** GPUDevice (webgpu) or WebGL2RenderingContext (webgl2); opaque to core. */
  device: unknown;
}

export function resolveBackend(renderer: Renderer): ResolvedBackend {
  if (renderer.type === RendererType.WEBGPU) {
    const device: unknown = (renderer as WebGPURenderer).gpu.device;
    return { kind: 'webgpu', device };
  }
  // WebGL host → compiled WebGL2 TF backend in the same GL context.
  return { kind: 'webgl2', device: (renderer as WebGLRenderer).gl };
}
