import { test, expect } from "@playwright/experimental-ct-react";
import { IncomeRow } from "./IncomeRow";
import { LeftRailMobile } from "./LeftRailMobile";
import { UserMenu } from "./UserMenu";
import { formatCents } from "@/lib/tax/forecast";

// Galaxy Z Fold5 COVER screen: 904x2316 physical at 420dpi => ~344x882 CSS px.
// This is the narrowest real device the app ships to, and every defect below
// was reported from it.
const FOLD_COVER = { width: 344, height: 882 };

test.use({ viewport: FOLD_COVER });

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Shaped like the reporter's real data: several rows in the open month,
// long bank-import notes, recurring cadence badges.
const ROWS = [
  { id: "1", month: 7, amount_cents: 309000, source: "sales", recurrence: "one_off",
    notes: "Stripe charge - 3-Month Strategic Development Retainer, second installment" },
  { id: "2", month: 7, amount_cents: 125000, source: "services", recurrence: "monthly",
    notes: "Stripe charge - Subscription update" },
  { id: "3", month: 7, amount_cents: 1200, source: "sales", recurrence: "monthly",
    notes: "Stripe charge from a fairly long customer name - Subscription" },
];

function noop() {
  return Promise.resolve();
}

/** Every element whose border box escapes the viewport horizontally. */
async function horizontalOffenders(
  page: import("@playwright/test").Page,
  viewportWidth: number = FOLD_COVER.width,
) {
  return page.evaluate((vw) => {
    const out: { tag: string; cls: string; left: number; right: number; w: number }[] = [];
    document.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.right > vw + 1 || r.left < -1) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute("class") ?? "").slice(0, 90),
          left: Math.round(r.left),
          right: Math.round(r.right),
          w: Math.round(r.width),
        });
      }
    });
    return out;
  }, viewportWidth);
}

const MENU = '[role="menu"]';
const ACCOUNT_BUTTON = 'button[aria-label="Account menu"]';

/**
 * Open the account menu and wait until it is actually in the DOM.
 *
 * The wait is required, not defensive padding. UserMenu gates its portal on
 * `open && anchor && mounted`, and `anchor` is populated by a useEffect that
 * runs AFTER the click's commit, so the menu is never present in the same
 * task as the click. A bare `page.evaluate` straight after `click()` is
 * therefore racing a render tick: locally the CDP round-trip is slower than
 * the tick so the menu is always there, but on a loaded CI runner the
 * evaluate can win the race and `querySelector` returns null. Measured with
 * an in-page probe: same task -> absent, one tick later -> present.
 *
 * `expect(...).toBeVisible()` polls for that exact condition, so it costs
 * nothing when the menu is already up and cannot mask a genuine regression
 * the way a fixed sleep would.
 */
async function openAccountMenu(page: import("@playwright/test").Page, label = "") {
  await page.locator(ACCOUNT_BUTTON).click();
  await expect(
    page.locator(MENU),
    `account menu did not open${label ? ` (${label})` : ""}`,
  ).toBeVisible();
}

