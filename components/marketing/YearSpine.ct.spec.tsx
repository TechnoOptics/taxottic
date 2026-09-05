import { test, expect } from "@playwright/experimental-ct-react";
import { YearSpine } from "./YearSpine";
import { taxYearRunway } from "@/lib/marketing/tax-year-runway";

/**
 * The spine is the Year grammar's signature. Its ticks must sit where the
 * runway says the due dates are, at every width we ship to, and today's
 * marker must sit at the fill. A tick one percent off reads as "Sep 15"
 * landing in October.
 */
const AS_OF = new Date("2026-09-05T00:00:00Z");
const WIDTHS = [344, 375, 1280];

for (const width of WIDTHS) {
  test.describe(`YearSpine at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("ticks and today sit at the runway's fractions", async ({ mount, page }) => {
      await mount(
        <div data-skin="instrument" style={{ padding: 16, background: "#f2f5f8" }}>
          <YearSpine taxYear={2026} asOf={AS_OF} variant="paper" id="spine" />
        </div>,
      );
      const rail = page.locator("#spine .runway-rail");
      const railBox = (await rail.boundingBox())!;
      const r = taxYearRunway(2026, AS_OF);

      const ticks = page.locator("#spine .runway-tick");
      await expect(ticks).toHaveCount(4);
      for (let i = 0; i < 4; i++) {
        const box = (await ticks.nth(i).boundingBox())!;
        const at = (box.x - railBox.x) / railBox.width;
        expect(Math.abs(at - r.ticks[i].at), `tick ${i} is off`).toBeLessThan(0.005);
      }
      const today = (await page.locator("#spine .runway-today").boundingBox())!;
      expect(Math.abs((today.x - railBox.x) / railBox.width - r.fill)).toBeLessThan(0.005);

      const fill = (await page.locator("#spine .runway-fill").boundingBox())!;
      expect(Math.abs(fill.width / railBox.width - r.fill)).toBeLessThan(0.005);

      await expect(page.locator("#spine .runway-today-label")).toHaveText(/Today · Sep 5/i);
      await expect(page.locator("#spine .year-spine-row")).toContainText(/Q3 due in 10 days/i);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "the spine must not scroll the page sideways").toBeLessThanOrEqual(0);
    });
  });
}

test("panel variant shows the trailing text and no Today prefix", async ({ mount, page }) => {
  await mount(
    <div className="skin-scope" data-skin="instrument" data-theme="dark" style={{ padding: 16, background: "#1d2843" }}>
      <YearSpine taxYear={2026} asOf={AS_OF} variant="panel" trailing="Sample" id="p" />
    </div>,
  );
  await expect(page.locator("#p .year-spine-row")).toContainText("Sample");
  await expect(page.locator("#p .runway-today-label")).toHaveText("Sep 5");
});
