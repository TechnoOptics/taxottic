import { test, expect, type Page } from "@playwright/test";

/**
 * Rendered typography on the public surfaces, measured rather than
 * eyeballed.
 *
 * The 2026-09-03 audit at 1280, 375 and 344 found the same defect class
 * in five places: a headline or a control that reads correctly in source
 * and breaks at a real width. A source-level guard cannot see a line
 * break, and a pixel baseline sees it only after it has been accepted, so
 * each one is asserted here on the live DOM with Range.getClientRects():
 * one rect per line box a phrase occupies.
 *
 * Viewports are set per test, so the default chromium and mobile-chrome
 * projects each run the same measurement at the same widths.
 */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 812 };

/** Number of line boxes the first occurrence of `phrase` inside `selector` spans. */
async function linesOf(page: Page, selector: string, phrase: string): Promise<number> {
  return page.evaluate(
    ([sel, needle]) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`no element for ${sel}`);
      const nodes: Text[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
      // Locate the phrase across text nodes: it may start outside a <span>
      // and end inside one.
      const full = nodes.map((n) => n.data).join("");
      const at = full.indexOf(needle);
      if (at < 0) throw new Error(`"${needle}" not found in ${sel}: "${full}"`);
      const end = at + needle.length;
      const range = document.createRange();
      let offset = 0;
      for (const n of nodes) {
        const next = offset + n.data.length;
        if (offset <= at && at < next) range.setStart(n, at - offset);
        if (offset < end && end <= next) {
          range.setEnd(n, end - offset);
          break;
        }
        offset = next;
      }
      const tops = new Set<number>();
      for (const r of Array.from(range.getClientRects())) {
        if (r.width > 0) tops.add(Math.round(r.top));
      }
      return tops.size;
    },
    [selector, phrase] as const,
  );
}

async function ready(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
}

for (const vp of [DESKTOP, PHONE]) {
  test.describe(`at ${vp.width}px`, () => {
    test.use({ viewport: vp });

    test("pricing h1 does not orphan the saving", async ({ page }) => {
      await ready(page, "/pricing");
      expect(
        await linesOf(page, "h1", "Yearly saves ~17%."),
        "'~17%.' must sit on the same line as 'Yearly saves'",
      ).toBe(1);
    });

    test("calculators h1 does not split the compound", async ({ page }) => {
      await ready(page, "/calculators");
      expect(
        await linesOf(page, "h1", "self-employed."),
        "'self-employed.' must not break at its hyphen",
      ).toBe(1);
    });

    test("hero sub-copy is a promise, not a paragraph", async ({ page }) => {
      await ready(page, "/");
      const lines = await page.evaluate(() => {
        const p = document.querySelector("h1 + p");
        if (!p) throw new Error("hero sub-copy <p> not found");
        const range = document.createRange();
        range.selectNodeContents(p);
        const tops = new Set<number>();
        for (const r of Array.from(range.getClientRects())) {
          if (r.width > 0) tops.add(Math.round(r.top));
        }
        return tops.size;
      });
      // 36 words at 19px in a 46ch column is four lines by design; the
      // copy names the number and two capabilities.
      expect(lines).toBeLessThanOrEqual(vp.width >= 1024 ? 4 : 6);
    });

    test("the home h1 holds to two lines at desktop and three on a phone", async ({ page }) => {
      await ready(page, "/");
      const lines = await page.evaluate(() => {
        const h = document.querySelector("h1")!;
        const range = document.createRange();
        range.selectNodeContents(h);
        const tops = new Set<number>();
        for (const r of Array.from(range.getClientRects())) if (r.width > 0) tops.add(Math.round(r.top));
        return tops.size;
      });
      expect(lines).toBeLessThanOrEqual(vp.width >= 1024 ? 2 : 3);
    });

    test("the fixed header and spine never overlap the hero", async ({ page }) => {
      await ready(page, "/");
      const header = (await page.locator("header").first().boundingBox())!;
      const h1 = (await page.locator("h1").boundingBox())!;
      expect(h1.y, "the h1 starts under the fixed block").toBeGreaterThan(header.y + header.height);
      const spine = (await page.locator("#year-spine").boundingBox())!;
      expect(spine.y + spine.height, "the spine sits inside the header block").toBeLessThanOrEqual(header.y + header.height + 1);
    });
  });
}

test.describe("at 344px", () => {
  test.use({ viewport: { width: 344, height: 882 } });

  test("the home h1 holds to two lines at desktop and three on a phone", async ({ page }) => {
    await ready(page, "/");
    const lines = await page.evaluate(() => {
      const h = document.querySelector("h1")!;
      const range = document.createRange();
      range.selectNodeContents(h);
      const tops = new Set<number>();
      for (const r of Array.from(range.getClientRects())) if (r.width > 0) tops.add(Math.round(r.top));
      return tops.size;
    });
    expect(lines).toBeLessThanOrEqual(3);
  });

  test("the fixed header and spine never overlap the hero", async ({ page }) => {
    await ready(page, "/");
    const header = (await page.locator("header").first().boundingBox())!;
    const h1 = (await page.locator("h1").boundingBox())!;
    expect(h1.y, "the h1 starts under the fixed block").toBeGreaterThan(header.y + header.height);
    const spine = (await page.locator("#year-spine").boundingBox())!;
    expect(spine.y + spine.height, "the spine sits inside the header block").toBeLessThanOrEqual(header.y + header.height + 1);
  });

  test("the page does not scroll sideways", async ({ page }) => {
    await ready(page, "/");
    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(docOverflow, "the page must not scroll sideways at 344px").toBeLessThanOrEqual(0);
  });
});

