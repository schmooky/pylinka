/**
 * BackendProvider (REQUIREMENTS.md §7.2). The backend follows the host renderer:
 * a WebGPU renderer shares its device; a WebGL renderer uses the WebGL2
 * transform-feedback backend in the same GL context (M2). Device is left opaque
 * here — it is handed to the SimBackend factory.
 */
import { RendererType, type Renderer, type WebGPURenderer } from 'pixi.js';

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
  // WebGL host → WebGL2 TF backend in the same GL context (M2).
  return { kind: 'webgl2', device: undefined };
}
