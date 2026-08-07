import { test, expect } from "@playwright/experimental-ct-react";
import { TxRowGroupHarness } from "./TxRowGroupHarness";

/**
 * The import review list (BatchSelectionProvider + TxRow, as page.tsx
 * assembles it) at the two widths that matter.
 *
 * 344px is the Galaxy Z Fold5 cover screen, the narrowest device this app
 * ships to and the width where a recent row bug collapsed a description into
 * one character per line. A dense list of checkboxes is exactly the shape
 * that breaks there, so the overflow assertion below is the real test and the
 * screenshot is the record.
 *
 * Ported from the now-superseded PR #489's
 * components/import/ImportSelection.ct.spec.tsx, which covered the same
 * failure mode against components that no longer exist. The batch-selection
 * and duplicate-detection rebuild (feat/import-batch-complete,
 * feat/import-duplicate-detection) has 823 + 768 tests but no component test,
 * so this is the only thing in the repo that would catch a checkbox list
 * overflowing at 344px.
 */

const FOLD_COVER = { width: 344, height: 900 };
const DESKTOP = { width: 1280, height: 900 };

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

// Same shape of mix as the old ImportSelection fixture: an untouched row, a
// Bella suggestion nobody accepted yet, a human-tagged row carrying the
// long-description failure mode, and a row already applied (so it drops out
// of the selectable set and renders the "Applied as" badge instead of a
// checkbox).
const ROWS = [
  row({ id: "a", description: "SHELL OIL 5748291 BELLEVUE WA" }),
  row({
    id: "b",
    description: "ADOBE  *CREATIVE CLOUD SUBSCRIPTION 800-833-6687",
    amount_cents: -5999,
    suggested_category_code: "software",
  }),
  row({
    id: "c",
    description: "SQ *THE VERY LONG COFFEE ROASTERS COMPANY NAME THAT WRAPS AROUND MULTIPLE LINES AT NARROW WIDTHS",
    amount_cents: -1750,
    applied_category_code: "office",
  }),
  row({
    id: "d",
    description: "PREVIOUSLY APPLIED OFFICE SUPPLY RUN",
    amount_cents: -2200,
    applied_category_code: "office",
    applied_expense_id: "exp_1",
  }),
];

const PROPS = {
  importId: "imp-1",
  companyId: "co-1",
  cats: CATS,
  frequentCodes: ["office"],
  catEntries: CAT_ENTRIES,
  convention: "charges_negative" as const,
  rows: ROWS,
} as unknown as React.ComponentProps<typeof TxRowGroupHarness>;

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
    await mount(<TxRowGroupHarness {...PROPS} />);
    expect(await horizontalOffenders(page, FOLD_COVER.width)).toEqual([]);
  });

  test("no row collapses to a sliver", async ({ mount, page }) => {
    // The failure mode this guards: a flex child without min-width:0 gets
    // squeezed until the description renders one character per line. Every
    // <li> here is a TxRow root, including the long-description row (id "c").
    await mount(<TxRowGroupHarness {...PROPS} />);
    const widths = await page.evaluate(() =>
      [...document.querySelectorAll("li")].map(
        (li) => li.getBoundingClientRect().width,
      ),
    );
    expect(widths.length).toBe(ROWS.length);
    for (const w of widths) expect(w).toBeGreaterThan(240);
  });

  test("the long description stays on the page and does not wrap to one character per line", async ({
    mount,
    page,
  }) => {
    await mount(<TxRowGroupHarness {...PROPS} />);
    const longRow = page.locator("#txn-c");
    await expect(longRow).toBeVisible();
    const descBox = (await longRow
      .locator("text=SQ *THE VERY LONG COFFEE ROASTERS")
      .first()
      .boundingBox())!;
    // A one-character-per-line collapse makes the text block nearly as tall
    // as it is wide (a vertical sliver). A healthy wrap stays wide relative
    // to its height even while wrapping across a few lines.
    expect(descBox.width).toBeGreaterThan(descBox.height);
    expect(descBox.width).toBeGreaterThan(200);
  });

  test("only the selectable rows get a checkbox, applied rows do not", async ({
    mount,
    page,
  }) => {
    await mount(<TxRowGroupHarness {...PROPS} />);
    // a, b, c are selectable; d is already applied and structurally excluded
    // from the selection model (isSelectable), so it renders no checkbox at
    // all, not a disabled one.
    const rowCheckboxCount = await page
      .locator('li input[type="checkbox"]')
      .count();
    expect(rowCheckboxCount).toBe(3);
    await expect(page.locator("#txn-d")).toContainText("Applied as");
  });

  test("select all reaches every selectable row and the action bar shows the count", async ({
    mount,
    page,
  }) => {
    await mount(<TxRowGroupHarness {...PROPS} />);
    await page.getByLabel("Select all 3").check();
    await expect(page.getByText("3 selected of 3")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Apply \(3\)/ })).toBeVisible();
  });

  test("screenshot", async ({ mount, page }) => {
    await mount(<TxRowGroupHarness {...PROPS} />);
    await expect(page).toHaveScreenshot("import-batch-selection-fold.png", {
      fullPage: true,
    });
  });
});

test.describe("desktop", () => {
  test.use({ viewport: DESKTOP });

  test("nothing overflows horizontally", async ({ mount, page }) => {
    await mount(<TxRowGroupHarness {...PROPS} />);
    expect(await horizontalOffenders(page, DESKTOP.width)).toEqual([]);
  });

  test("screenshot", async ({ mount, page }) => {
    await mount(<TxRowGroupHarness {...PROPS} />);
    await expect(page).toHaveScreenshot("import-batch-selection-desktop.png", {
      fullPage: true,
    });
  });
});
