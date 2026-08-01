import { test, expect } from "@playwright/experimental-ct-react";
import { ImportSelectionHarness } from "./ImportSelectionHarness";

/**
 * The import review list at the two widths that matter.
 *
 * 344px is the Galaxy Z Fold5 cover screen, the narrowest device this app
 * ships to and the width where a recent row bug collapsed a description into
 * one character per line. A dense list of checkboxes is exactly the shape
 * that breaks there, so the overflow assertion below is the real test and the
 * screenshot is the record.
 */

const FOLD_COVER = { width: 344, height: 900 };
const DESKTOP = { width: 1280, height: 900 };

function noop() {
  return Promise.resolve();
}

async function saveSelected() {
  return { saved: 0, savedCents: 0, labelledNotBooked: 0, skipped: 0 };
}

const CATS = [
  { code: "office", label: "Office expense", hint: "Line 18", scope: "business", group: "Operating" },
  { code: "meals", label: "Meals", hint: "Line 24b", scope: "business", group: "Travel" },
  { code: "software", label: "Software and subscriptions", hint: "Line 18", scope: "business", group: "Operating" },
];

const CAT_ENTRIES: [string, Record<string, unknown>][] = [
  ["office", { label: "Office expense", scope: "business", schedule_c_line: "18", irc_section: "162", irs_pub: "Pub 535", irs_url: null }],
  ["meals", { label: "Meals", scope: "business", schedule_c_line: "24b", irc_section: "274", irs_pub: "Pub 463", irs_url: null }],
  ["software", { label: "Software and subscriptions", scope: "business", schedule_c_line: "18", irc_section: "162", irs_pub: null, irs_url: null }],
];

function row(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    posted_at: "2026-03-04",
    description: "COSTCO WHOLESALE #1187 KIRKLAND WA",
    amount_cents: -18432,
    raw_category: "Shopping",
    suggested_category_code: null,
    applied_category_code: null,
    applied_expense_id: null,
    applied_income_id: null,
    ignored: false,
    ...over,
  };
}

const GROUPS = [
  {
    key: "2026-03",
    label: "March 2026",
    totalCents: 41932,
    rows: [
      // Human-picked: ticked by default.
      row({ id: "a", applied_category_code: "office" }),
      // Model guess: listed and ready, but NOT ticked.
      row({
        id: "b",
        description: "ADOBE  *CREATIVE CLOUD SUBSCRIPTION 800-833-6687",
        amount_cents: -5999,
        suggested_category_code: "software",
      }),
      // No category yet: cannot be ticked, and says so.
      row({
        id: "c",
        description: "SQ *THE VERY LONG COFFEE ROASTERS COMPANY NAME THAT WRAPS",
        amount_cents: -1750,
      }),
      // No readable date: cannot be booked to a month.
      row({ id: "d", posted_at: null, description: "AMZN MKTP US", amount_cents: -3400, applied_category_code: "office" }),
    ],
  },
];

const CTX = { isCredit: false, taxYear: 2026, currentMonth: 3 };

const PROPS = {
  groups: GROUPS,
  taggedRows: [],
  taggedOpen: false,
  importId: "imp-1",
  companyId: "co-1",
  cats: CATS,
  frequentCodes: ["office"],
  catEntries: CAT_ENTRIES,
  isCredit: false,
  ctx: CTX,
  setTxCategory: noop,
  ignoreTx: noop,
  teachBella: noop,
  saveSelected,
} as unknown as React.ComponentProps<typeof ImportSelectionHarness>;

/** Every element whose border box escapes the viewport horizontally. */
async function horizontalOffenders(
  page: import("@playwright/test").Page,
  viewportWidth: number,
) {
  return page.evaluate((vw) => {
    const out: { tag: string; cls: string; right: number }[] = [];
    document.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.right > vw + 1 || r.left < -1) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute("class") ?? "").slice(0, 90),
          right: Math.round(r.right),
        });
      }
    });
    return out;
  }, viewportWidth);
}

test.describe("fold cover screen, 344px", () => {
  test.use({ viewport: FOLD_COVER });

  test("nothing overflows horizontally", async ({ mount, page }) => {
    await mount(<ImportSelectionHarness {...PROPS} />);
    expect(await horizontalOffenders(page, FOLD_COVER.width)).toEqual([]);
  });

  test("no row collapses to a sliver", async ({ mount, page }) => {
    // The failure mode this guards: a flex child without min-width:0 gets
    // squeezed until the description renders one character per line.
    await mount(<ImportSelectionHarness {...PROPS} />);
    const widths = await page.evaluate(() =>
      [...document.querySelectorAll("li")].map(
        (li) => li.getBoundingClientRect().width,
      ),
    );
    expect(widths.length).toBeGreaterThan(0);
    for (const w of widths) expect(w).toBeGreaterThan(240);
  });

  test("every checkbox is a 44px tap target", async ({ mount, page }) => {
    await mount(<ImportSelectionHarness {...PROPS} />);
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('input[type="checkbox"]')].map((el) => {
        const r = (el.parentElement as HTMLElement).getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }),
    );
    expect(boxes.length).toBe(5); // four rows plus select-all
    for (const b of boxes) expect(b.h).toBeGreaterThanOrEqual(44);
  });

  test("defaults tick only the human-categorized row", async ({ mount, page }) => {
    await mount(<ImportSelectionHarness {...PROPS} />);
    const checked = await page.evaluate(
      () =>
        [...document.querySelectorAll('li input[type="checkbox"]')].filter(
          (el) => (el as HTMLInputElement).checked,
        ).length,
    );
    expect(checked).toBe(1);
    await expect(page.getByRole("button", { name: /^Save 1 as business/ })).toBeVisible();
  });

  test("select all reaches the model guess but not the unbookable rows", async ({
    mount,
    page,
  }) => {
    await mount(<ImportSelectionHarness {...PROPS} />);
    await page.getByRole("checkbox").first().check();
    await expect(page.getByRole("button", { name: /^Save 2 as business/ })).toBeVisible();
  });

  test("screenshot", async ({ mount, page }) => {
    await mount(<ImportSelectionHarness {...PROPS} />);
    await expect(page).toHaveScreenshot("import-selection-fold.png", {
      fullPage: true,
    });
  });
});

test.describe("desktop", () => {
  test.use({ viewport: DESKTOP });

  test("nothing overflows horizontally", async ({ mount, page }) => {
    await mount(<ImportSelectionHarness {...PROPS} />);
    expect(await horizontalOffenders(page, DESKTOP.width)).toEqual([]);
  });

  test("screenshot", async ({ mount, page }) => {
    await mount(<ImportSelectionHarness {...PROPS} />);
    await expect(page).toHaveScreenshot("import-selection-desktop.png", {
      fullPage: true,
    });
  });
});