test.describe("at 375px", () => {
  test.use({ viewport: PHONE });

  test("the booking header keeps 'Back to home' on one line", async ({ page }) => {
    await ready(page, "/book?for=firm");
    const link = page.getByRole("link", { name: "Back to home" });
    const box = (await link.boundingBox())!;
    // One line of 14px text is ~20px tall; two lines are ~40px.
    expect(Math.round(box.height), "the link wrapped beside the wordmark").toBeLessThan(28);
    const wordmark = page.getByRole("link", { name: "Taxottic home" });
    const wm = (await wordmark.boundingBox())!;
    expect(wm.x + wm.width, "the wordmark overlaps the link").toBeLessThanOrEqual(box.x);
  });
});

// iPhone SE (1st gen) and the Galaxy Z Fold5 cover screen: the two
// narrowest widths a real device gives the strip. At 320 the full badges
// do not fit even on their own row; at 344 they fit with 12px to spare.
for (const width of [320, 344]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 882 } });

    test("the phone download banner is a compact strip", async ({ page }) => {
      await ready(page, "/");
      const banner = downloadBanner(page);
      await expect(banner).toBeVisible();
      const { appStore, play } = badgesIn(banner);

      const a = (await appStore.boundingBox())!;
      const b = (await play.boundingBox())!;
      expect(Math.round(a.y), "the two badges stacked instead of sharing a row").toBe(Math.round(b.y));

      const box = (await banner.boundingBox())!;
      // Was ~173px, a fifth of this screen, for one sentence and two
      // badges. 77px now: one 20px text line, an 8px gap, a 32px badge
      // row, 8px padding each side, plus the hairline. Every term is a
      // CSS length, so the figure does not move with font rasterisation.
      // 80 leaves room for the hairline and nothing else: the eyebrow
      // coming back on phones alone adds 8px, and that has to fail.
      expect(Math.round(box.height), "the banner is still a block").toBeLessThanOrEqual(80);

      const docOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(docOverflow, "the banner must not scroll the page sideways").toBeLessThanOrEqual(0);
    });
  });
}

// From `sm` up the strip is the one it always was. 640 is the width where
// the badge group has to wrap under the sentence; it must wrap as a group,
// not stack its two badges (a first cut of the phone layout did exactly
// that here, and no test saw it).
test.describe("at 640px", () => {
  test.use({ viewport: { width: 640, height: 800 } });

  test("the download banner keeps both badges on one row", async ({ page }) => {
    await ready(page, "/");
    const banner = downloadBanner(page);
    await expect(banner).toBeVisible();
    const { appStore, play } = badgesIn(banner);
    const a = (await appStore.boundingBox())!;
    const b = (await play.boundingBox())!;
    expect(Math.round(a.y), "the badges stacked at the sm breakpoint").toBe(Math.round(b.y));
    const box = (await banner.boundingBox())!;
    // Measured 97px on main at this width: sentence row plus badge row.
    expect(Math.round(box.height)).toBeLessThanOrEqual(100);
  });
});

/** The fixed strip, scoped by its sentence: the footer carries the same two badges. */
function downloadBanner(page: Page) {
  // The banner mounts after hydration decides it is not the native shell.
  return page
    .locator("div.fixed.bottom-0")
    .filter({ hasText: "Taxottic is on your phone too." });
}

function badgesIn(banner: ReturnType<typeof downloadBanner>) {
  return {
    appStore: banner.getByRole("link", { name: "Download Taxottic on the App Store" }),
    play: banner.getByRole("link", { name: "Get Taxottic on Google Play" }),
  };
}

test.describe("the year spine moves with the reader", () => {
  test.use({ viewport: DESKTOP });

  test("fill follows the moment at the viewport centre and returns to today", async ({ page }) => {
    await ready(page, "/");
    const spine = page.locator("#year-spine");
    const today = Number(await spine.getAttribute("data-fill"));
    const fillOf = () => spine.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--spine-fill")) / 100);
    expect(Math.abs((await fillOf()) - today)).toBeLessThan(0.001);

    const dec = page.locator("[data-moment='dec']");
    const target = Number(await dec.getAttribute("data-moment-at"));
    await dec.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await expect.poll(fillOf, { timeout: 3000 }).toBeCloseTo(target, 2);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(fillOf, { timeout: 3000 }).toBeCloseTo(today, 2);
  });

  test("the rail draws on load and the marker stays at today", async ({ page }) => {
    await ready(page, "/");
    const spine = page.locator("#year-spine");
    await expect(spine).toHaveClass(/is-drawn/);
    const railHandle = spine.locator(".runway-rail");
    // is-drawn only flips the class; the rail's scaleX(0) -> scaleX(1) runs
    // on a 0.4s CSS transition after that. Measuring the box mid-transition
    // reads a partial width and misreports the marker's fraction, so wait
    // for the transform to finish before taking either box.
    await expect
      .poll(() =>
        railHandle.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a),
      )
      .toBeGreaterThan(0.999);
    const rail = (await railHandle.boundingBox())!;
    const marker = (await spine.locator(".runway-today").boundingBox())!;
    const today = Number(await spine.getAttribute("data-fill"));
    expect(Math.abs((marker.x - rail.x) / rail.width - today)).toBeLessThan(0.005);
  });

  test("reduced motion renders the final state at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page, "/");
    const spine = page.locator("#year-spine");
    await expect(spine).toHaveClass(/is-drawn/);
    await expect(spine).not.toHaveClass(/is-drawing/);
    const figure = page.locator("#hero-next-payment");
    await expect(figure).toHaveText(/\$3,420|\$4,400/);
  });
});
