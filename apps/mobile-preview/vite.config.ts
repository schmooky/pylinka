import { defineConfig } from 'vite';

// Relative base so the built app can be hosted at any path, side by side with
// the main site. `server.host` exposes the dev server to phones on the LAN.
export default defineConfig({
  base: './',
  server: { host: true },
  preview: { host: true },
});
