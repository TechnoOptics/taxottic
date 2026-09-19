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

/**
 * The tag tones are meaning, not decoration: Security has to read red.
 * They were inert for one commit because the tag also carried
 * `.mono-label`, which is unlayered and so beat the `text-*` utilities
 * in `@layer utilities` regardless of specificity, painting all four
 * tags `rgb(76, 87, 102)`. A source grep cannot see that; only the
 * resolved colour can, so this asserts the rendered value.
 */
test("/changelog tag tones survive the cascade", async ({ page }) => {
  await page.goto("/changelog");

  // Resolve --muted the way the browser would paint it, so the
  // comparison below is rgb() against rgb() rather than token text.
  const muted = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--muted)";
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });

  const colours: Record<string, string> = {};
  for (const tag of ["shipped", "fix", "security"]) {
    const el = page.locator(`[data-tag="${tag}"]`).first();
    await expect(el).toBeVisible();
    colours[tag] = await el.evaluate((n) => getComputedStyle(n).color);
    expect(colours[tag], `the ${tag} tag renders as the muted ink`).not.toBe(muted);
  }
  // Three tones, three distinct colours. One colour for all three is the
  // exact failure the unlayered class caused.
  expect(new Set(Object.values(colours)).size).toBe(3);
});

test("/example demo page renders", async ({ page }) => {
  await page.goto("/example");
  await expect(page.locator("h1").first()).toBeVisible();
});
