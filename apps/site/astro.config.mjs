// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://pylinka.schmooky.dev',
  server: { port: 5212 },
  vite: {
    plugins: [tailwindcss()],
  },
});
