import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/features/house-scanner',
  testMatch: '**/*.browser.ts',
  outputDir: '.browser-test-results',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.HOUSE_SCANNER_BROWSER_URL ?? 'http://localhost:5183',
    channel: 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'narrow',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer: process.env.HOUSE_SCANNER_BROWSER_URL
    ? undefined
    : {
        command: 'npm run dev -- --port 5183 --strictPort',
        url: 'http://localhost:5183/projects/house-scanner',
        reuseExistingServer: !process.env.CI,
      },
});
