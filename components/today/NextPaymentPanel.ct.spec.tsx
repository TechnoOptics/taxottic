import { test, expect } from "@playwright/experimental-ct-react";
import { NextPaymentPanel } from "./NextPaymentPanel";

const summary = {
  next: { quarter: 3 as const, dueDate: "2026-09-15", daysUntil: 10, amountCents: 342000 },
  paidSoFarCents: 215000,
  stillToPayCents: 342000,
  progress: 215000 / 557000,
};

for (const theme of ["light", "dark"] as const) {
  test(`the next payment leads in brass, the rest in ink, readable in ${theme}`, async ({ mount, page }) => {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await mount(
      <div data-skin="instrument" data-grammar="year" style={{ width: 360, padding: 16 }}>
        <NextPaymentPanel summary={summary} federalCents={276000} stateCents={66000} forecastHref="/personal/forecast" />
      </div>,
    );
    const figure = page.locator("#today-next-payment");
    await expect(figure).toHaveText("$3,420");
    const color = await figure.evaluate((e) => getComputedStyle(e).color);
    expect(color).toBe(theme === "dark" ? "rgb(212, 174, 92)" : "rgb(138, 106, 28)");
    await expect(page.getByText("Q3 · due Sep 15 · 10 days")).toBeVisible();
    await expect(page.getByText("Paid so far")).toBeVisible();
    await expect(page.getByText("Still to pay")).toBeVisible();
    const bar = page.locator(".today-progress i");
    expect(await bar.evaluate((e) => parseFloat(getComputedStyle(e).width) / parseFloat(getComputedStyle(e.parentElement!).width))).toBeCloseTo(215000 / 557000, 1);
    // every figure is mono
    const fonts = await page.locator(".figure").evaluateAll((els) => els.map((e) => getComputedStyle(e).fontVariantNumeric));
    for (const f of fonts) expect(f).toContain("tabular-nums");

    // The panel label ("Next payment") against the panel's own ground, in
    // whichever theme this iteration is in. Composite everything behind
    // the text onto a canvas and read one pixel, so color-mix() and alpha
    // resolve the way the screen does without a PNG decoder; same
    // technique as components/mileage/LocationBlockedStrip.ct.spec.tsx.
    const ratio = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      const px = () => Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
      const paint = (c: string) => {
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
      };
      const stack = (...layers: string[]) => {
        ctx.clearRect(0, 0, 1, 1);
        paint("#fff");
        for (const l of layers) paint(l);
        return px();
      };
      const bgOf = (el: Element) => getComputedStyle(el).backgroundColor;
      const panel = document.querySelector(".today-panel")!;
      const label = document.querySelector<HTMLElement>(".today-lead-label")!;
      const ground = [bgOf(document.documentElement), bgOf(document.body), bgOf(panel.closest("[data-skin]")!), bgOf(panel)];
      const lum = ([r, g, b]: number[]) => {
        const f = (c: number) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const contrast = (fg: number[], bg: number[]) => {
        const l1 = lum(fg);
        const l2 = lum(bg);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      };
      const panelGround = stack(...ground);
      const textColor = stack(getComputedStyle(label).color);
      return contrast(textColor, panelGround);
    });
    expect(ratio, `"Next payment" against the panel ground in ${theme}`).toBeGreaterThanOrEqual(4.5);
  });
}

/**
 * A combined figure has to say so. The dashboard passes the note only on
 * the company branch, where the owner's sole proprietorship folds into
 * their personal return, so the panel must render it when it is given and
 * add nothing when it is not.
 */
test("the note names what the figure includes, and only when there is one", async ({ mount, page }) => {
  await mount(
    <div data-skin="instrument" data-grammar="year" style={{ width: 360, padding: 16 }}>
      <NextPaymentPanel summary={summary} federalCents={276000} stateCents={66000} forecastHref="/personal/forecast" note="Includes Bella Cleaning" />
    </div>,
  );
  const note = page.locator(".today-note");
  await expect(note).toHaveText("Includes Bella Cleaning");
  // Plain type under the split line, never a second figure.
  await expect(note.locator(".figure")).toHaveCount(0);
});

test("no note, no line", async ({ mount, page }) => {
  await mount(
    <div data-skin="instrument" data-grammar="year" style={{ width: 360, padding: 16 }}>
      <NextPaymentPanel summary={summary} federalCents={276000} stateCents={66000} forecastHref="/personal/forecast" />
    </div>,
  );
  await expect(page.locator(".today-note")).toHaveCount(0);
});
