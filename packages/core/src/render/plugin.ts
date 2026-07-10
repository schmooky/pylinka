/**
 * Application plugin (docs/SPIKE-RESULTS "S2"). Runs after the pixi Application
 * is created, resolves the backend from its renderer, and stashes it on
 * `app.pylinka` for the runtime to use.
 */
import { type Application, ExtensionType, type Renderer } from 'pixi.js';
import { resolveBackend, type ResolvedBackend } from './backend.js';

type PylinkaApp = Application & { pylinka?: ResolvedBackend };

export class PylinkaApplicationPlugin {
  public static extension = {
    type: ExtensionType.Application,
    name: 'pylinka',
  } as const;

  static init(this: Application): void {
    (this as PylinkaApp).pylinka = resolveBackend(this.renderer as Renderer);
  }

  static destroy(this: Application): void {
    (this as PylinkaApp).pylinka = undefined;
  }
}
