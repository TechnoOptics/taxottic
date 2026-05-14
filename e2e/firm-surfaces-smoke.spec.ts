import { test, expect } from "@playwright/test";

// Smoke tests for the firm-side surfaces shipped in Tiers 2–4.
//
// These routes are auth-gated, so an unauthenticated visit must
// redirect to /login (with a `?next=` parameter that lets the user
// land back where they were trying to go). This catches three
// common regressions cheaply:
//   1. A bad import that 500s the route (we'd see a 500, not a 302).
//   2. A missing `dynamic = "force-dynamic"` that causes static-build
//      attempts to error out on the auth helper.
//   3. A renamed file / typo in a route path.
//
// What this DOESN'T catch (intentional, since it'd require seed data):
//   - Actual data rendering once authenticated
//   - Form submission paths
//   - The cron routes (they require Authorization headers; tested
//     separately when we add a fixture for the cron secret)
//
// Add to this list as new firm surfaces ship.

// Marketing surface — public, doesn't need auth.
test("/pricing/firms — public firm pricing renders", async ({ page }) => {
  await page.goto("/pricing/firms");
  await expect(page.locator("h1").first()).toBeVisible();
  // Schema.org JSON-LD should be present in the HTML.
  const content = await page.content();
  expect(content).toMatch(/application\/ld\+json/);
});

// Auth-gated surfaces: each should redirect to /login when visited
// without a session. The redirect target preserves the original
// path via `?next=` (or the route ID, depending on the auth helper
// — we accept either).
const AUTH_GATED_ROUTES = [
  "/firm/billing",
  "/firm/threads",
  "/firm/audit-log",
  "/firm/templates",
  "/firm/bella",
  "/firm/onboarding",
];

for (const route of AUTH_GATED_ROUTES) {
  test(`${route} — redirects to /login when unauthenticated`, async ({
    page,
  }) => {
    const response = await page.goto(route);
    // Either we landed on /login (Next redirected) or we got a 302
    // intercepted before navigation completed. We check URL and
    // status. A 200 on the original route means the auth helper
    // didn't fire — that's a regression.
    expect(page.url()).toMatch(/\/login/);
    // 401/403 would mean we got there but auth bounced us; 200 on
    // /login is what we expect after redirect.
    expect(response?.status() ?? 0).toBeLessThan(500);
  });
}

// Sanity: the cron endpoints require Authorization. Without it
// they should 401, not 500. This catches handlers that throw on
// import (e.g., a missing dependency that loads at module-eval time).
const CRON_ROUTES = [
  "/api/cron/firm-invoice-issue",
  "/api/cron/firm-activity-retention",
];

for (const route of CRON_ROUTES) {
  test(`${route} — returns 401 without authorization`, async ({ request }) => {
    const res = await request.get(route);
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });
}
