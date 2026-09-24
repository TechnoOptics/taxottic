import { test, expect } from "@playwright/experimental-ct-react";
import { LocationBlockedStrip } from "./LocationBlockedStrip";

/**
 * The strip is the first thing under the greeting on /dashboard for a
 * driver whose phone has moved Location to While Using, so it is read in
 * whichever theme that driver is in. Its ground is an amber tint, which
 * is the exact shape of the defect the TrialBanner spec caught: a light
 * translucent tint that no dark override remaps, under text the theme has
 * already flipped to cream. Both themes are asserted here for that reason.
 *
 * Fallback fonts render in this harness, not the production faces, so the
 * assertions are contrast ratios rather than pixel sizes.
 */

const SHORT = "Location is While Using, so drives are not recorded off screen";
const FIX = "Settings, Taxottic, Location, Always";

for (const theme of ["light", "dark"] as const) {
  test(`every word is legible in the ${theme} theme`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await mount(
      <div
        data-skin="instrument"
        data-theme={theme}
        className="px-4 py-6"
        style={{ minHeight: "100vh" }}
      >
        <LocationBlockedStrip short={SHORT} fix={FIX} />
      </div>,
    );
    await expect(page.getByText(`${SHORT}.`)).toBeVisible();
    await expect(page.getByText(`${FIX}.`)).toBeVisible();

    // Composite everything behind the text onto a canvas and read one
    // pixel, so color-mix() and alpha resolve the way the screen does
    // without a PNG decoder. The same canvas turns the text colours into
    // sRGB bytes. Copied from components/TrialBanner.ct.spec.tsx, which
    // is where this technique and its reasoning were worked out.
    const ratios = await page.evaluate(() => {
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
      const wrapper = document.querySelector("[data-skin]")!;
      const strip = wrapper.firstElementChild!;
      const ground = [
        bgOf(document.documentElement),
        bgOf(document.body),
        bgOf(wrapper),
      ];
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
      const round = (n: number) => Math.round(n * 100) / 100;
      const out: Record<string, number> = {};
      const stripBg = stack(...ground, bgOf(strip));
      strip.querySelectorAll<HTMLElement>("p").forEach((el) => {
        const text = (el.textContent ?? "").trim();
        out[text.slice(0, 24)] = round(
          contrast(stack(getComputedStyle(el).color), stripBg),
        );
      });
      // The control is an <a> on the web and a <button> on the phone
      // (OpenLocationSettingsButton picks after mount), so measure
      // whichever one the strip rendered, against its own ground.
      const control = strip.querySelector<HTMLElement>("a, button")!;
      const controlBg = stack(...ground, bgOf(strip), bgOf(control));
      out[(control.textContent ?? "").trim()] = round(
        contrast(stack(getComputedStyle(control).color), controlBg),
      );
      return {
        stripBg,
        controlBg,
        controlHeight: control.getBoundingClientRect().height,
        out,
      };
    });
    console.log(`${theme}:`, JSON.stringify(ratios));
    for (const [text, ratio] of Object.entries(ratios.out)) {
      expect(ratio, `"${text}" against its ground in ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(Object.keys(ratios.out).length, "three text runs measured").toBe(3);
    expect(
      ratios.controlHeight,
      "the control is a touch target on the surface where the permission is broken",
    ).toBeGreaterThanOrEqual(44);
  });
}
