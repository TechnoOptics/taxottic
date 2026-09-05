import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The Year grammar at source level. The 2026-09-05 audit found the site
 * read as generated because of its grammar, not its palette: eyebrows,
 * chips, italic taglines, mock product windows and stock photographs,
 * repeated on every section. This pins their absence on the home page
 * and in the marketing components, so a later edit cannot bring one back
 * while every other test stays green. Comments are stripped first.
 */
const ROOT = join(__dirname, "..", "..");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (rel: string) => strip(readFileSync(join(ROOT, rel), "utf8"));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|spec|ct\.spec)\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

const HOME = ["app/page.tsx", "components/HeroInstrument.tsx", ...walk("components/marketing")];

const RETIRED: [RegExp, string][] = [
  // Matches the class token only; `text-[var(--kicker)]` (the brass token) is allowed.
  [/(^|[\s"'])kicker(-sm)?(?=[\s"'])/m, "eyebrow class"],
  [/tracking-\[0\.(2|32|18)em\]/, "tracked eyebrow"],
  [/\bitalic\b/, "italic tagline"],
  [/gold-shine/, "animated gold"],
  [/Mockup\b|MockupFrame/, "mock product window"],
  [/from "next\/image"/, "photograph"],
  [/rounded-full[^"]*\b(px|py)-/, "pill chip"],
  [/\b(calmer|gentle|gently|quietly)\b/i, "retired register"],
];

describe("the home page uses the Year grammar", () => {
  for (const rel of HOME) {
    it(`${rel} carries no retired primitive`, () => {
      const src = read(rel);
      for (const [re, what] of RETIRED) {
        expect(re.test(src), `${rel}: ${what} (${re})`).toBe(false);
      }
    });
  }

  it("the page is composed from the marketing components", () => {
    const page = read("app/page.tsx");
    for (const c of ["MarketingHeader", "HomeHero", "YearSequence", "PriceStrip", "MarketingFooter", "AppDownloadBanner", "YearSpineMotion"]) {
      expect(new RegExp(`<${c}\\b`).test(page), `app/page.tsx does not render <${c}>`).toBe(true);
    }
    for (const gone of ["HeroFigure", "Capabilities", "WhoItsFor", "ProductTour", "ProofBand", "FomoBand", "FinalCta", "function Footer"]) {
      expect(page.includes(gone), `${gone} is still on the page`).toBe(false);
    }
    expect(page.length, "app/page.tsx should be composition and routing, under 200 lines").toBeLessThan(9000);
  });

  it("no photography ships on the marketing surface", () => {
    expect(existsSync(join(ROOT, "public/marketing"))).toBe(false);
  });
});
