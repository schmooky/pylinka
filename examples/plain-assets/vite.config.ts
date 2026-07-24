import { defineConfig } from 'vite';

// - esnext so top-level `await` (app.init / Assets.load) works in the bundle.
// - publicDir points at the shared VFX textures, so all three examples serve
//   the same /vfx/… files without copying them three times.
export default defineConfig({
  publicDir: '../_shared/public',
  build: { target: 'esnext' },
});
