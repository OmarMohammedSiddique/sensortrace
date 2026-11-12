import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end browser tests. They drive the real product through the real UI against a running
 * stack (web + API + worker); nothing is mocked. Start the stack first, then `npm run test:e2e`.
 *
 * Every spec file registers its own fresh account, so runs are independent of each other. One
 * full run makes 12 registration/sign-in requests, and the API allows 20 per 15 minutes per client
 * address (`ST_RATE_AUTH_PER_15MIN`): a second run inside the same window is refused with "Too
 * many requests". Wait for the window to pass, or raise that setting on a stack used for testing.
 */
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  // Fingerprint and comparison jobs take 10-60 s each, and the core journey chains several.
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
