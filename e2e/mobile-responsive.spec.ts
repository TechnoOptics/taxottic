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
});
