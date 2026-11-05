import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

// No custom preload: the window uses @smartspectra/node-sdk/preload directly.
// Dependencies (including the SDK's native runtime) are externalized from the
// main bundle by default, so the SDK loads from node_modules at runtime.
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
});
