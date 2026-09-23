import { test, expect } from "@playwright/experimental-ct-react";
import { UserMenu } from "./UserMenu";

/**
 * The account control (the avatar/initials trigger in the header) is the
 * only way to reach sign out, security, and every account setting. At
 * 344px it previously rendered at 36x36 (size-9), under the 44px tap
 * target minimum. Pinned in both themes: authenticated pages render
 * html[data-theme="dark"] (see DarkThemeMount), and the trigger's own
 * classes carry no dark: variant, so a regression there would only show
 * up by actually mounting under the dark attribute.
 */

test("the account control is a 44x44 target", async ({ mount, page }) => {
  await page.setViewportSize({ width: 344, height: 700 });
  await mount(
    <div data-skin="instrument">
      <UserMenu email={null} />
    </div>,
  );
  const box = await page.getByRole("button").first().boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
});

test("the account control is a 44x44 target in dark theme too", async ({ mount, page }) => {
  await page.setViewportSize({ width: 344, height: 700 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await mount(
    <div data-skin="instrument">
      <UserMenu email={null} />
    </div>,
  );
  const trigger = page.getByRole("button").first();
  await expect(trigger).toBeVisible();
  const box = await trigger.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
});
