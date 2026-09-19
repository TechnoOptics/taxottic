import { test, expect } from "@playwright/experimental-ct-react";
import { LedgerList } from "./LedgerList";

const items = [
  { href: "/guides/a", title: "How much should I set aside for taxes when self-employed?", blurb: "A simple way to size your tax set-aside." },
  { href: "/changelog#x", title: "Tick the rows you mean", date: "Aug 6, 2026", dateTime: "2026-08-06", tag: "Shipped" },
  { href: "/changelog#y", title: "No machine-readable date on this one", date: "Aug 1, 2026" },
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
    await expect(links).toHaveCount(4);
    for (const l of await links.all()) expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const figures = await page.locator(".figure").allTextContents();
    expect(figures).toEqual(expect.arrayContaining(["Aug 6, 2026", "$19.99"]));

    // A date given a machine-readable form renders as a real <time> and
    // keeps the data face; one given without stays a plain span, so a
    // list with no dates is not forced to invent one.
    const time = page.locator("time.figure");
    await expect(time).toHaveCount(1);
    await expect(time).toHaveAttribute("datetime", "2026-08-06");
    await expect(time).toHaveText("Aug 6, 2026");
    expect(await page.locator("span.figure", { hasText: "Aug 1, 2026" }).count()).toBe(1);
    const tag = page.locator(".mono-label", { hasText: "Shipped" });
    expect(await tag.evaluate((e) => getComputedStyle(e).textTransform)).toBe("uppercase");
    const rowBorder = await page.locator("li").first().evaluate((e) => getComputedStyle(e).borderBottomWidth);
    expect(rowBorder).toBe("1px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
