import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    // Use the installed, signed browser on Windows; no Application Control changes needed.
    channel: process.platform === 'win32' ? 'msedge' : 'chromium',
    trace: 'retain-on-failure',
  },
});
