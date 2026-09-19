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

/** Number of line boxes the whole first h1 occupies. */
async function h1Lines(page: Page): Promise<number> {
  return page.evaluate(() => {
    const h = document.querySelector("h1");
    if (!h) throw new Error("no h1 on the page");
    const range = document.createRange();
    range.selectNodeContents(h);
    const tops = new Set<number>();
    for (const r of Array.from(range.getClientRects())) if (r.width > 0) tops.add(Math.round(r.top));
    return tops.size;
  });
}

/**
 * The fixed block (header plus the spine in its slot) sits entirely above
 * the h1, and the spine sits inside that block rather than hanging below
 * it onto the page. `spineId` differs by surface: the home page mounts its
 * own animated `#year-spine`, every page wearing PageShell mounts the
 * static `#page-spine`.
 */
async function expectShellClearsH1(page: Page, spineId: string) {
  const header = (await page.locator("header").first().boundingBox())!;
  const h1 = (await page.locator("h1").boundingBox())!;
  expect(h1.y, "the h1 starts under the fixed block").toBeGreaterThan(header.y + header.height);
  const spine = (await page.locator(spineId).boundingBox())!;
  expect(spine.y + spine.height, "the spine sits inside the header block").toBeLessThanOrEqual(header.y + header.height + 1);
}

/** Pixels the document scrolls sideways; must never be positive. */
async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function ready(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
}

/**
 * The secondary public pages, all of which render PageShell. They share
 * one h1 type scale (`display text-4xl sm:text-6xl`), so a headline that
 * holds at one width holds at all of them only if the copy is short
 * enough; that is what the bound below measures. /get is deliberately
 * out of scope: it is a token surface, not a marketing page.
 */
const SECONDARY = ["/pricing", "/calculators", "/guides", "/help", "/changelog", "/compare"];

/** Two lines is the desktop bound, three the phone bound. */
const h1Bound = (width: number) => (width >= 1024 ? 2 : 3);

/**
 * Measured on this branch: "Free guides on self-employment taxes, in plain
 * English." runs to 3 lines at 1280, 4 at 375 and 4 at 344, one over the
 * bound at every width. The fix is shorter copy, and app/guides/page.tsx
 * is owned by the index-pages worktree, so the measurement stays here and
 * the marker comes off with the copy change rather than with the type
 * scale.
 */
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
      expect(await h1Lines(page)).toBeLessThanOrEqual(h1Bound(vp.width));
    });

    test("the fixed header and spine never overlap the hero", async ({ page }) => {
      await ready(page, "/");
      await expectShellClearsH1(page, "#year-spine");
    });

    for (const path of SECONDARY) {
      test(`${path} h1 holds to two lines at desktop and three on a phone`, async ({ page }) => {
        await ready(page, path);
        expect(await h1Lines(page), `${path} h1 wrapped past its bound`).toBeLessThanOrEqual(
          h1Bound(vp.width),
        );
      });

      test(`${path} header and spine never overlap the h1`, async ({ page }) => {
        await ready(page, path);
        await expectShellClearsH1(page, "#page-spine");
      });

      test(`${path} does not scroll sideways`, async ({ page }) => {
        await ready(page, path);
        expect(await sidewaysOverflow(page), `${path} scrolls sideways`).toBeLessThanOrEqual(0);
      });
    }
  });
}

test.describe("at 344px", () => {
  test.use({ viewport: { width: 344, height: 882 } });

  test("the home h1 holds to two lines at desktop and three on a phone", async ({ page }) => {
    await ready(page, "/");
    expect(await h1Lines(page)).toBeLessThanOrEqual(3);
  });

  test("the fixed header and spine never overlap the hero", async ({ page }) => {
    await ready(page, "/");
    await expectShellClearsH1(page, "#year-spine");
  });

  test("the page does not scroll sideways", async ({ page }) => {
    await ready(page, "/");
    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(docOverflow, "the page must not scroll sideways at 344px").toBeLessThanOrEqual(0);
  });

  // The narrowest width the shell has to hold: the longest secondary
  // headline (/guides) and the one carrying a nowrap span (/pricing).
  for (const path of ["/pricing", "/guides"]) {
    test(`${path} h1 holds to three lines at 344px`, async ({ page }) => {
      await ready(page, path);
      expect(await h1Lines(page), `${path} h1 wrapped past its bound`).toBeLessThanOrEqual(3);
    });

    test(`${path} header and spine never overlap the h1 at 344px`, async ({ page }) => {
      await ready(page, path);
      await expectShellClearsH1(page, "#page-spine");
    });

    test(`${path} does not scroll sideways at 344px`, async ({ page }) => {
      await ready(page, path);
      expect(await sidewaysOverflow(page), `${path} scrolls sideways`).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("at 375px", () => {
  test.use({ viewport: PHONE });

  // /book wears the shared paper shell (PR 2); the audit's 344px finding
  // was the wordmark touching the header's button, so the shell's
  // wordmark and its Sign in link must keep clear of each other.
  test("the booking page's shell header keeps the wordmark clear of Sign in", async ({ page }) => {
    await ready(page, "/book?for=firm");
    const signIn = page.locator("header").getByRole("link", { name: "Sign in" });
    const box = (await signIn.boundingBox())!;
    // The header's targets are 44px tall by design (PR #634); a second
    // line of 13px text would push the box past 56.
    expect(Math.round(box.height), "the link wrapped to two lines").toBeLessThan(56);
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
