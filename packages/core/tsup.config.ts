import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/render/index.ts',
    'src/webgl/index.ts',
    'src/webgpu/index.ts',
    'src/webgl2/index.ts',
    'src/gpu/index.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: ['pixi.js'],
});
