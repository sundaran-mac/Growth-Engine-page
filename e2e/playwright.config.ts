import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './support/env';

/**
 * Growth Desk end-to-end tests.
 * Default target: the Docker stack (web on http://localhost:8080). Override with E2E_BASE_URL,
 * for example E2E_BASE_URL=http://localhost:5173 against `npm run dev`.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  globalSetup: './support/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // Flows share seed products and settings, so one worker keeps runs predictable.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
