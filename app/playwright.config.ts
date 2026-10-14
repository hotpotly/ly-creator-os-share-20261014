import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
})
