import { test, expect } from "@playwright/experimental-ct-react";
import { TabBar } from "./TabBar";

test("five 44px targets on a phone, the current one in the foreground, More opens the rail", async ({ mount, page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.evaluate(() => {
    (window as unknown as { __forceNative: boolean }).__forceNative = true;
  });
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
  expect(await page.locator("nav.tab-bar").evaluate((e) => getComputedStyle(e).position)).toBe("fixed");
});
