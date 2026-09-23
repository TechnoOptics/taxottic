import { test, expect } from "@playwright/experimental-ct-react";
import { TabBar } from "./TabBar";

/**
 * The bar is mounted inside `.app-header`, which carries `backdrop-filter`,
 * `overflow-x: clip` and `isolation: isolate`. Any one of those makes the
 * header the containing block for a `position: fixed` descendant, so a bar
 * that merely computes to `fixed` still lands inside the ~52px header and
 * paints clipped under the top bar. Geometry is the only assertion that can
 * tell the two apart, so the wrapper below reproduces the header's three
 * properties and the test measures where the bar actually sits.
 */
const HEADER_LIKE = { backdropFilter: "blur(4px)", overflowX: "clip" as const, isolation: "isolate" as const, height: 52 };

/**
 * The bar portals to <body>, and in the real app `data-skin="instrument"`
 * lives on <body> (app/layout.tsx), so the skin's rules still reach it.
 * The harness mounts into a bare document, so set the same attribute the
 * app sets, the way the other Today specs set document.documentElement's
 * theme.
 */
async function skinTheBody(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    document.body.dataset.skin = "instrument";
  });
}

test("five 44px targets on a phone, the current one in the foreground, More opens the rail", async ({ mount, page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await skinTheBody(page);
  await mount(
    <div data-skin="instrument">
      <TabBar companies={[{ public_id: "abc", role: "manager" }]} storedMode="business" forceNative />
    </div>,
  );
  const tabs = page.getByRole("link").or(page.getByRole("button"));
  await expect(tabs).toHaveCount(5);
  for (const b of await tabs.all()) {
    const box = await b.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  const fired = page.evaluate(() => new Promise<boolean>((r) => window.addEventListener("taxottic:open-rail", () => r(true), { once: true })));
  await page.getByRole("button", { name: "More" }).click();
  expect(await fired).toBe(true);
});

test("the bar sits on the viewport's bottom edge even inside a header-like containing block", async ({ mount, page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await skinTheBody(page);
  await mount(
    <div data-skin="instrument" style={HEADER_LIKE}>
      <TabBar companies={[{ public_id: "abc", role: "manager" }]} storedMode="business" forceNative />
    </div>,
  );
  const bar = page.locator("nav.tab-bar");
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(Math.abs(box.y + box.height - viewportHeight), "the bar must end at the viewport's bottom edge").toBeLessThanOrEqual(1);
});

/**
 * The clearance the attribute buys only exists where the bar is painted.
 * The nav is `lg:hidden`, so above lg an iPad was reserving 56px under
 * every page for a bar that was never there. The attribute follows the
 * same media query the nav does, and the padding rule it drives has to
 * beat the FAB's own clearance rule, which has the same specificity and
 * comes later in globals.css.
 */
for (const [width, expected] of [[375, true], [1280, false]] as const) {
  test(`html[data-tab-bar] is ${expected} at ${width}`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 800 });
    await skinTheBody(page);
    await mount(
      <div data-skin="instrument">
        <TabBar companies={[{ public_id: "abc", role: "manager" }]} storedMode="business" forceNative />
      </div>,
    );
    // The bar portals on a second render, so wait for it to land before
    // reading what its effect wrote.
    await expect(page.locator("nav.tab-bar")).toHaveCount(1);
    const set = await page.evaluate(() => document.documentElement.hasAttribute("data-tab-bar"));
    expect(set, `data-tab-bar at ${width}`).toBe(expected);
  });
}

test("the bar's clearance beats the FAB's on a phone", async ({ mount, page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await skinTheBody(page);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
    const main = document.createElement("main");
    main.id = "clearance-probe";
    document.body.appendChild(main);
  });
  await mount(
    <div data-skin="instrument">
      <TabBar companies={[{ public_id: "abc", role: "manager" }]} storedMode="business" forceNative />
    </div>,
  );
  await expect(page.locator("nav.tab-bar")).toBeVisible();
  const padding = await page.evaluate(() => getComputedStyle(document.querySelector("#clearance-probe")!).paddingBottom);
  // 56px of bar, not the FAB rule's 5rem.
  expect(padding).toBe("56px");
});
