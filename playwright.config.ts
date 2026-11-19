// Savutesti tuotantokäännöstä vasten: `vite preview` antaa saman CSP-otsakkeen kuin työaseman palvelin
// (vite.config.ts, testi tests/tyyli.test.ts), /api/* mockataan testissä, selain on järjestelmän Chrome.
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    locale: "fi-FI",
    timezoneId: "Europe/Helsinki",
    // Service worker ohittaisi page.routen; päivityspolkua ei testata tässä.
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "puhelin",
      use: {
        ...devices["Pixel 7"],
        channel: "chrome",
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command:
      "npx vite build --logLevel warn && npx vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
