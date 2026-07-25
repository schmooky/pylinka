import { defineConfig } from 'vite';

// - esnext so top-level `await` (app.init / Assets.load) works in the bundle.
// - publicDir points at the shared VFX textures, so this app and the announcer
//   serve the same /vfx/… files without duplicating them.
export default defineConfig({
  publicDir: '../_shared/public',
  build: { target: 'esnext' },
});
