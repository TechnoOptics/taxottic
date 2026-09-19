import { test, expect } from "@playwright/experimental-ct-react";
import { LedgerList } from "./LedgerList";

const items = [
  { href: "/guides/a", title: "How much should I set aside for taxes when self-employed?", blurb: "A simple way to size your tax set-aside." },
  { href: "/changelog#x", title: "Tick the rows you mean", date: "Aug 6, 2026", tag: "Shipped" },
  { href: "/pricing#solo", title: "Solo", blurb: "Freelancer or sole proprietor.", figure: "$19.99" },
];

for (const width of [344, 1280]) {
  test(`rows are hairline-separated, 44px, with the mono column in the data face at ${width}`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mount(
      <div data-skin="instrument" data-grammar="year" style={{ padding: 16 }}>
        <LedgerList items={items} ariaLabel="Guides" />
      </div>,
    );
    const links = page.getByRole("link");
    await expect(links).toHaveCount(3);
    for (const l of await links.all()) expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const figures = await page.locator(".figure").allTextContents();
    expect(figures).toEqual(expect.arrayContaining(["Aug 6, 2026", "$19.99"]));
    const tag = page.locator(".mono-label", { hasText: "Shipped" });
    expect(await tag.evaluate((e) => getComputedStyle(e).textTransform)).toBe("uppercase");
    const rowBorder = await page.locator("li").first().evaluate((e) => getComputedStyle(e).borderBottomWidth);
    expect(rowBorder).toBe("1px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
