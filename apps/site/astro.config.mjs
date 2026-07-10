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
  },
});
