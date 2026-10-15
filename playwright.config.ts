import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    locale: "fi-FI",
    timezoneId: "Europe/Helsinki",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], viewport: { width: 393, height: 851 } },
    },
  ],
  webServer: {
    command: "node --import tsx tests/e2e/server.ts",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
