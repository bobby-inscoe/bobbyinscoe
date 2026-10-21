import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/features/basket',
  testMatch: '**/*.browser.ts',
  outputDir: '.browser-test-results/basket',
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:5191',
    channel: 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
    { name: 'desktop', use: { viewport: { width: 1200, height: 900 } } },
  ],
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js --host localhost --port 5191 --strictPort',
    url: 'http://localhost:5191/basket',
    reuseExistingServer: false,
    env: {
      VITE_BASKET_EMAIL_ENABLED: 'true',
      VITE_BASKET_SUPABASE_URL: 'http://127.0.0.1:54331',
      VITE_BASKET_SUPABASE_PUBLISHABLE_KEY:
        'sb_publishable_basket_browser_test_only_123456789',
    },
  },
});
