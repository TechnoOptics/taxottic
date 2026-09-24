import { test, expect } from "@playwright/experimental-ct-react";
import { TrialBanner } from "./TrialBanner";
import type { TrialState } from "@/lib/plans/usage";

/**
 * The trial banner is the first thing under the greeting on /dashboard for
 * every account still inside its trial, on the owner hub and the personal
 * hub alike. Two defects, both first-screen:
 *
 *   1. On a phone the sentence was squeezed into the space left over by the
 *      label and the call to action and, with body's `overflow-wrap:
 *      anywhere`, wrapped one word (then one syllable) per line. Measured
 *      in this harness at 344x882 (the Galaxy Z Fold5 cover screen): a
 *      440px banner that pushed the hero figures to y=783, below the fold.
 *   2. In the dark theme the "ending soon" and "expired" variants painted
 *      a translucent light tint that no dark override remapped, under text
 *      the theme had already flipped to cream: beige slab, cream words.
 *
 * Fallback fonts render here, not the production faces, so the assertions
 * are ratios and counts rather than pixel sizes.
 */

const PHONES = [
  { name: "Fold cover", width: 344, height: 882 },
  { name: "iPhone", width: 375, height: 812 },
];

const END = "2026-09-05T00:00:00.000Z";
const VARIANTS: { name: string; trial: TrialState; body: RegExp }[] = [
  {
    name: "active",
    trial: { kind: "active", daysRemaining: 9, trialEnd: END },
    body: /9 days left on your free trial/,
  },
  {
    name: "ending soon",
    trial: { kind: "active", daysRemaining: 2, trialEnd: END },
    body: /2 days left on your free trial/,
  },
  {
    name: "expired",
    trial: { kind: "expired", trialEnd: END },
    body: /Pick a plan to bring back/,
  },
];

// The wrapper the app body carries (app/layout.tsx), so the semantic tokens
// resolve to the Instrument skin's values in both themes. Written inline at
// each mount: the harness can only mount components it can import.
const SKIN = { minHeight: "100vh" };

async function setTheme(page: import("@playwright/test").Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
}

for (const v of VARIANTS) {
  for (const p of PHONES) {
    test(`${v.name}: the sentence keeps its width on the ${p.name} (${p.width}px)`, async ({
      mount,
      page,
    }) => {
      await page.setViewportSize({ width: p.width, height: p.height });
      await setTheme(page, "light");
      await mount(
        <div data-skin="instrument" className="px-4 py-6" style={SKIN}>
          <TrialBanner trial={v.trial} />
        </div>,
      );
      const banner = page.getByRole("link");
      await expect(banner).toBeVisible();
      const sentence = page.getByText(v.body);
      await expect(sentence).toBeVisible();

      const m = await page.evaluate(() => {
        const a = document.querySelector("a")!;
        const r = a.getBoundingClientRect();
        const cs = getComputedStyle(a);
        const inner =
          r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return { bannerInner: inner, bannerH: r.height, docW: document.documentElement.scrollWidth };
      });
      const s = (await sentence.boundingBox())!;
      const lineHeight = await sentence.evaluate((el) =>
        parseFloat(getComputedStyle(el).lineHeight),
      );
      const lines = Math.round(s.height / lineHeight);
      console.log(
        `${v.name} @${p.width}: sentence ${Math.round(s.width)}/${Math.round(m.bannerInner)}px, ${lines} lines, banner ${Math.round(m.bannerH)}px`,
      );
      expect(m.docW, "no horizontal overflow").toBeLessThanOrEqual(p.width);
      expect(
        s.width / m.bannerInner,
        "the sentence must get most of the banner's width, not the leftover",
      ).toBeGreaterThanOrEqual(0.6);
      expect(lines, "the sentence must read as prose, not a column").toBeLessThanOrEqual(3);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`${v.name}: every word is legible in the ${theme} theme`, async ({ mount, page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await setTheme(page, theme);
      await mount(
        <div data-skin="instrument" className="px-4 py-6" style={SKIN}>
          <TrialBanner trial={v.trial} />
        </div>,
      );
      await expect(page.getByRole("link")).toBeVisible();

      // Composite the banner's background over everything behind it by
      // painting the same colours onto a canvas, then read one pixel. That
      // resolves color-mix() and alpha the way the screen does, without a
      // PNG decoder. Text colours go through the same canvas so oklab /
      // color() strings become sRGB bytes too.
      const ratios = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d")!;
        const px = () => Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
        const paint = (c: string) => {
          ctx.fillStyle = c;
          ctx.fillRect(0, 0, 1, 1);
        };
        const solid = (c: string) => {
          ctx.clearRect(0, 0, 1, 1);
          paint("#fff");
          paint(c);
          return px();
        };
        const a = document.querySelector("a")!;
        // Bottom-up: html ground, the skinned wrapper, the banner.
        ctx.clearRect(0, 0, 1, 1);
        paint(getComputedStyle(document.documentElement).backgroundColor);
        paint(getComputedStyle(document.querySelector("[data-skin]")!).backgroundColor);
        paint(getComputedStyle(a).backgroundColor);
        const bg = px();
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
        const out: Record<string, number> = {};
        a.querySelectorAll<HTMLElement>("span").forEach((el) => {
          const text = (el.textContent ?? "").trim();
          if (!text || el.children.length) return;
          out[text.slice(0, 24)] = Math.round(contrast(solid(getComputedStyle(el).color)) * 100) / 100;
        });
        return { bg, out };
      });
      console.log(`${v.name} ${theme}:`, JSON.stringify(ratios));
      for (const [text, ratio] of Object.entries(ratios.out)) {
        expect(ratio, `"${text}" against the banner in ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(Object.keys(ratios.out).length, "three text runs measured").toBe(3);
    });
  }
}
