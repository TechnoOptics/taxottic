import { test, expect } from "@playwright/test";

/**
 * Visual-regression snapshots.
 *
 * Opt-in — run with `npm run e2e:visual` (compare) / `npm run e2e:visual:update`
 * (accept new baselines). NOT part of the default `npm run e2e`, because
 * screenshot baselines are OS/font-rendering specific and CI doesn't run
 * Playwright yet (see ci.yml — vitest + tsc + lint only).
 *
 * Coverage is the DETERMINISTIC public surface: marketing pages and the
 * calculators in their empty state. Two reasons this is the right target:
 *   1. Stability — no auth, no live forecast numbers or "updated Xm ago"
 *      timestamps, so screenshots are identical run-to-run.
 *   2. Reach — these pages render the same component library (CustomSelect,
 *      inputs, cards, buttons, the header) as the authenticated forms, so a
 *      CSS/layout regression (e.g. a select overflowing its container on
 *      mobile — an actual bug this suite would have caught) surfaces here.
 *
 * Authenticated screens are a deliberate follow-up: they need a seeded,
 * frozen dataset + a working auth session (e2e/auth.setup.ts is currently
 * empty) + masking of live values before their screenshots are stable.
 */

const PAGES: { name: string; path: string }[] = [
  { name: "home", path: "/" },
  { name: "pricing", path: "/pricing" },
  { name: "calculators-hub", path: "/calculators" },
  { name: "calc-self-employment-tax", path: "/calculators/self-employment-tax" },
  { name: "calc-effective-tax-rate", path: "/calculators/effective-tax-rate" },
  { name: "calc-mileage-deduction", path: "/calculators/mileage-deduction" },
  { name: "guide-quarterly", path: "/guides/quarterly-estimated-taxes-explained" },
  { name: "compare-hub", path: "/compare" },
];

for (const p of PAGES) {
  test(`visual: ${p.name}`, async ({ page }) => {
    await page.goto(p.path, { waitUntil: "networkidle" });
    // Web fonts must be ready or text metrics differ between runs.
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${p.name}.png`, {
      fullPage: true,
      // animations:"disabled" (set in playwright.config) also blanks the
      // text caret and freezes transitions, removing the main flake sources.
    });
  });
}
