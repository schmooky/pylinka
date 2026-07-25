import { defineConfig } from 'vite';

// Shared VFX textures (one copy, also used by plain-assets) + esnext for top-level await.
export default defineConfig({
  publicDir: '../_shared/public',
  build: { target: 'esnext' },
});
