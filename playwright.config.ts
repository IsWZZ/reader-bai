import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  // Electron 实例较重，串行执行；每个测试使用独立的 userData 目录
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure'
  }
})
