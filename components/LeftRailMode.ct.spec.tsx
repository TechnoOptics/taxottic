import { test, expect } from "@playwright/experimental-ct-react";
import { LeftRail } from "./LeftRail";

/**
 * The Personal / Business toggle after the "remember the last mode" change.
 *
 * Two things are under test:
 *
 *   1. The toggle is actually tappable on the narrowest device we ship to.
 *      It is the control users were hitting over and over, and it was ~30px
 *      before, under the 44px the design system fixes for .btn / .input.
 *   2. The rail persists the workspace mode from the ROUTE, and specifically
 *      does NOT do so on /dashboard. /dashboard is the ambiguous route the
 *      restore exists to fix; if the rail treated it as a personal signal it
 *      would wipe a remembered "business" the moment the user landed there,
 *      which is the whole bug.
 *
 * See docs/superpowers/specs/2026-08-06-remember-workspace-mode-design.md.
 */

// Galaxy Z Fold5 cover screen: ~344x882 CSS px, the narrowest real device.
const FOLD_COVER = { width: 344, height: 882 };

const COMPANIES = [
  { publicId: "acme", name: "Acme Consulting LLC", role: "manager" as const },
  { publicId: "beta", name: "Beta Holdings", role: "manager" as const },
];

/** Put the harness on a route before mounting; LeftRail reads it on render. */
async function setRoute(page: import("@playwright/test").Page, path: string) {
  await page.evaluate((p) => {
    window.__CT_PATHNAME__ = p;
    window.__CT_MODE_WRITES__ = [];
  }, path);
}

async function modeWrites(page: import("@playwright/test").Page) {
  return page.evaluate(() => window.__CT_MODE_WRITES__ ?? []);
}

const SEGMENTS = ["Personal", "Business"];

test.describe("Workspace toggle, Fold cover screen", () => {
  test.use({ viewport: FOLD_COVER });

  test("both segments meet the 44px tap target and stay in the viewport", async ({
    mount,
    page,
  }) => {
    await setRoute(page, "/c/acme/forecast");
    await mount(
      <div className="p-2">
        <LeftRail mode="sheet" companies={COMPANIES} storedMode="business" />
      </div>,
    );

    await expect(page.locator('nav[aria-label="Main menu"]')).toBeVisible();

    for (const name of SEGMENTS) {
      const seg = page.getByRole("link", { name, exact: true });
      await expect(seg, `"${name}" segment is missing`).toHaveCount(1);
      const box = (await seg.boundingBox())!;
      expect(
        Math.round(box.height),
        `"${name}" tap target is under 44px`,
      ).toBeGreaterThanOrEqual(44);
      expect(
        Math.round(box.x + box.width),
        `"${name}" overflows the ${FOLD_COVER.width}px viewport`,
      ).toBeLessThanOrEqual(FOLD_COVER.width + 1);
    }

    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(docOverflow, "the rail must not scroll the page sideways").toBeLessThanOrEqual(0);

    await page.screenshot({ path: "test-results/mode-toggle-fold-344.png" });
  });

  test("a personal-only user (no companies) still gets a usable toggle", async ({
    mount,
    page,
  }) => {
    // The no-business-at-all case. Business is offered but disabled-looking,
    // and nothing here may send them into a company surface.
    await setRoute(page, "/personal/forecast");
    await mount(
      <div className="p-2">
        <LeftRail mode="sheet" companies={[]} storedMode={null} />
      </div>,
    );

    const business = page.getByRole("link", { name: "Business", exact: true });
    await expect(business).toHaveAttribute("href", "/companies/new");
    // Personal is the selected segment, and no company nav is rendered.
    await expect(
      page.getByRole("link", { name: "Personal", exact: true }),
    ).toHaveAttribute("aria-current", "true");

    await page.screenshot({ path: "test-results/mode-toggle-fold-no-business.png" });
  });
});

test.describe("Workspace toggle, desktop rail", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("renders the business workspace with the company nav", async ({
    mount,
    page,
  }) => {
    await setRoute(page, "/c/acme/forecast");
    await mount(<LeftRail mode="rail" companies={COMPANIES} storedMode="business" />);

    await expect(page.locator('nav[aria-label="Main menu"]')).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Business", exact: true }),
    ).toHaveAttribute("aria-current", "true");

    for (const name of SEGMENTS) {
      const box = (await page
        .getByRole("link", { name, exact: true })
        .boundingBox())!;
      expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
    }

    await page.screenshot({ path: "test-results/mode-toggle-desktop-1280.png" });
  });

  test("renders the personal workspace with no business surfaces", async ({
    mount,
    page,
  }) => {
    await setRoute(page, "/personal/forecast");
    await mount(<LeftRail mode="rail" companies={COMPANIES} storedMode="personal" />);

    await expect(
      page.getByRole("link", { name: "Personal", exact: true }),
    ).toHaveAttribute("aria-current", "true");

    // The separation guarantee: nothing business-side leaks into personal.
    for (const forbidden of ["Companies", "Mileage", "Chat", "Team", "Dashboard"]) {
      await expect(
        page.getByRole("link", { name: forbidden, exact: true }),
        `"${forbidden}" must not appear in the personal workspace`,
      ).toHaveCount(0);
    }

    await page.screenshot({ path: "test-results/mode-toggle-desktop-personal.png" });
  });
});

test.describe("Persisting the mode from the route", () => {
  test.use({ viewport: FOLD_COVER });

  test("a business route records business when personal was stored", async ({
    mount,
    page,
  }) => {
    await setRoute(page, "/c/acme/expenses");
    await mount(
      <div className="p-2">
        <LeftRail mode="sheet" companies={COMPANIES} storedMode="personal" />
      </div>,
    );
    await expect(page.locator('nav[aria-label="Main menu"]')).toBeVisible();
    await expect
      .poll(() => modeWrites(page), {
        message: "following a deep link into a company must record business",
      })
      .toEqual(["business"]);
  });

  test("a route that already matches the stored mode writes nothing", async ({
    mount,
    page,
  }) => {
    await setRoute(page, "/c/acme/expenses");
    await mount(
      <div className="p-2">
        <LeftRail mode="sheet" companies={COMPANIES} storedMode="business" />
      </div>,
    );
    await expect(page.locator('nav[aria-label="Main menu"]')).toBeVisible();
    await page.waitForTimeout(200);
    expect(
      await modeWrites(page),
      "steady state must cost zero writes",
    ).toEqual([]);
  });

  // The one that protects the whole feature.
  test("/dashboard never overwrites a remembered business mode", async ({
    mount,
    page,
  }) => {
    await setRoute(page, "/dashboard");
    await mount(
      <div className="p-2">
        <LeftRail mode="sheet" companies={COMPANIES} storedMode="business" />
      </div>,
    );
    await expect(page.locator('nav[aria-label="Main menu"]')).toBeVisible();
    await page.waitForTimeout(200);
    expect(
      await modeWrites(page),
      "/dashboard is ambiguous and must leave the stored mode alone",
    ).toEqual([]);
  });

  test("shared routes such as /goals leave the stored mode alone", async ({
    mount,
    page,
  }) => {
    await setRoute(page, "/goals");
    await mount(
      <div className="p-2">
        <LeftRail mode="sheet" companies={COMPANIES} storedMode="business" />
      </div>,
    );
    await expect(page.locator('nav[aria-label="Main menu"]')).toBeVisible();
    await page.waitForTimeout(200);
    expect(await modeWrites(page)).toEqual([]);
  });
});
