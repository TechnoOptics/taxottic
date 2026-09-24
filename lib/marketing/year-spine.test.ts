import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The spine is on the page, in the fixed header, and the motion is wired to it. */
const ROOT = join(__dirname, "..", "..");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const page = strip(readFileSync(join(ROOT, "app/page.tsx"), "utf8"));

describe("the year spine on the home page", () => {
  it("is passed to the header's spine slot with the fixed sample date", () => {
    expect(page).toMatch(/spine=\{\s*<YearSpine\b[^>]*variant="paper"/);
    expect(page).toMatch(/<YearSpine\b[^>]*id="year-spine"/);
    expect(page).toMatch(/asOf=\{HOME_AS_OF\}/);
  });

  it("wires the motion to that spine", () => {
    expect(page).toMatch(/<YearSpineMotion\b[^>]*spineId="year-spine"/);
  });

  it("binds the motion's today fill to the runway's today fill", () => {
    // The design constraint is "its today position equals the runway's today
    // fill". Asserting `todayFill={today}` alone would pass even if `today`
    // were a stray literal, and asserting the taxYearRunway call alone would
    // pass even if the result were never wired to the motion. This pins both
    // ends: the declared variable must come from taxYearRunway(HOME_TAX_YEAR,
    // HOME_AS_OF).fill, and that same variable name must be the one passed as
    // todayFill.
    const decl = page.match(
      /const\s+(\w+)\s*=\s*taxYearRunway\(\s*HOME_TAX_YEAR\s*,\s*HOME_AS_OF\s*\)\.fill\s*;/,
    );
    expect(
      decl,
      "app/page.tsx should derive today's position from " +
        "taxYearRunway(HOME_TAX_YEAR, HOME_AS_OF).fill",
    ).not.toBeNull();
    const varName = decl![1];
    const usage = new RegExp(`<YearSpineMotion\\b[^>]*todayFill=\\{${varName}\\}`);
    expect(
      page,
      `YearSpineMotion should receive todayFill={${varName}}, the runway's today fill`,
    ).toMatch(usage);
  });
});
