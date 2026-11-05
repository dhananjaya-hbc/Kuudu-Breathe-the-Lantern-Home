import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

// Main: dependencies (including the SDK's native runtime) are externalized by
// default, so the SDK loads from node_modules at runtime.
//
// Preload: runs sandboxed, where `require` can only load 'electron'. So the
// SmartSpectra preload is bundled into ours instead of being externalized.
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
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
