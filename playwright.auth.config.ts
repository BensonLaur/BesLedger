import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: '**/auth.spec.ts',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4174/BesLedger/' },
  webServer: {
    command: 'npm run dev -- --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/BesLedger/',
    env: {
      VITE_AUTH_SERVICE: 'https://oauth-fixture.invalid',
      VITE_GITHUB_APP_ID: '7',
      VITE_GITHUB_APP_CLIENT_ID: 'Iv1.fictional',
      VITE_GITHUB_APP_SLUG: 'besledger-fixture',
    },
    reuseExistingServer: false,
  },
});
