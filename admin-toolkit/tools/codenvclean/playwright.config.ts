import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  use: {
    headless: true,
    baseURL: 'http://localhost:10000',
    viewport: { width: 1400, height: 900 },
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
});
