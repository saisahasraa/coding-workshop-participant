import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a running stack (locally: `./bin/start-dev.sh`, then `./bin/run-e2e.sh`).
 * They share one database, so they run one at a time and clean up what they create.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
