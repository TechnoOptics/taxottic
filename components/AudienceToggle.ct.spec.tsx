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
      <div className="p-4" style={{ background: "#1d2843" }}>
        <AudienceToggle audience="personal" />
      </div>,
    );

    for (const name of LABELS) {
      const tab = page.getByRole("tab", { name, exact: true });
      await expect(tab, `"${name}" segment is missing`).toHaveCount(1);
      const box = (await tab.boundingBox())!;
      // One line of 12px text plus padding is ~34px; two lines are ~50px.
      expect(Math.round(box.height), `"${name}" wrapped to two lines`).toBeLessThan(40);
      expect(
        Math.round(box.x + box.width),
        `"${name}" overflows the ${FOLD_COVER.width}px viewport`,
      ).toBeLessThanOrEqual(FOLD_COVER.width + 1);
    }

    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(docOverflow, "the toggle must not scroll the page sideways").toBeLessThanOrEqual(0);
  });
});
