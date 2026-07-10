/**
 * Extension registration (docs/SPIKE-RESULTS "S2"). Call registerPylinka() once
 * before creating systems; it wires the Application plugin and the render pipe
 * into pixi via the extensions system.
 */
import { extensions } from 'pixi.js';
import { PylinkaApplicationPlugin } from './plugin.js';
import { PylinkaRenderPipe } from './pipe.js';

export function registerPylinka(): void {
  extensions.add(PylinkaApplicationPlugin, PylinkaRenderPipe);
}

export function unregisterPylinka(): void {
  extensions.remove(PylinkaApplicationPlugin, PylinkaRenderPipe);
}
