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

/**
 * The FAQ rows open and close, and a `display: flex` summary drops the
 * native ::marker, so the chevron IS the affordance. Without it the row
 * reads as a bold line of text and the answer (visible copy before the
 * Year rewrite) is behind an invisible control.
 */
test("/pricing FAQ rows show a disclosure indicator, closed and open", async ({ page }) => {
  await page.goto("/pricing");
  const summary = page.locator("details.border-b > summary").first();
  await expect(summary).toBeVisible();
  const chevron = summary.locator("svg").first();
  await expect(chevron).toBeVisible();
  const box = (await chevron.boundingBox())!;
  expect(box.width, "the indicator has a real box when the row is closed").toBeGreaterThan(8);
  expect(box.height).toBeGreaterThan(8);
  const closed = await chevron.evaluate((n) => getComputedStyle(n).transform);
  await summary.click();
  await expect(summary.locator("xpath=..")).toHaveAttribute("open", "");
  const open = await chevron.evaluate((n) => getComputedStyle(n).transform);
  expect(open, "the indicator turns when the row opens").not.toBe(closed);
});

/**
 * The home hero's firm CTA links to /pricing#tiers. The tier block is
 * two responsive trees, so a per-tier id would resolve at one width and
 * scroll nowhere at the other (a display:none target has a zero box);
 * this asserts the one anchor that is displayed at every width lands on
 * the tiers and clears the fixed header.
 *
 * The navigation is a hash navigation rather than a cold load with the
 * fragment in the URL: measured on this app, a cold load never performs
 * the fragment scroll for ANY id (a `<tr id>` deep in the page behaves
 * the same), so asserting that would pin a browser/dev-server behaviour
 * instead of this page's anchors.
 */
/**
 * One test, two projects: chromium runs it wide (the table tree) and
 * mobile-chrome at a phone width (the ledger tree), so both trees are
 * covered without emulating a desktop viewport on a mobile device,
 * where the hash scroll lands on the visual viewport and window.scrollY
 * stays 0.
 */
test("/pricing#tiers scrolls to the tier block", async ({ page }) => {
  await page.goto("/pricing");
  const tiers = page.locator("#tiers");
  await expect(tiers, "the anchor target is displayed at this width").toBeVisible();
  const box = (await tiers.boundingBox())!;
  expect(box.height, "and it is the tier block, not an empty node").toBeGreaterThan(200);

  await page.goto("/pricing#tiers");
  await page.waitForTimeout(400);
  expect(
    await page.evaluate(() => window.scrollY),
    "the fragment scrolls the page",
  ).toBeGreaterThan(100);
  const top = await tiers.evaluate((n) => n.getBoundingClientRect().top);
  expect(top, "the block clears the fixed header rather than hiding under it").toBeGreaterThan(-8);
  expect(top).toBeLessThan(220);
});

test("/example demo page renders", async ({ page }) => {
  await page.goto("/example");
  await expect(page.locator("h1").first()).toBeVisible();
});
