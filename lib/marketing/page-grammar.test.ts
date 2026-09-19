import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pagesUnder(p));
    else if (name === "page.tsx") out.push(p);
  }
  return out;
}

/** Every public marketing page in the Year grammar (spec 4.2). */
export const PUBLIC_MARKETING_PAGES = [
  ...pagesUnder("app/pricing"),
  ...pagesUnder("app/calculators"),
  ...pagesUnder("app/guides"),
  ...pagesUnder("app/compare"),
  "app/help/page.tsx",
  "app/changelog/page.tsx",
  "app/book/page.tsx",
  "app/get/page.tsx",
  "components/guides/GuideShell.tsx",
].sort();

describe("the secondary marketing pages are in the Year grammar", () => {
  it("covers the pages the spec names", () => {
    expect(PUBLIC_MARKETING_PAGES.length).toBeGreaterThanOrEqual(30);
  });
  for (const file of PUBLIC_MARKETING_PAGES) {
    const src = strip(readFileSync(file, "utf8"));
    const isShell = file.endsWith("GuideShell.tsx");
    const isGuidePage = file.startsWith("app/guides/") && file !== "app/guides/page.tsx";
    it(`${file} uses the shell and carries the grammar attribute`, () => {
      if (isGuidePage) {
        expect(src).toMatch(/<GuideShell/);
      } else {
        expect(src).toMatch(/<PageShell/);
        expect(src).toMatch(/data-grammar="year"/);
      }
      expect(src).not.toMatch(/var\(--navy-band\)/);
      expect(src).not.toMatch(/<MarketingNav\b/);
      expect(src).not.toMatch(/<SignInIconLink\b/);
    });
    it(`${file} carries no retired primitive`, () => {
      expect(src).not.toMatch(/\bkicker\b|kicker-sm|gold-shine|text-gold-|bg-gold-|border-gold-|ring-gold-/);
      expect(src).not.toMatch(/uppercase tracking-\[0\.(2|18|28|32)em\]/);
      expect(src).not.toMatch(/rounded-full/);
      expect(src).not.toMatch(/\bitalic\b/);
      expect(src).not.toMatch(/&rarr;|→/);
      expect(src).not.toMatch(/\b(calmer|gentle|gently|quietly|friendly|scary)\b/i);
    });
    if (isShell) {
      it("GuideShell mounts the shell for every guide", () => {
        expect(src).toMatch(/<PageShell current="guides"/);
      });
    }
  }
});
