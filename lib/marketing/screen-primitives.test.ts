// lib/marketing/screen-primitives.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A real product screen on the marketing site renders money and dates
 * the way the app does: in the mono figure face, tabular. This pins the
 * primitives so a later edit cannot set an amount in the body face.
 */
const ROOT = join(__dirname, "..", "..");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const src = strip(readFileSync(join(ROOT, "components/marketing/Screen.tsx"), "utf8"));

function body(name: string): string {
  const m = new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}\\n`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return m[0];
}

describe("screen primitives", () => {
  it("exports the five primitives", () => {
    for (const n of ["Screen", "StatRow", "LedgerRow", "CategoryBar", "MiniMap"]) body(n);
  });

  it("StatRow, LedgerRow and CategoryBar set their figure in .figure", () => {
    expect(body("StatRow")).toMatch(/className=\{?"[^"]*\bfigure\b[^"]*"[^>]*>\s*\{value\}/);
    expect(body("LedgerRow")).toMatch(/className="[^"]*\bfigure\b[^"]*"[^>]*>\s*\{amount\}/);
    expect(body("CategoryBar")).toMatch(/className="[^"]*\bfigure\b[^"]*"[^>]*>\s*\{amount\}/);
  });

  it("the title bar is mono, and there is no kicker, chip or italic anywhere", () => {
    expect(body("Screen")).toMatch(/className="screen-bar mono-label"/);
    expect(src).not.toMatch(/\bkicker\b|italic|tracking-\[0\.2em\]|gold-shine/);
    // The chip the name promised: a rounded-full pill with horizontal
    // padding. Row status in this grammar is the `.tag`, a 4px-radius mono
    // label, so a pill coming back here is the retired primitive
    // returning. Same pattern lib/marketing/year-grammar.test.ts bans.
    expect(src, "a pill chip is back in the screen primitives").not.toMatch(
      /rounded-full[^"]*\b(px|py)-/,
    );
  });
});