async function closeAccountMenu(page: import("@playwright/test").Page) {
  await page.locator(ACCOUNT_BUTTON).click();
  await expect(page.locator(MENU)).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// Defect 1: the Year-to-date accordion on /c/[publicId]/income
// ---------------------------------------------------------------------------
// Markup mirrors app/c/[publicId]/income/page.tsx (the .card > ul.grid >
// li > details block) so the container chain under test is the real one.
test.describe("Income year-to-date accordion", () => {
  test("expanded month stays inside a 344px viewport", async ({ mount, page }) => {
    const monthTotal = ROWS.reduce((a, r) => a + r.amount_cents, 0);
    await mount(
      <div className="px-4">
        <div className="card mt-6 p-6">
          <div className="flex items-center justify-between">
            <h2 className="display text-xl text-forest-900">Year-to-date</h2>
            <div className="display text-2xl text-forest-900">
              {formatCents(monthTotal)}
            </div>
          </div>
          <ul className="mt-4 grid gap-2">
            <li className="min-w-0">
              <details open className="group rounded-xl border border-forest-100 bg-white overflow-hidden">
                <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none hover:bg-cream/40 list-none">
                  <div className="flex items-center gap-2 min-w-0">
                    <svg className="size-4 text-forest-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 5l6 5-6 5" />
                    </svg>
                    <span className="display text-base text-forest-900 truncate min-w-0">
                      {MONTH_LABELS[6]}
                    </span>
                    <span className="text-xs text-ink-muted whitespace-nowrap shrink-0">
                      · {ROWS.length} entries
                    </span>
                  </div>
                  <div className="display text-base text-forest-900 shrink-0">
                    {formatCents(monthTotal)}
                  </div>
                </summary>
                <ul className="px-3 sm:px-4 pb-3 grid gap-2 border-t border-forest-100">
                  {ROWS.map((r) => (
                    <IncomeRow
                      key={r.id}
                      row={r}
                      companyId="co_test"
                      taxYear={2026}
                      currentMonth={7}
                      updateAction={noop}
                      deleteAction={noop}
                    />
                  ))}
                </ul>
              </details>
            </li>
          </ul>
        </div>
      </div>,
    );

    const offenders = await horizontalOffenders(page);
     
    console.log("VIEW MODE offenders:", JSON.stringify(offenders, null, 1));
    await page.screenshot({ path: "test-results/fold-income-view.png" });

    // Now open an inline edit form (the "drop down list" the report names).
    // force: before the fix the button is pushed outside the viewport and is
    // literally un-tappable, which is the defect; force lets us still measure.
    await page.getByLabel("Edit income entry").first().click({ force: true });
    // Wait for the edit form, otherwise the measurement below can capture the
    // pre-click view state and silently prove nothing.
    await expect(
      page.locator('select[name="month"]'),
      "the inline edit form did not open",
    ).toBeVisible();
    const editOffenders = await horizontalOffenders(page);
     
    console.log("EDIT MODE offenders:", JSON.stringify(editOffenders, null, 1));
    await page.screenshot({ path: "test-results/fold-income-edit.png" });

    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
     
    console.log("doc horizontal overflow px:", docOverflow);
    expect(offenders.concat(editOffenders)).toEqual([]);
  });
});

// Width sweep: the fixes must not trade a narrow-screen bug for a wide-screen
// one. 320 = smallest phone still in the wild, 344 = the Fold cover screen,
// 360/412 = ordinary phones, 768 = tablet, 1280 = desktop.
const WIDTHS = [320, 344, 360, 412, 768, 1280];

test.describe("Width sweep", () => {
  test("income accordion and profile menu fit at every width", async ({ mount, page }) => {
    const monthTotal = ROWS.reduce((a, r) => a + r.amount_cents, 0);
    await mount(
      <div className="px-4">
        <div className="flex justify-end p-2">
          <UserMenu
            email="owner@example.com"
            fullName="Account Owner"
            isSuperAdmin
            currentPlatform="user"
            setPlatformAction={noop}
            setPreviewPlanAction={noop}
            submitFeedbackAction={noop}
          />
        </div>
        <div className="card mt-6 p-6">
          <ul className="mt-4 grid gap-2">
            <li className="min-w-0">
              <details open className="group rounded-xl border border-forest-100 bg-white overflow-hidden">
                <summary className="flex items-center justify-between gap-3 px-4 py-3 list-none">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="display text-base text-forest-900 truncate min-w-0">{MONTH_LABELS[6]}</span>
                  </div>
                  <div className="display text-base text-forest-900 shrink-0">{formatCents(monthTotal)}</div>
                </summary>
                <ul className="px-3 sm:px-4 pb-3 grid gap-2 border-t border-forest-100">
                  {ROWS.map((r) => (
                    <IncomeRow key={r.id} row={r} companyId="co_test" taxYear={2026}
                      currentMonth={7} updateAction={noop} deleteAction={noop} />
                  ))}
                </ul>
              </details>
            </li>
          </ul>
        </div>
      </div>,
    );

    // Recorded per width so the run proves it covered every width. A crash at
    // the first width used to abort the loop while the suite still read as a
    // meaningful sweep; the length assertion at the end makes that impossible.
    const covered: number[] = [];

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 882 });
      // The menu re-anchors on resize, so let that settle before measuring.
      await expect(page.locator(ACCOUNT_BUTTON)).toBeVisible();

      const offenders = await horizontalOffenders(page, width);
      expect(offenders, `horizontal overflow at ${width}px`).toEqual([]);

      await openAccountMenu(page, `${width}px`);

      const signOut = page.locator(MENU).getByRole("button", { name: "Sign out", exact: true });
      await expect(signOut, `Sign out missing from the menu at ${width}px`).toHaveCount(1);

      const fits = await page.evaluate(() => {
        const menu = document.querySelector<HTMLElement>('[role="menu"]');
        if (!menu) throw new Error('[role="menu"] is not in the DOM');
        const signOutEl = [...menu.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "Sign out",
        );
        if (!signOutEl) throw new Error('no "Sign out" button inside [role="menu"]');
        return {
          menuBottom: Math.round(menu.getBoundingClientRect().bottom),
          signOutBottom: Math.round(signOutEl.getBoundingClientRect().bottom),
          signOutHeight: Math.round(signOutEl.getBoundingClientRect().height),
          vh: window.innerHeight,
        };
      });

      console.log(`w=${width}`, JSON.stringify(fits));
      expect(fits.menuBottom, `menu overhangs at ${width}px`).toBeLessThanOrEqual(fits.vh);
      expect(fits.signOutBottom, `Sign out off-screen at ${width}px`).toBeLessThanOrEqual(fits.vh);
      expect(fits.signOutHeight, `Sign out tap target at ${width}px`).toBeGreaterThanOrEqual(44);

      covered.push(width);
      await closeAccountMenu(page);
    }

    expect(covered, "the sweep must measure every width").toEqual(WIDTHS);
  });
});

