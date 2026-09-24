import { test, expect } from "@playwright/experimental-ct-react";
import { AudienceToggle } from "./AudienceToggle";

/**
 * The audience toggle is the first control on the marketing home page.
 * On phones it wrapped every label onto two lines ("For / me",
 * "For my / business") and read as broken before the reader had seen a
 * headline. This pins the fix on the narrowest device we ship to.
 */

// Galaxy Z Fold5 cover screen: ~344x882 CSS px, the narrowest real device.
const FOLD_COVER = { width: 344, height: 882 };

const LABELS = ["For me", "For my business", "For my firm"];

test.describe("Audience toggle, Fold cover screen", () => {
  test.use({ viewport: FOLD_COVER });

  test("every segment sets on one line inside the viewport", async ({
    mount,
    page,
  }) => {
    await mount(
      <div data-skin="instrument" className="p-4" style={{ background: "#f2f5f8" }}>
        <AudienceToggle audience="personal" />
      </div>,
    );

    for (const name of LABELS) {
      const tab = page.getByRole("tab", { name, exact: true });
      await expect(tab, `"${name}" segment is missing`).toHaveCount(1);
      const box = (await tab.boundingBox())!;
      // .audience-seg now carries a 44px min-height (the tap-target floor),
      // so a single line and a genuine two-line wrap sit only a few px
      // apart in box height and a fixed threshold would be too fragile.
      // Read the text's own line count instead: a Range over the label's
      // text node reports one client rect per rendered line.
      const lineCount = await tab.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getClientRects().length;
      });
      expect(lineCount, `"${name}" wrapped to two lines`).toBe(1);
      expect(
        Math.round(box.x + box.width),
        `"${name}" overflows the ${FOLD_COVER.width}px viewport`,
      ).toBeLessThanOrEqual(FOLD_COVER.width + 1);
    }

    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(docOverflow, "the toggle must not scroll the page sideways").toBeLessThanOrEqual(0);

    const first = page.getByRole("tab", { name: "For me", exact: true });
    await expect(first).toHaveAttribute("aria-selected", "true");
    // The harness has no next/font variables, so the face itself cannot be
    // asserted here; the switch's setting (mono label rules) can.
    const setting = await first.evaluate((el) => {
      const cs = getComputedStyle(el.parentElement!);
      return { transform: cs.textTransform, tracking: cs.letterSpacing };
    });
    expect(setting.transform, "the switch is set as a mono label").toBe("uppercase");
    expect(setting.tracking, "the switch is tracked like a mono label").not.toBe("normal");
  });

  test("every segment is at least 44px tall on a phone", async ({ mount, page }) => {
    await page.setViewportSize({ width: 344, height: 700 });
    await mount(
      <div data-skin="instrument">
        <AudienceToggle audience="personal" />
      </div>,
    );
    const heights = await page.getByRole("tab").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  });
});
