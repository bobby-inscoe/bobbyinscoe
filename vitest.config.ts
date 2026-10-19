import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@house-scanner-tools': fileURLToPath(
        new URL('./tools/house-scanner', import.meta.url),
      ),
    },
  },
  test: {
    include: [
      'src/**/*.test.{ts,tsx}',
      'tools/**/*.test.ts',
      'supabase/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 30000,
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
});
