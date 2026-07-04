import { defineConfig, devices } from "@playwright/experimental-ct-react";
import react from "@vitejs/plugin-react";

/**
 * Component-level visual regression.
 *
 * Separate from the page-level e2e config (playwright.config.ts). Renders
 * individual React components in isolation with mock props — deterministic
 * (no backend, no live data, no clock), so it can screenshot the very
 * components where UI polish escapes live (e.g. CustomSelect, the mobile
 * access-level selector that once overflowed). This is the backend-free
 * realization of "authenticated-screen VR": those screens are built from
 * these components, and a component-level diff is what catches the class of
 * bug the audit flagged.
 *
 * Baselines are platform-scoped (…-darwin/-linux.png), same as the page VR.
 * Run: `npm run test:ct` (compare) / `npm run test:ct:update` (accept).
 */
export default defineConfig({
  testDir: "./components",
  testMatch: /.*\.ct\.spec\.tsx$/,
  snapshotDir: "./__ct-snapshots__",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" },
  },
  use: {
    ctPort: 3200,
    ctViteConfig: {
      // @vitejs/plugin-react targets a newer Vite than Playwright CT bundles,
      // so its plugin type doesn't line up with ctViteConfig's — the plugin
      // works at runtime (tests pass), so cast past the cosmetic mismatch.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      plugins: [react() as any],
      // `@` → repo root (matches tsconfig "@/*": ["./*"]). process.cwd() is
      // the repo root when run via the npm script.
      resolve: { alias: { "@": process.cwd() } },
    },
  },
  projects: [
    { name: "ct-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "ct-mobile", use: { ...devices["Pixel 7"] } },
  ],
});
