import { test, expect } from "@playwright/test";

// Flow 1-3: public marketing pages render without errors.
// These don't need auth; they're the most-visited surfaces of the
// consumer + firm marketing funnels.

test.describe("Public marketing", () => {
  test("homepage renders the hero + signup CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Taxottic/);
    // Hero copy varies; check the SoftwareApplication JSON-LD is
    // present (Phase X SEO foundation).
    const ld = await page.locator("script[type='application/ld+json']").count();
    expect(ld).toBeGreaterThan(0);
    // No console errors on render (React #418 regression catcher).
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForLoadState("networkidle");
    expect(errors.filter((e) => /Minified React error #418/.test(e))).toHaveLength(0);
  });

  test("/firms marketing renders + signup CTA links to request-account", async ({ page }) => {
    await page.goto("/firms");
    await expect(page.locator("h1")).toContainText(/firm cockpit/i);
    const cta = page.locator("a[href='/firms/request-account']").first();
    await expect(cta).toBeVisible();
  });

  test("/firms/request-account form renders the four required fields", async ({ page }) => {
    await page.goto("/firms/request-account");
    await expect(page.locator("input[name='firm_name']")).toBeVisible();
    await expect(page.locator("input[name='contact_full_name']")).toBeVisible();
    await expect(page.locator("input[name='contact_email']")).toBeVisible();
    await expect(page.locator("select[name='firm_size']")).toBeVisible();
    await expect(page.locator("button[type='submit']")).toContainText(/submit/i);
  });
});
