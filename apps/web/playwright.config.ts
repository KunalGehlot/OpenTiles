import { defineConfig, devices } from '@playwright/test';

// End-to-end tests on all three engines (PLAN.md P1-26). WebKit catches most Safari problems
// early; real iPads are still checked before each release.
// PW_CHROMIUM_PATH lets sandboxes with a preinstalled Chromium skip the browser download.
const chromiumPath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { VITE_SHOW_UNVERIFIED: '1' },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
          ...(chromiumPath ? { executablePath: chromiumPath } : {}),
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'ipad', use: { ...devices['iPad (gen 7) landscape'], browserName: 'webkit' } },
  ],
});
