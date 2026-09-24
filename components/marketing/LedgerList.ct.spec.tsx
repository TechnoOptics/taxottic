import { test, expect } from "@playwright/experimental-ct-react";
import { LedgerList } from "./LedgerList";

const items = [
  { href: "/guides/a", title: "How much should I set aside for taxes when self-employed?", blurb: "A simple way to size your tax set-aside." },
  { href: "/changelog#x", title: "Tick the rows you mean", date: "Aug 6, 2026", dateTime: "2026-08-06", tag: "Shipped" },
  { href: "/changelog#y", title: "No machine-readable date on this one", date: "Aug 1, 2026" },
  { href: "/pricing#solo", title: "Solo", blurb: "Freelancer or sole proprietor.", figure: "$19.99" },
  // A record, not a destination: the changelog's shape after the
  // self-links came off. It keeps its id, its aside and its geometry.
  { id: "no-href", title: "A row that goes nowhere", blurb: "Still a row.", date: "Jul 2, 2026", dateTime: "2026-07-02", tag: "Fixed" },
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

    // The row with no href: five rows, four links, so this one holds no
    // link at all rather than a link to itself. It keeps its id on the
    // <li>, its aside, and the same box a linked row gets, which is the
    // half that would silently drift if the two paths diverged.
    await expect(page.locator("li")).toHaveCount(5);
    const stat = page.locator("li#no-href");
    await expect(stat).toHaveCount(1);
    expect(await stat.locator("a").count(), "a record row is not a link").toBe(0);
    await expect(stat.locator(".ledger-list-aside time.figure")).toHaveText("Jul 2, 2026");
    await expect(stat.locator(".ledger-list-aside .mono-label")).toHaveText("Fixed");
    const statBox = (await stat.locator("> div").boundingBox())!;
    expect(statBox.height, "a record row keeps the 44px floor").toBeGreaterThanOrEqual(44);
    const linkedBox = (await page.locator("li").nth(1).locator("a").boundingBox())!;
    expect(Math.round(statBox.x), "the two row bodies start at the same x").toBe(Math.round(linkedBox.x));
    expect(Math.round(statBox.width), "the two row bodies are the same width").toBe(Math.round(linkedBox.width));

    // A date given a machine-readable form renders as a real <time> and
    // keeps the data face; one given without stays a plain span, so a
    // list with no dates is not forced to invent one.
    // Scoped to the linked rows: the record row below carries a
    // machine-readable date of its own, and it is asserted there.
    const time = page.locator("a time.figure");
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
