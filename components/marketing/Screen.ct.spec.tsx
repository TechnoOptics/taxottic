import { test, expect } from "@playwright/experimental-ct-react";
import { MiniMap } from "./Screen";

/**
 * The drives map is the one product screen that paints the navy band
 * outside the instrument panel, so the marks drawn on it have to resolve
 * the skin's DARK token values. They did not: `.mini-map` painted
 * `var(--navy-band)` while the page around it was still the paper scope,
 * so `--accent-2` resolved to the paper brass (#c0973f, rgb(192,151,63))
 * and the drive path was the wrong gold on navy.
 *
 * Source-level guards cannot see that: the markup said `var(--accent-2)`
 * both before and after. Only a rendered check reads the resolved value,
 * so this mounts MiniMap with NO surrounding scope, the way a marketing
 * page renders it, and reads the computed stroke.
 */
test.describe("MiniMap", () => {
  test("carries its own dark skin scope, so its marks take the navy brass", async ({
    mount,
    page,
  }) => {
    await mount(
      <div style={{ padding: 16, background: "#f2f5f8", width: 400 }}>
        <MiniMap />
      </div>,
    );

    const path = page.locator(".mini-map svg path[stroke]");
    await expect(path).toHaveCount(1);
    // #d4ae5c: [data-skin="instrument"][data-theme="dark"] --accent-2.
    // The paper value, #c0973f / rgb(192, 151, 63), is the regression.
    expect(await path.evaluate((el) => getComputedStyle(el).stroke)).toBe("rgb(212, 174, 92)");

    const endDisc = page.locator(".mini-map svg circle").last();
    expect(await endDisc.evaluate((el) => getComputedStyle(el).fill)).toBe("rgb(212, 174, 92)");

    // The basemap stays navy: the spec's Navy rule names the drives map
    // alongside the instrument panel as the two places it is allowed.
    const map = page.locator(".mini-map");
    const bg = await map.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain("rgb(42, 58, 94)"); // --navy-high
    expect(bg).toContain("rgb(18, 26, 42)"); // --navy-deep
  });
});
