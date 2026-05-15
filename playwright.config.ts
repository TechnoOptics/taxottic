import { defineConfig, devices } from "@playwright/test";

// Playwright E2E config.
//
// Tests live in `e2e/`. `npm run e2e` spins up the Next dev server
// (via the webServer block) and runs the suite against
// http://localhost:3000. CI: set `CI=true` to flip retries +
// disable headed mode.
//
// Test setup:
//   - Auth: tests use a seeded test user via the
//     PLAYWRIGHT_TEST_USER_EMAIL + PLAYWRIGHT_TEST_USER_TOKEN env
//     vars. Without those, auth-gated tests skip themselves
//     (see e2e/auth.setup.ts).
//   - Test data: seed migration `20260514000099_e2e_seed.sql` (NOT
//     applied to production — keyed by an environment flag).
//   - Most tests target public marketing surfaces that don't need
//     auth; those run on every commit.

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
