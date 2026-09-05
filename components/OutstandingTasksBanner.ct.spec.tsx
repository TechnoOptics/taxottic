import { test, expect } from "@playwright/experimental-ct-react";
import { OutstandingTasksBanner } from "./OutstandingTasksBanner";

/**
 * The outstanding-tasks strip is the first thing under the greeting on
 * /dashboard whenever a drive or transaction still needs a business-or-
 * personal call. Its fill was `bg-gold-50/70`, a translucent light tint
 * with no dark twin, under text the dark theme flips to cream: in every
 * dark screenshot of the 2026-09-03 audit it was a pale slab with
 * near-white words on it. Authenticated pages default to light, so the
 * fill has to read in both themes; this spec composites the banner over
 * its ground the way the screen does and holds every text run to WCAG
 * AA in each theme at the three widths the app ships to.
 *
 * Fallback fonts render here, not the production faces, so the layout
 * assertions are ratios and counts rather than pixel sizes.
 */

const WIDTHS = [
  { name: "Fold cover", width: 344, height: 882, phone: true },
  { name: "iPhone", width: 375, height: 812, phone: true },
  { name: "desktop", width: 1280, height: 800, phone: false },
];

const SENTENCE = /3 items need a business-or-personal call/;

// The wrapper the app body carries (app/layout.tsx), so the semantic tokens
// resolve to the Instrument skin's values in both themes.
const SKIN = { minHeight: "100vh" };

async function setTheme(page: import("@playwright/test").Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
}

for (const w of WIDTHS) {
  for (const theme of ["light", "dark"] as const) {
    test(`every word is legible in the ${theme} theme on the ${w.name} (${w.width}px)`, async ({
      mount,
      page,
    }) => {
      await page.setViewportSize({ width: w.width, height: w.height });
      await setTheme(page, theme);
      await mount(
        <div data-skin="instrument" className="px-4 py-6" style={SKIN}>
          <OutstandingTasksBanner count={3} firstHref="/mileage/classify" />
        </div>,
      );
      const sentence = page.getByText(SENTENCE);
      await expect(sentence).toBeVisible();
      await expect(page.getByRole("link", { name: "Review now" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible();

      // Composite the banner's background over everything behind it by
      // painting the same colours onto a canvas, then read one pixel. That
      // resolves color-mix() and alpha the way the screen does, without a
      // PNG decoder. Text colours go through the same canvas so oklab /
      // color() strings become sRGB bytes too.
      const m = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d")!;
        const px = () => Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
        const paint = (c: string) => {
          ctx.fillStyle = c;
          ctx.fillRect(0, 0, 1, 1);
        };
        const banner = document.querySelector<HTMLElement>("[data-skin] > div")!;
        // Bottom-up: html ground, the skinned wrapper, the banner.
        const ground = () => {
          ctx.clearRect(0, 0, 1, 1);
          paint(getComputedStyle(document.documentElement).backgroundColor);
          paint(getComputedStyle(document.querySelector("[data-skin]")!).backgroundColor);
          paint(getComputedStyle(banner).backgroundColor);
        };
        ground();
        const bg = px();
        // Text goes over the same ground, not over white: the dark theme's
        // muted text is cream at 58% alpha, and over white it would read
        // as near-white and flatter the ratio.
        const solid = (c: string) => {
          ground();
          paint(c);
          return px();
        };
        const lum = ([r, g, b]: number[]) => {
          const f = (c: number) => {
            const s = c / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const contrast = (fg: number[]) => {
          const l1 = lum(fg);
          const l2 = lum(bg);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };
        const ratios: Record<string, number> = {};
        banner.querySelectorAll<HTMLElement>("span, a, button").forEach((el) => {
          const text = (el.textContent ?? "").trim();
          if (!text || el.children.length) return;
          ratios[text.slice(0, 24)] =
            Math.round(contrast(solid(getComputedStyle(el).color)) * 100) / 100;
        });

        const r = banner.getBoundingClientRect();
        const cs = getComputedStyle(banner);
        const inner = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const s = banner.querySelector<HTMLElement>("span")!;
        const sr = s.getBoundingClientRect();
        const lines = Math.round(sr.height / parseFloat(getComputedStyle(s).lineHeight));
        return {
          bg,
          ratios,
          bannerInner: inner,
          bannerH: r.height,
          sentenceW: sr.width,
          lines,
          docW: document.documentElement.scrollWidth,
        };
      });
      console.log(
        `${theme} @${w.width}: bg ${m.bg.join(",")} ${JSON.stringify(m.ratios)} sentence ${Math.round(m.sentenceW)}/${Math.round(m.bannerInner)}px, ${m.lines} lines, banner ${Math.round(m.bannerH)}px`,
      );

      // OUTSTANDING_BANNER_SHOTS=<dir> writes a screenshot per case, for
      // before/after evidence on a PR; the assertions never depend on it.
      if (process.env.OUTSTANDING_BANNER_SHOTS) {
        await page.screenshot({
          path: `${process.env.OUTSTANDING_BANNER_SHOTS}/${theme}-${w.width}.png`,
        });
      }

      expect(m.docW, "no horizontal overflow").toBeLessThanOrEqual(w.width);
      expect(Object.keys(m.ratios).length, "three text runs measured").toBe(3);
      for (const [text, ratio] of Object.entries(m.ratios)) {
        expect(ratio, `"${text}" against the banner in ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
      if (w.phone) {
        expect(
          m.sentenceW / m.bannerInner,
          "the sentence must get most of the banner's width, not the leftover",
        ).toBeGreaterThanOrEqual(0.6);
        expect(m.lines, "the sentence must read as prose, not a column").toBeLessThanOrEqual(3);
      }
    });
  }
}
