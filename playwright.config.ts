import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: `/tmp/bazak-playwright-artifacts-${process.pid}`,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3310',
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3310',
    url: 'http://127.0.0.1:3310',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      BAZAK_DATABASE_PATH: `/tmp/bazak-playwright-commerce-${process.pid}.sqlite`,
      LLM_PROVIDER: 'disabled',
      NEXT_DIST_DIR: `.next-playwright-${process.pid}`,
    },
  },
});
