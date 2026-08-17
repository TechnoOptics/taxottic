import { test, expect } from "@playwright/test";
import { PUBLIC_PAGES } from "./public-pages";

/**
 * The page ground, asserted exactly, because a pixel diff is the wrong
 * instrument for measuring a colour.
 *
 * Playwright scores a pixel by YIQ distance and ignores anything under
 * `35215 * threshold^2`. Cream #fbf7e9 and cool paper #f2f5f8 sit 32.97
 * apart. At Playwright's default threshold of 0.2 the cutoff is 1408, so
 * the entire Instrument repaint was invisible: reverting both ground
 * tokens and re-running the visual suite against the current baselines
 * produced ZERO mismatched pixels on all sixteen snapshots. Every page was
 * the wrong colour and the gate said nothing.
 *
 * playwright.config.ts now carries a threshold sharp enough to see that
 * particular pair (same experiment, same baselines: all sixteen fail, 25%
 * to 85% of pixels flagged). But that threshold is set against a measured
 * noise floor, so it can only ever be as sharp as the noisiest snapshot
 * allows, and the next palette move could be a smaller step than this one.
 * A gate whose sensitivity is bounded by rendering noise should not be the
 * only thing standing between a silent repaint and production.
 *
 * `getComputedStyle` has no such bound. It reports the resolved colour, so
 * the comparison is string equality: exact, instant, immune to
 * anti-aliasing, font rasterisation, image decode timing and the host OS,
 * and needing no baseline file that could go stale. It runs in the default
 * `npm run e2e` projects, which CI already gates on every PR.
 *
 * TWO tokens, because the ground reaches pixels by two different routes
 * and they are not interchangeable. Measured on /pricing desktop:
 *
 *   --color-cream   what the ground utilities paint. Moving this alone
 *                   moved 61% of the page's pixels (84% on the guide).
 *                   This is the visible ground.
 *   --background    what <body> paints under those utilities. Moving this
 *                   alone moved almost nothing on the marketing pages, so
 *                   it is NOT a substitute for the above, but it is the
 *                   token the rest of the app's surfaces are built on.
 *
 * app/globals.css explains why they are separate: Tailwind's `@theme
 * inline` bakes token values into the generated utilities, so `--color-cream`
 * is the one literal the skin has to redefine by hand. That same inlining
 * once left the token and the painted background disagreeing, which is why
 * the painted value is checked too rather than trusting the token alone.
 *
 * A deliberate palette change updates the three constants below, and that
 * one-line-each diff is the point: it makes a ground repaint an explicit
 * decision on the record instead of something the gate silently absorbs.
 */

/** app/globals.css, [data-skin="instrument"]. */
const GROUND_TOKEN = "#f2f5f8";
const GROUND_UTILITY_TOKEN = "#f2f5f8";
const GROUND_PAINTED = "rgb(242, 245, 248)";

for (const p of PUBLIC_PAGES) {
  test(`ground colour: ${p.name}`, async ({ page }) => {
    await page.goto(p.path);
    const ground = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return {
        token: style.getPropertyValue("--background").trim(),
        utilityToken: style.getPropertyValue("--color-cream").trim(),
        painted: style.backgroundColor,
      };
    });
    expect(ground.utilityToken).toBe(GROUND_UTILITY_TOKEN);
    expect(ground.token).toBe(GROUND_TOKEN);
    expect(ground.painted).toBe(GROUND_PAINTED);
  });
}
