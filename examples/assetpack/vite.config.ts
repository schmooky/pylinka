import { defineConfig } from 'vite';

// publicDir defaults to ./public — where AssetPack writes the processed textures
// and manifest.json. esnext so top-level `await` works in the bundle.
export default defineConfig({
  build: { target: 'esnext' },
});
