/**
 * PylinkaRenderPipe — the custom render pass (docs/SPIKE-RESULTS "S2", §13.8,
 * §13.11). Registered for both WebGL and WebGPU renderers; `execute()` runs the
 * per-frame emit/update dispatch and the single instanced draw, using the view's
 * world transform. The GPU work is delegated to the view's SimBackend, which is
 * gated on the M1.0 spike — until one is registered, execute is a no-op.
 *
 * Unlike the Neutrino reference (which batches CPU quads), pylinka does its own
 * instanced draw straight from the sim buffers — no batcher.
 */
import { ExtensionType, type InstructionSet, type Renderer, type RenderPipe } from 'pixi.js';
import { ParticleView } from './particle-view.js';

export class PylinkaRenderPipe implements RenderPipe<ParticleView> {
  public static extension = {
    type: [ExtensionType.WebGLPipes, ExtensionType.WebGPUPipes],
    name: 'pylinka',
  } as const;

  /** Held for the GPU implementation (command encoder / GL context). */
  private readonly renderer: Renderer;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
  }

  /** Build phase: enqueue this view as an instruction so execute() runs for it. */
  addRenderable(view: ParticleView, instructionSet: InstructionSet): void {
    instructionSet.add(view);
  }

  /** Values are uniform-driven, so a reused instruction needs no rebuild. */
  updateRenderable(): void {
    // no-op: uniforms are flushed in execute()
  }

  destroyRenderable(view: ParticleView): void {
    view.sim?.destroy();
  }

  /** Reuse the instruction set across frames (structure is stable per graph hash). */
  validateRenderable(): boolean {
    return false;
  }

  /** Draw phase (InstructionPipe.execute): dispatch + instanced draw. */
  execute(view: ParticleView): void {
    const sim = view.sim;
    if (sim === undefined) return; // GPU backend not registered (M1.0 spike pending)
    void this.renderer; // the backend uses the renderer's encoder/context
    sim.simulate();
    sim.draw(view.worldTransform);
  }
}
