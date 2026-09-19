import { test, expect } from "@playwright/experimental-ct-react";
import { NeedsYourCall } from "./NeedsYourCall";

const items = [
  { kind: "bank_transaction" as const, id: "t1", title: "Sweetgreen", subtitle: "Sep 2 · $24.50 · Meal with a client?", href: "/c/abc/banks?tx=t1", publicId: "abc" },
  { kind: "csv_transaction" as const, id: "r1", title: "Delta 4821", subtitle: "Sep 1 · $612.40", href: "/c/abc/import/i1?highlight=r1" },
];

test("rows resolve in place where they can and open where they cannot, on 44px controls", async ({ mount, page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await mount(
    <div data-skin="instrument" data-grammar="year" style={{ padding: 16 }}>
      <NeedsYourCall items={items} count={2} />
    </div>,
  );
  await expect(page.getByRole("heading", { name: /Needs your call/ })).toBeVisible();
  const notBusiness = page.getByRole("button", { name: "Not business" });
  await expect(notBusiness).toHaveCount(1);
  const box = await notBusiness.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("link", { name: "Business" })).toHaveAttribute("href", "/c/abc/banks?tx=t1");
  await expect(page.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/c/abc/import/i1?highlight=r1");
  const dates = await page.locator(".figure").allTextContents();
  expect(dates.some((t) => /Sep 2/.test(t))).toBe(true);
});

// Dark-theme case: the row title read against the row's own ground. Same
// canvas-compositing technique as components/mileage/LocationBlockedStrip.ct.spec.tsx
// (also copied into NextPaymentPanel.ct.spec.tsx for this same "today" tree),
// so color-mix() and alpha resolve the way the screen does without a PNG decoder.
test("the row title is readable in the dark theme", async ({ mount, page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await mount(
    <div data-skin="instrument" data-theme="dark" data-grammar="year" style={{ padding: 16 }}>
      <NeedsYourCall items={items} count={2} />
    </div>,
  );
  await expect(page.getByRole("heading", { name: /Needs your call/ })).toBeVisible();

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
    const wrapper = document.querySelector("[data-skin]")!;
    const row = document.querySelector<HTMLElement>(".today-call-row")!;
    const title = document.querySelector<HTMLElement>(".today-call-title")!;
    const ground = [bgOf(document.documentElement), bgOf(document.body), bgOf(wrapper), bgOf(row)];
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
    const rowGround = stack(...ground);
    const textColor = stack(getComputedStyle(title).color);
    return contrast(textColor, rowGround);
  });
  expect(ratio, "row title against the row ground in dark").toBeGreaterThanOrEqual(4.5);
});
