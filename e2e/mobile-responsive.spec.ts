import { test, expect } from "@playwright/test";

// Flow 6: mobile-responsive sanity check on the highest-traffic
// pages. The Round-5 audit reported the app wasn't mobile-responsive;
// the responsive sweep moved every page-wrapper from `px-6` to
// `px-4 sm:px-6`. This test pins that fix.
//
// We run in the `mobile-chrome` project (Pixel 7 viewport).
test.describe("Mobile responsive", () => {
  test("homepage has no horizontal overflow at mobile width", async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 500, "mobile-only");
    await page.goto("/");
    // The body shouldn't be wider than the viewport — no horizontal scrollbar.
    const overflow = await page.evaluate(() => {
      return document.body.scrollWidth - window.innerWidth;
    });
    // Allow up to 1px rounding tolerance.
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("/firms marketing fits mobile viewport", async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 500, "mobile-only");
    await page.goto("/firms");
    const overflow = await page.evaluate(() => {
      return document.body.scrollWidth - window.innerWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("/firms/request-account form is usable on mobile", async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 500, "mobile-only");
    await page.goto("/firms/request-account");
    await expect(page.locator("input[name='firm_name']")).toBeVisible();
    await expect(page.locator("input[name='contact_email']")).toBeVisible();
    // Submit button is clickable (no overlap with another element).
    const btn = page.locator("button[type='submit']").first();
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box?.width).toBeGreaterThan(80);
    expect(box?.height).toBeGreaterThan(32);
  });

  test("the sample page header at 344: the wordmark and Sign in never touch, and Sign in is 44px tall", async ({ page }) => {
    await page.setViewportSize({ width: 344, height: 700 });
    await page.goto("/example");
    const signInLocator = page.locator('header a[href="/login"]').first();
    // On the mobile-chrome project the header can be measured (0,0,0,0)
    // a beat before layout settles; wait for the actionable element
    // rather than racing the first paint.
    await expect(signInLocator).toBeVisible();
    const mark = await page.locator("header a").first().boundingBox();
    const signIn = await signInLocator.boundingBox();
    expect(mark && signIn && signIn.x - (mark.x + mark.width)).toBeGreaterThanOrEqual(8);
    expect(signIn?.height).toBeGreaterThanOrEqual(44);
    // The wordmark is a link home, so it is a tap target too.
    expect(mark?.height, "the wordmark link is 44px tall").toBeGreaterThanOrEqual(44);
  });

  test("every footer link is a 44px row at 344", async ({ page }) => {
    // The marketing footer is the densest stack of links on the site and
    // the audits' I5 named it: 16px rows at the bottom of a phone screen.
    // The footer lives on the home page (components/marketing/MarketingFooter.tsx);
    // the sample page has none.
    await page.setViewportSize({ width: 344, height: 700 });
    await page.goto("/");
    const footer = page.locator("footer");
    await expect(footer.first()).toBeVisible();
    const short = await footer.locator("a").evaluateAll((els) =>
      els
        .filter((e) => e.getBoundingClientRect().height < 44)
        .map((e) => `${(e as HTMLElement).innerText.trim() || (e as HTMLElement).getAttribute("aria-label")}: ${e.getBoundingClientRect().height}`),
    );
    expect(short, "every footer link is at least 44px tall").toEqual([]);
    const count = await footer.locator("a").count();
    expect(count, "the footer links are actually there to measure").toBeGreaterThan(10);
  });
});
