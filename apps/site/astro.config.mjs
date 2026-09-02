// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://pylinka.schmooky.dev',
  server: { port: 5212 },
  trailingSlash: 'ignore',
  integrations: [
    react(),
    // /capture and /editor are app pages, not content — keep them out of search.
    sitemap({ filter: (page) => !/\/(capture|editor)\/?$/.test(page) }),
  ],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      /*
       * Pre-bundle the editor's heavy dependencies up front instead of letting
       * Vite discover them.
       *
       * The editor imports pixi from a module the dev server only reaches once
       * you pick a compiled backend, and pixi loads its RENDERERS dynamically
       * on top of that. Discovering a dependency mid-session re-runs the
       * optimizer and changes the `?v=` hash on every pre-bundled chunk, so the
       * page's in-flight dynamic import 404s: "Failed to fetch dynamically
       * imported module .../WebGPURenderer-*.js", or a 504 "Outdated Optimize
       * Dep". Naming them here means they are bundled before the first request
       * and the hash never moves under a running page.
       */
      include: ['pixi.js', 'lucide-react', '@xyflow/react', 'zustand', 'driver.js'],
    },
  },
});
