import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * The marketing hero's first screen, held to the Instrument skin's own
 * rules at source level.
 *
 * Two things had drifted by 2026-09-03 and read as templated to a buyer:
 *
 *   1. The skin declares one signature, the tax-year runway (`.runway*` in
 *      app/globals.css), with a comment saying the hero loses information
 *      without it. It was rendered nowhere. Built, never invoked: the same
 *      failure class this repo keeps meeting in code, met in design.
 *   2. The skin's rule is brass in one place, the live figure and today's
 *      marker. The h1, the largest text on the site, carried `gold-shine`,
 *      an animated gradient sweep, on every audience.
 *
 * Comments are stripped before matching so this file's own rationale,
 * or a commented-out line in the page, cannot satisfy a check.
 */

const PAGE = "app/page.tsx";
const INSTRUMENT = "components/HeroInstrument.tsx";

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const page = code(readFileSync(PAGE, "utf8"));

/** Body of the `const HERO: Record<...> = { ... };` block. */
function heroRecord(): string {
  const m = /const HERO: Record<[\s\S]*?> = \{([\s\S]*?)\n\};/.exec(page);
  if (!m) throw new Error(`HERO record not found in ${PAGE}`);
  return m[1];
}

/** Body of `function Hero(...) { ... }`. */
function heroComponent(): string {
  const m = /function Hero\([\s\S]*?\n\}\n/.exec(page);
  if (!m) throw new Error(`Hero component not found in ${PAGE}`);
  return m[0];
}

describe("the hero spends brass once", () => {
  it("no audience headline uses gold-shine", () => {
    expect(
      /gold-shine/.test(heroRecord()),
      "an h1 with an animated gold sweep is the first thing a buyer sees; " +
        "the Instrument skin spends brass on the runway, not the headline",
    ).toBe(false);
  });
});

describe("the runway signature is on the page", () => {
  it("HeroInstrument exists and renders the runway rail, fill and today marker", () => {
    expect(existsSync(INSTRUMENT), `${INSTRUMENT} is missing`).toBe(true);
    const src = code(readFileSync(INSTRUMENT, "utf8"));
    // Word boundaries, not includes(): "runway-todayx" must not satisfy
    // "runway-today". A mutation that renamed the class survived the
    // substring form.
    for (const cls of ["runway-rail", "runway-fill", "runway-tick", "runway-today"]) {
      expect(
        new RegExp(`className="${cls}"`).test(src),
        `${INSTRUMENT} never renders .${cls}`,
      ).toBe(true);
    }
  });

  it("Hero renders HeroInstrument", () => {
    expect(
      /<HeroInstrument\b/.test(heroComponent()),
      "the signature exists but the hero does not mount it",
    ).toBe(true);
  });
});
