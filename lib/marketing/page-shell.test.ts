import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the page shell", () => {
  const src = strip(readFileSync("components/marketing/PageShell.tsx", "utf8"));
  it("composes the paper header with a static sample spine, the children and the footer", () => {
    expect(src).toMatch(/<MarketingHeader[\s\S]*current=\{current\}[\s\S]*spine=\{/);
    expect(src).toMatch(/<YearSpine[^>]*taxYear=\{HOME_TAX_YEAR\}[^>]*asOf=\{HOME_AS_OF\}[^>]*variant="paper"/);
    expect(src).not.toMatch(/YearSpineMotion/);
    expect(src.indexOf("{children}")).toBeGreaterThan(src.indexOf("<MarketingHeader"));
    expect(src.indexOf("<MarketingFooter")).toBeGreaterThan(src.indexOf("{children}"));
  });
  it("widens the nav's current key without adding nav items", () => {
    const nav = strip(readFileSync("components/MarketingNav.tsx", "utf8"));
    expect(nav).toMatch(/type NavKey = "pricing" \| "guides" \| "calculators" \| "help" \| "changelog" \| "compare"/);
    expect(
      nav.match(/\{ key: "/g)?.length,
      "The bar still holds three links. NavKey is deliberately wider: " +
        "/help, /changelog and /compare wear the shell and name themselves " +
        "with a key, and their key lights nothing because they have no row " +
        "here. If this count changes, a link was added to the bar, which is " +
        "a navigation decision, not a typing one.",
    ).toBe(3);
  });
});
