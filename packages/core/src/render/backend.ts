/**
 * BackendProvider (REQUIREMENTS.md §7.2). The backend follows the host renderer:
 * a WebGPU renderer shares its device; a WebGL2 renderer runs the compiled
 * WebGL2 transform-feedback backend in the same GL context (so scene
 * interleaving works); a WebGL1 renderer (pixi's `preferWebGLVersion: 1`, or a
 * device without WebGL2) gets the CPU simulation with a WebGL1 draw, in the
 * same context. Device is left opaque here — it is handed to the SimBackend
 * factory.
 */
import { RendererType, type Renderer, type WebGLRenderer, type WebGPURenderer } from 'pixi.js';
import type { SimBackendKind } from './sim.js';

export interface ResolvedBackend {
  kind: SimBackendKind;
  /** GPUDevice (webgpu), WebGL2RenderingContext (webgl2) or WebGLRenderingContext (webgl1); opaque to core. */
  device: unknown;
}

export function resolveBackend(renderer: Renderer): ResolvedBackend {
  if (renderer.type === RendererType.WEBGPU) {
    const device: unknown = (renderer as WebGPURenderer).gpu.device;
    return { kind: 'webgpu', device };
  }
  // WebGL host → compiled WebGL2 TF backend in the same GL context, or the CPU
  // simulation when the context is WebGL1 (no transform feedback there).
  const gl = renderer as WebGLRenderer;
  const version = (gl as { context?: { webGLVersion?: number } }).context?.webGLVersion;
  return { kind: version === 1 ? 'webgl1' : 'webgl2', device: gl.gl };
}
