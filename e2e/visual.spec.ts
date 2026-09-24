import { test, expect } from "@playwright/test";
import { PUBLIC_PAGES } from "./public-pages";

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

/**
 * The app-download banner is `position: fixed` to the bottom of the
 * VIEWPORT, and it mounts from an effect that reads localStorage.
 *
 * A fullPage screenshot is stitched by scrolling, so a fixed element
 * lands wherever the viewport happened to be when its strip was
 * captured. On the home page that put the banner over the instrument
 * panel on some runs and in its resting place on others: the same page,
 * two legitimate images. That is the ~3% intermittent home diff PR 1
 * recorded as failing 2 of 4 CI runs and could not explain, and it was
 * always going to be unexplainable from the pass/fail alone.
 *
 * Dismissing it before the first paint is the honest fix rather than
 * masking a rectangle: it is exactly the state of a reader who has
 * closed the banner once, the component then returns null, and nothing
 * fixed is left on the page to float.
 */
const BANNER_DISMISS_KEY = "taxottic-app-banner-dismissed-v1";

for (const p of PUBLIC_PAGES) {
  test(`visual: ${p.name}`, async ({ page }) => {
    await page.addInitScript((key) => {
      try {
        window.localStorage.setItem(key, "1");
      } catch {
        /* private mode: the banner stays, and so does the flake */
      }
    }, BANNER_DISMISS_KEY);
    await page.goto(p.path, { waitUntil: "networkidle" });
    // Web fonts must be ready or text metrics differ between runs.
    await page.evaluate(() => document.fonts.ready);
    await settleImages(page);
    // The marketing header is deliberately fixed and must stay in the
    // baseline, so this does not forbid fixed positioning outright. The
    // banner was the element that MOVED between runs, because it mounts
    // from an effect rather than being there from the first paint.
    await expect(page).toHaveScreenshot(`${p.name}.png`, {
      fullPage: true,
      // animations:"disabled" (set in playwright.config) also blanks the
      // text caret and freezes transitions, removing the main flake sources.
    });
  });
}

/**
 * Make below-the-fold imagery deterministic before a fullPage screenshot.
 *
 * `fullPage: true` grows the capture to the document height, but that does
 * NOT wait for images the browser deferred. Anything with loading="lazy"
 * below the viewport races the screenshot: the request is often aborted while
 * it is still off-screen, so the same page snapshots with the image present on
 * one run and blank on the next. The home page's four stock photographs were
 * exactly that shape. They are gone (the Year rewrite dropped them, and
 * lib/marketing/year-grammar.test.ts pins that public/marketing does not come
 * back), but the guides and the store badges still carry deferred images, so
 * this stays.
 *
 * So: promote every deferred image to eager, scroll the document once to fire
 * anything gated on intersection, return to the top, and only then wait for
 * each <img> to actually decode. `networkidle` alone is not enough, because
 * the deferred requests have not started when it fires.
 */
async function settleImages(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    for (const img of Array.from(document.querySelectorAll("img"))) {
      img.loading = "eager";
    }
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("img")).every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    null,
    { timeout: 30_000 },
  );

  // `complete` is not enough, and this cost a full CI cycle to find.
  //
  // complete === true means the bytes ARRIVED. It says nothing about the
  // image being decoded and ready to paint, so a screenshot taken right
  // after it can catch a large image mid-decode. The result is a diff
  // with the SAME page height and a couple of percent of pixels changed,
  // which reads like a real regression and is not one.
  //
  // Measured: regenerating baselines twice from identical code produced
  // byte-identical home-mobile snapshots and two DIFFERENT home-desktop
  // snapshots, every compare failing by exactly 201,324 pixels. Desktop
  // is where the hero renders its widest variant (lg:aspect-[2.4/1]), so
  // it is the biggest decode on the page and the only one that lost the
  // race.
  //
  // decode() resolves only once the frame is ready to paint. Awaiting it
  // is the documented way to make that deterministic.
  await page.evaluate(async () => {
    await Promise.all(
      Array.from(document.querySelectorAll("img")).map((img) =>
        // Already-decoded images resolve immediately. A decode can reject
        // if the element is detached mid-flight, which must not fail the
        // run: the waitForFunction above already proved the bytes landed.
        img.decode().catch(() => undefined),
      ),
    );
  });
}
