import { defineConfig } from 'vite';

// esnext for modern output; the interaction lab uses no external assets.
export default defineConfig({ build: { target: 'esnext' } });
