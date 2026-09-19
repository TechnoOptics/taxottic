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
 * The coloured tag pills are gone: a tag is now the ledger row's mono
 * label. Two things have to hold, and neither is visible to a source
 * grep. The label has to resolve to the data face `.mono-label` paints
 * (uppercase, tracked, muted); that class is unlayered CSS, so a utility
 * cannot overpaint it, but a missing `data-skin` ancestor would leave it
 * unstyled. And every row has to carry its own anchor id, with its link
 * pointing at that id, so a /changelog#... link lands on the change it
 * names.
 */
test("/changelog rows carry a mono-label tag and their own anchor", async ({ page }) => {
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

  const rows = page.locator("ul.ledger-list > li");
  const rowCount = await rows.count();
  expect(rowCount, "the changelog renders its entries as ledger rows").toBeGreaterThan(10);

  for (const row of await rows.all()) {
    const id = await row.getAttribute("id");
    expect(id, "every row is addressable").toBeTruthy();
    expect(
      await row.locator("a").first().getAttribute("href"),
      "the row links to its own anchor",
    ).toBe(`#${id}`);
  }

  // Every entry carries at least one tag, so every row carries one label.
  const labels = page.locator("ul.ledger-list .mono-label");
  await expect(labels).toHaveCount(rowCount);

  const style = await labels.first().evaluate((n) => {
    const s = getComputedStyle(n);
    return { transform: s.textTransform, tracking: s.letterSpacing, colour: s.color };
  });
  expect(style.transform, "the tag reads as a mono label").toBe("uppercase");
  expect(parseFloat(style.tracking), "the tag is tracked").toBeGreaterThan(0);
  expect(style.colour, "the tag reads as the muted ink").toBe(muted);

  // Several tags on one entry read as one label, joined by a middot.
  await expect(labels.first()).toHaveText(/^[A-Za-z]+(?: \u00b7 [A-Za-z]+)*$/);
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
