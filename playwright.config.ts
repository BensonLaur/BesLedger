import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: '**/auth.spec.ts',
  timeout: 45000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4173/BesLedger/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'msedge' } },
    { name: 'android-layout', use: { ...devices['Pixel 7'], channel: 'msedge' } },
    { name: 'ipad-webkit', use: { ...devices['iPad (gen 7)'], defaultBrowserType: 'webkit' } },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173',
    url: 'http://127.0.0.1:4173/BesLedger/',
    reuseExistingServer: true,
  },
});