// ---------------------------------------------------------------------------
// Defect 2: the mobile menu sheet scroll-chains to the page behind it
// ---------------------------------------------------------------------------
test.describe("Mobile menu sheet", () => {
  test("scrolls itself and does not chain to the page", async ({ mount, page }) => {
    await mount(
      <div>
        <div style={{ height: "3000px" }}>tall page behind the sheet</div>
        <LeftRailMobile
          companies={Array.from({ length: 8 }, (_, i) => ({
            publicId: `co_${i}`,
            name: `Company Number ${i + 1}`,
            role: "manager" as const,
          }))}
        />
      </div>,
    );
    // A company route so the sheet renders the full per-company nav group,
    // which is what makes it taller than a cover screen. Set before the
    // first open, because LeftRail only mounts when the sheet opens.
    await page.evaluate(() => {
      window.__CT_PATHNAME__ = "/c/co_0/income";
    });
    await page.getByLabel("Open menu").click();
    // Same discipline as the account menu: wait for the sheet itself rather
    // than assuming the click and the render land in the same task.
    await expect(
      page.locator('nav[aria-label="Main menu"]'),
      "the menu sheet did not open",
    ).toBeVisible();

    const m = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Main menu"]');
      if (!nav) throw new Error('nav[aria-label="Main menu"] is not in the DOM');
      const wrap = nav.parentElement as HTMLElement;
      const cs = getComputedStyle(nav);
      const wr = wrap.getBoundingClientRect();
      const nr = nav.getBoundingClientRect();
      return {
        wrapperMaxHeight: getComputedStyle(wrap).maxHeight,
        wrapperRect: { top: Math.round(wr.top), bottom: Math.round(wr.bottom), h: Math.round(wr.height) },
        navRect: { top: Math.round(nr.top), bottom: Math.round(nr.bottom), h: Math.round(nr.height) },
        navScrollHeight: nav.scrollHeight,
        navClientHeight: nav.clientHeight,
        navIsScrollable: nav.scrollHeight > nav.clientHeight + 1,
        navOverflowY: cs.overflowY,
        navOverscroll: cs.overscrollBehaviorY,
        viewportH: window.innerHeight,
      };
    });
     
    console.log("SHEET metrics:", JSON.stringify(m, null, 1));
    await page.screenshot({ path: "test-results/fold-menu.png" });

    // Behavioural check: wheel over the open sheet, past its own scroll end.
    // The page behind it must not move.
    await page.evaluate(() => window.scrollTo(0, 0));
    const nav = page.locator('nav[aria-label="Main menu"]');
    const box = (await nav.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(150);
    const pageScrolled = await page.evaluate(() => window.scrollY);
     
    console.log("page scrollY after wheeling over the sheet:", pageScrolled);

    expect(m.navRect.top, "sheet must not run off the top of the screen").toBeGreaterThanOrEqual(0);
    expect(m.navIsScrollable, "sheet must be its own scroll container").toBe(true);
    expect(m.navOverscroll, "sheet must not chain scroll to the page").toBe("contain");
    expect(pageScrolled, "page behind the sheet must not scroll").toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Defect 3: profile menu, Sign out / Switch accounts fall off the bottom
// ---------------------------------------------------------------------------
test.describe("Profile menu", () => {
  test("Sign out and Switch accounts are reachable without scrolling", async ({ mount, page }) => {
    await mount(
      <div className="flex justify-end p-2">
        {/* The reporter's own account is a super-admin, so their menu
            carries both extra segments (Switch portal, Preview plan). */}
        <UserMenu
          email="owner@example.com"
          fullName="Account Owner"
          isSuperAdmin
          currentPlatform="user"
          setPlatformAction={noop}
          setPreviewPlanAction={noop}
          submitFeedbackAction={noop}
        />
      </div>,
    );
    await openAccountMenu(page);

    // Assert the pieces the measurement depends on BEFORE evaluating, so a
    // missing element fails with its own name rather than a null dereference
    // stack trace that says nothing about what was being checked.
    for (const name of ["Switch accounts", "Sign out"]) {
      await expect(
        page.locator(MENU).getByRole("button", { name, exact: true }),
        `"${name}" is missing from the profile menu`,
      ).toHaveCount(1);
    }

    const m = await page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>('[role="menu"]');
      if (!menu) throw new Error('[role="menu"] is not in the DOM');
      const r = menu.getBoundingClientRect();
      const find = (label: string) => {
        const el = [...menu.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === label,
        );
        if (!el) throw new Error(`no "${label}" button inside [role="menu"]`);
        return el;
      };
      const rect = (el: HTMLElement) => ({
        top: Math.round(el.getBoundingClientRect().top),
        bottom: Math.round(el.getBoundingClientRect().bottom),
      });
      return {
        menuRect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) },
        maxHeight: getComputedStyle(menu).maxHeight,
        scrollHeight: menu.scrollHeight,
        clientHeight: menu.clientHeight,
        isScrollable: menu.scrollHeight > menu.clientHeight + 1,
        signOut: rect(find("Sign out")),
        switchAccounts: rect(find("Switch accounts")),
        viewportH: window.innerHeight,
      };
    });
     
    console.log("PROFILE MENU metrics:", JSON.stringify(m, null, 1));
    await page.screenshot({ path: "test-results/fold-profile.png" });

    expect(m.menuRect.bottom, "menu must not extend past the viewport").toBeLessThanOrEqual(m.viewportH);
    expect(m.switchAccounts.bottom, "Switch accounts must be on screen").toBeLessThanOrEqual(m.viewportH);
    expect(m.signOut.bottom, "Sign out must be on screen").toBeLessThanOrEqual(m.viewportH);
  });
});
