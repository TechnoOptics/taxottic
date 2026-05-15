import { test, expect } from "@playwright/test";

// Flow 7 + 8: /help + /pricing + /changelog all render. These
// surfaces were added in the May 2026 audit fixes; they're public
// SEO surfaces that need to keep working.

test("/help renders FAQ content", async ({ page }) => {
  await page.goto("/help");
  await expect(page.locator("h1").first()).toBeVisible();
});

test("/pricing renders plan tiers", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.locator("h1").first()).toBeVisible();
});

test("/changelog renders release notes", async ({ page }) => {
  await page.goto("/changelog");
  await expect(page.locator("h1").first()).toBeVisible();
});

test("/example demo page renders", async ({ page }) => {
  await page.goto("/example");
  await expect(page.locator("h1").first()).toBeVisible();
});
