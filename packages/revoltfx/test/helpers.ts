import { readFileSync } from 'node:fs';
import type { RfxBundle, SheetData } from '../src/index.js';

/** The official RevoltFX example bundle (bma73/revolt-fx-examples, MIT). */
export const bundle = JSON.parse(readFileSync(new URL('./fixtures/default-bundle.json', import.meta.url), 'utf8')) as RfxBundle;
/** The spritesheet that bundle plays with. */
export const sheet = JSON.parse(readFileSync(new URL('./fixtures/revoltfx-spritesheet.json', import.meta.url), 'utf8')) as SheetData;

export const NOW = '2026-01-01T00:00:00.000Z';

export function emitterNamed(name: string) {
  const e = bundle.emitters.find((x) => x.name === name);
  if (!e) throw new Error(`fixture has no emitter ${name}`);
  return e;
}
