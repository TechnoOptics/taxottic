import { test, expect } from "@playwright/experimental-ct-react";
import { TierTable } from "./TierTable";

const tiers = [
  { key: "free", name: "Free", tagline: "Try it, no card.", monthlyCents: 0, yearlyCents: 0, highlights: ["Personal dashboard", "Reminders and calendar"], companies: "1", bankLinks: "None", cta: { href: "/login", label: "Start free" } },
  { key: "solo", name: "Solo", tagline: "Freelancer or sole proprietor.", monthlyCents: 1999, yearlyCents: 19900, highlights: ["Schedule C forecast", "Bank sync"], companies: "1", bankLinks: "1", cta: { href: "/login?plan=solo", label: "Choose Solo" }, popular: true },
] as const;

test("desktop renders one ruled table with prices in the data face", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mount(<div data-skin="instrument" data-grammar="year" style={{ padding: 16 }}><TierTable tiers={[...tiers]} /></div>);
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Monthly" })).toBeVisible();
  const prices = await page.locator("table .figure").allTextContents();
  expect(prices).toEqual(expect.arrayContaining(["$19.99", "$199"]));
  expect(await page.locator(".rounded-full").count()).toBe(0);
  await expect(page.getByText("Most popular")).toHaveCSS("text-transform", "uppercase");
  // One tree at a time. The ledger sat under the table at every width
  // while its display came from a Tailwind utility: globals.css is
  // unlayered and beat @layer utilities.
  await expect(page.locator(".tier-ledger")).toBeHidden();
});

test("a phone renders a stacked ledger, no table, 44px CTAs, no overflow", async ({ mount, page }) => {
  await page.setViewportSize({ width: 344, height: 900 });
  await mount(<div data-skin="instrument" data-grammar="year" style={{ padding: 16 }}><TierTable tiers={[...tiers]} /></div>);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.locator(".tier-table-desktop")).toBeHidden();
  const ctas = page.getByRole("link", { name: /Start free|Choose Solo/ });
  await expect(ctas).toHaveCount(2);
  for (const c of await ctas.all()) expect((await c.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
