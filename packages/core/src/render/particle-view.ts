/**
 * ParticleView — the pixi v8 renderable (REQUIREMENTS.md §7.3, docs/SPIKE-RESULTS
 * "S2"). A ViewContainer subclass, so it lives in the scene graph and gets
 * z-interleaving, culling, and transforms for free. Its `renderPipeId` routes it
 * to PylinkaRenderPipe; its `worldTransform` is read there to build the render
 * transform. Add it to a STATIC layer and drive the emitter via the uniform —
 * never reparent it onto a moving sprite (§7.3 anti-pattern).
 */
import { ViewContainer, type ViewContainerOptions } from 'pixi.js';
import type { SimBackend } from './sim.js';

export class ParticleView extends ViewContainer {
  public override readonly renderPipeId = 'pylinka';
  public batched = false;

  /** GPU simulation for this system; undefined until a backend is registered. */
  public sim: SimBackend | undefined;

  constructor(options: ViewContainerOptions = {}) {
    super(options);
  }

  protected updateBounds(): void {
    // World-space particles have no meaningful local bounds; keep an empty box so
    // the view is not culled by its own extent. Culling is host-driven via
    // `visible`/`enabled` (§13.13 — no GPU AABBs in v1).
    this._bounds.clear();
  }
}
