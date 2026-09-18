import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3101";

export default defineConfig({
  testDir: "./tests/e2e/member-web",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  outputDir: ".hermes/evidence/member-web-e2e/test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: ".hermes/evidence/member-web-e2e/report", open: "never" }],
  ],
  use: {
    baseURL,
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chrome",
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["iPhone 13"], browserName: "chromium", channel: "chrome" },
    },
  ],
  webServer: {
    command: "pnpm build:member && pnpm exec next start apps/member-web -p 3101",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
