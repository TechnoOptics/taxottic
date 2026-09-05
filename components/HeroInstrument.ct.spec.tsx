import { test, expect } from "@playwright/experimental-ct-react";
import { HeroInstrument } from "./HeroInstrument";

/**
 * The brief's own className combination for the three stat figures was
 * inert: Tailwind arbitrary utilities (`text-[2.125rem]`, `text-[var(--accent-2)]`)
 * live in `@layer utilities`, and the unlayered `[data-skin="instrument"]
 * .stat-value` rule from Task 4 wins over them regardless of specificity.
 * This pins the rendered size and colour of each figure, and that the
 * renamed `.stat-row-*` classes do not inherit the legacy `.stat-label` /
 * `.stat-value` tracking, transform and margin that Task 4 accidentally
 * shared with unrelated in-app components.
 */

const SAMPLE = {
  heading: "Q3 · due Sep 15 · 10 days",
  nextPaymentCents: 342_000,
  setAsideCents: 215_000,
  ledger: [{ date: "Sep 4", text: "Drive, client site, 22.7 mi", amount: "-$16" }],
  foot: "Sample",
};

test.describe("HeroInstrument stat rows", () => {
  test("figures render at the intended size and colour, labels carry no legacy styling", async ({
    mount,
    page,
  }) => {
    await mount(
      <div data-skin="instrument" style={{ padding: 16, background: "#f2f5f8" }}>
        <HeroInstrument taxYear={2026} asOf={new Date("2026-09-05T00:00:00Z")} sample={SAMPLE} />
      </div>,
    );

    const nextPayment = page.locator("#hero-next-payment");
    await expect(nextPayment).toHaveText("$3,420");
    const nextPaymentStyle = await nextPayment.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, fontSize: s.fontSize };
    });
    expect(nextPaymentStyle.color).toBe("rgb(212, 174, 92)");
    expect(nextPaymentStyle.fontSize).toBe("34px");

    const values = page.locator("dd.stat-row-value");
    await expect(values).toHaveCount(3);

    const secondValueStyle = await values.nth(1).evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, fontSize: s.fontSize, marginTop: s.marginTop };
    });
    expect(secondValueStyle.fontSize).toBe("34px");
    expect(secondValueStyle.color).toBe("rgb(238, 242, 247)");

    const marginTops = await values.evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).marginTop),
    );
    for (const m of marginTops) expect(m).toBe("0px");

    const labels = page.locator("dt.stat-row-label");
    await expect(labels).toHaveCount(3);
    const labelStyles = await labels.evaluateAll((els) =>
      els.map((el) => {
        const s = getComputedStyle(el);
        return { textTransform: s.textTransform, letterSpacing: s.letterSpacing };
      }),
    );
    for (const s of labelStyles) {
      expect(s.textTransform).toBe("none");
      // Not "normal": body sets a sitewide -0.006em whisper of tracking
      // (app/globals.css ~line 987), which every element inherits as a
      // resolved px value. The removed legacy `.stat-label` rule added its
      // own wide +0.05em letter-spacing on top of that; this assertion
      // pins that the wide legacy tracking is gone, not that tracking is
      // literally unset.
      expect(s.letterSpacing).toBe("-0.096px");
    }

    await expect(values.nth(2)).toHaveText("$1,270");
  });
});
