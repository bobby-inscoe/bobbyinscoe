import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../../src', import.meta.url)) },
  },
  build: {
    ssr: fileURLToPath(new URL('./cli.ts', import.meta.url)),
    outDir: '.house-scanner-build',
    emptyOutDir: false,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'acceptance.mjs' } },
  },
});
