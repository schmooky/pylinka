import { defineConfig } from 'vite';

// Shared VFX textures (one copy for all three examples) + esnext for top-level await.
export default defineConfig({
  publicDir: '../_shared/public',
  build: { target: 'esnext' },
});
