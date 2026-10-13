import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'chrome100',
    assetsInlineLimit: 0,
  },
  server: { port: 5180, strictPort: true },
});
