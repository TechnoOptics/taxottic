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
      //
      // next/link + next/navigation are stubbed: the harness mounts client
      // components outside the App Router, where usePathname() throws. The
      // stubs are layout-identical (an <a>, and location.pathname), which is
      // all these tests measure. Without them, nav-bearing components such as
      // LeftRail / UserMenu can't be component-tested at all.
      // NOTE: order matters. The "@" catch-all must come LAST, otherwise it
      // swallows the more specific server-action alias below it.
      resolve: {
        alias: {
          "next/navigation": process.cwd() + "/playwright/next-stubs/navigation.tsx",
          "next/link": process.cwd() + "/playwright/next-stubs/link.tsx",
          // "use server" module: it reaches for the Supabase server client and
          // next/headers, which don't exist under Vite, so LeftRail couldn't
          // mount at all without a stub. The stub records its calls on window
          // so a test can assert when the rail persists the workspace mode.
          "@/app/actions/workspace-mode":
            process.cwd() + "/playwright/next-stubs/workspace-mode-action.ts",
          "@": process.cwd(),
        },
      },
    },
  },
  projects: [
    { name: "ct-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "ct-mobile", use: { ...devices["Pixel 7"] } },
  ],
});
