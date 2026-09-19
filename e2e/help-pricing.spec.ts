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
 * unstyled. And every row has to carry its own anchor id, so a
 * /changelog#... link lands on the change it names. The id is on the
 * <li>; the row itself is not a link, because a link from <li id="x">
 * to "#x" is a link to its own container and does nothing a reader can
 * see. That absence is asserted here too, or the self-link comes back
 * the first time someone makes `href` required again.
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
      await row.locator("a").count(),
      `row #${id} is a record, not a destination: no link inside it`,
    ).toBe(0);
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

/**
 * An anchored row has to be READABLE, not merely scrolled to. The
 * marketing header is `position: fixed` and 169px tall, so a browser
 * that puts the fragment target flush against the viewport top hides it
 * completely: before the scroll offset existed, an anchored changelog
 * row landed at `top: 0` with 100% of it behind the header. The offset
 * is CSS on the scroller keyed to the grammar attribute, so this also
 * covers anchors that are not ledger rows (#tiers on /pricing, a
 * heading), which is why the assertion is "clear of the header", never
 * "has class x".
 *
 * Web fonts are blocked here on purpose. Their reflow races Chromium's
 * fragment scroll on a cold load: with fonts on, a load carrying a
 * fragment scrolls about 2 times in 6, and with them blocked about 5.
 * That race is site-wide and predates the ledger (see the task report);
 * blocking fonts isolates the thing under test, which is where the
 * target lands WHEN the browser honours the fragment.
 */
for (const width of [375, 1280]) {
  test(`/changelog anchors land clear of the fixed header at ${width}`, async ({ page }) => {
    await page.route("**/*.{woff,woff2,ttf,otf}", (r) => r.abort());
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/changelog");
    await page.waitForLoadState("networkidle");
    // The header measures 0 until the stylesheet has been applied, and
    // every assertion below is relative to its height.
    const headerLaidOut = () =>
      page.waitForFunction(
        () => (document.querySelector("header")?.getBoundingClientRect().height ?? 0) > 100,
      );
    await headerLaidOut();

    // Read the row ids with a retry: against a dev server the first hit
    // on a route compiles it and the client reloads underneath us,
    // which destroys the execution context mid-read.
    let ids: string[] = [];
    for (let attempt = 0; attempt < 6 && ids.length < 6; attempt++) {
      try {
        ids = await page.$$eval("ul.ledger-list > li", (ls) => ls.map((l) => l.id));
      } catch {
        await page.waitForTimeout(500);
        await headerLaidOut();
      }
    }
    // Far enough down the list that landing behind the header is the
    // difference between reading the entry and seeing nothing.
    const id = ids[4];
    expect(id, "the changelog rendered its rows").toBeTruthy();

    const read = (p: typeof page) =>
      p.evaluate((id) => {
        const header = document.querySelector("header")!.getBoundingClientRect();
        const target = document.getElementById(id)!.getBoundingClientRect();
        return {
          headerBottom: Math.round(header.bottom),
          top: Math.round(target.top),
          scrollY: Math.round(window.scrollY),
          reserved: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
        };
      }, id);

    // The mechanism itself: the scroller reserves at least the header.
    const before = await read(page);
    expect(before.headerBottom, "the header is fixed and has height").toBeGreaterThan(100);
    expect(
      before.reserved,
      "the scroller reserves the header height for every fragment target",
    ).toBeGreaterThanOrEqual(before.headerBottom);

    // 1. Hash navigation: the path a reader takes to a row, which is a
    // /changelog#... link from somewhere else, not a click on the row.
    // The rows are records now, not links: each used to carry an
    // <a href="#x"> inside <li id="x">, a link to its own container,
    // and clicking it is what this step used to do. Setting the hash is
    // the same navigation the anchor performed, minus the self-link.
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    await page.evaluate((id) => {
      location.hash = id;
    }, id);
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await page.waitForTimeout(400);
    const hashNav = await read(page);
    expect(hashNav.scrollY, "the fragment scrolled the page").toBeGreaterThan(0);
    expect(
      hashNav.top,
      "the anchored row sits below the fixed header, not behind it",
    ).toBeGreaterThanOrEqual(hashNav.headerBottom);

    // 2. A programmatic scroll to a row, the deterministic form of the
    // same question: scroll-padding is what the browser and the router
    // both consult, so every row has to come to rest below the header,
    // not just the one clicked above.
    for (const index of [4, 10, 16]) {
      const placed = await page.evaluate((index) => {
        const row = document.querySelectorAll("ul.ledger-list > li")[index];
        window.scrollTo(0, 0);
        row.scrollIntoView();
        const header = document.querySelector("header")!.getBoundingClientRect();
        const target = row.getBoundingClientRect();
        return { top: Math.round(target.top), headerBottom: Math.round(header.bottom) };
      }, index);
      expect(
        placed.top,
        `row ${index} came to rest behind the fixed header`,
      ).toBeGreaterThanOrEqual(placed.headerBottom);
    }

    // A cold load carrying the fragment is not asserted: Chromium honours
    // it only some of the time on this app (a race between the fragment
    // scroll and hydration plus web-font reflow, measured at 1 to 5 in 6
    // depending on width), which is site-wide and predates the ledger.
    // Every honoured load measured landed exactly where scroll-padding
    // puts it, so hash navigation and scrollIntoView above are the
    // covered paths.
  });
}

test("/example demo page renders", async ({ page }) => {
  await page.goto("/example");
  await expect(page.locator("h1").first()).toBeVisible();
});
