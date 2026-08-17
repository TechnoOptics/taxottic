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
  expect: {
    timeout: 10_000,
    // Visual-regression tolerance, in TWO independent dimensions.
    //
    // maxDiffPixelRatio bounds HOW MANY pixels may differ. threshold
    // bounds HOW MUCH a single pixel may differ before it is counted at
    // all: Playwright hands it to pixelmatch, which rejects a pixel only
    // when its YIQ colour distance exceeds 35215 * threshold^2.
    //
    // The default threshold of 0.2 is a cutoff of 1408, and that is not a
    // tolerance, it is a blindfold. The Instrument skin moved the page
    // ground from cream #fbf7e9 to cool paper #f2f5f8: a YIQ distance of
    // 32.97, or 2.3% of the default cutoff. Measured, not reasoned about:
    // a page painted entirely in the new colour compared EQUAL to an
    // all-cream baseline, zero pixels reported different. The suite would
    // have passed a full revert of the redesign.
    //
    // 0.02 is a cutoff of 14.09: sharp enough to see the 32.97 case with
    // 2.3x of margin. Chosen against a MEASURED noise floor, not taste.
    //
    // The floor was measured where it matters, on the ubuntu-latest image
    // the `visual` job compares on, by rendering both suites five times
    // from identical code and diffing the runs against each other. Result:
    // all 16 page snapshots and all 14 component snapshots byte-identical
    // across every run, and byte-identical to the committed *-linux.png
    // baselines. Zero differing pixels, so on CI this costs nothing and
    // any threshold would be safe. macOS is not quite zero — five local
    // runs moved one snapshot (compare-hub mobile, the Next dev-tools
    // badge failing to paint once), which counts 0.43% of that page at
    // this threshold against the 1% budget above, versus 0.26% at the
    // default.
    //
    // Why not go lower, given a zero floor. Because a floor measured today
    // is not a guarantee: the runner image and the bundled Chromium both
    // move, and 0.005 already takes that same macOS page to 0.78%. Below
    // ~14 there is nothing left to catch in this class either — a design
    // token never moves by less than a few levels per channel — so the
    // extra sensitivity would buy only exposure to future rasterisation
    // drift.
    //
    // Guarded by lib/visual/screenshot-threshold.test.ts, which re-derives
    // the cream-vs-paper distance and fails if this value stops catching
    // it. Backed up by e2e/ground-colour.spec.ts, which asserts the ground
    // exactly and does not depend on this number at all.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.02,
      animations: "disabled",
    },
  },
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
    // Functional e2e — everything EXCEPT the visual-regression spec, which
    // has its own opt-in projects below.
    {
      name: "chromium",
      testIgnore: /visual\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      testIgnore: /visual\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    // Visual regression (opt-in via `npm run e2e:visual`). Kept out of the
    // default run because screenshot baselines are OS/font-rendering
    // specific — regenerate them on the platform you compare on.
    {
      name: "visual-desktop",
      testMatch: /visual\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "visual-mobile",
      testMatch: /visual\.spec\.ts/,
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
