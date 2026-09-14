import { test, expect } from "@playwright/experimental-ct-react";
import { StatusBarBand } from "./StatusBarBand";

test.describe("status bar band", () => {
  test("paints the page ground on paper and navy under the app header", async ({ mount, page }) => {
    await mount(
      <div data-skin="instrument" style={{ ["--app-safe-top" as string]: "44px" }}>
        <StatusBarBand />
      </div>,
    );
    const band = page.locator("#status-bar-band");
    await expect(band).toHaveCSS("height", "44px");
    await expect(band).toHaveCSS("background-color", "rgb(242, 245, 248)");
    await page.evaluate(() => {
      document.documentElement.dataset.bar = "navy";
    });
    await expect(band).toHaveCSS("background-color", "rgb(18, 26, 42)");
  });
});
