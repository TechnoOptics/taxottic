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

const SPINE = "components/marketing/YearSpine.tsx";

describe("the runway signature is on the page", () => {
  it("YearSpine exists and renders the runway rail, fill, ticks and today marker", () => {
    expect(existsSync(SPINE), `${SPINE} is missing`).toBe(true);
    const src = code(readFileSync(SPINE, "utf8"));
    for (const cls of ["runway-rail", "runway-fill", "runway-tick", "runway-today"]) {
      expect(new RegExp(`className="${cls}"`).test(src), `${SPINE} never renders .${cls}`).toBe(true);
    }
  });

  it("HeroInstrument mounts the panel spine on the navy band", () => {
    const src = code(readFileSync(INSTRUMENT, "utf8"));
    expect(/<YearSpine\b[^>]*variant="panel"/.test(src), "the instrument does not mount the spine").toBe(true);
    expect(/var\(--navy-band\)/.test(src), "the panel must paint the navy band token").toBe(true);
  });
});

/**
 * The sub-copy under the h1 was 46 words: five lines at desktop, eight
 * on a phone, so the first screen read as a paragraph rather than a
 * promise. About 25 words, and no capability dropped: each audience
 * names four, and every one must survive a tightening.
 */
const SUB_BUDGET = 32;

const CAPABILITIES: Record<string, RegExp[]> = {
  personal: [/deduction/i, /\bmile/i, /federal and state forecast|federal \+ state forecast/i, /set money aside/i],
  business: [/IRS codes/i, /\bmiles?\b.*\b(tracked|logged)/i, /forecast/i, /Schedule C/i],
  firm: [/bulk exports/i, /engagement workflow/i, /firm-wide analytics/i, /branded as your firm/i],
};

/** Plain text of `HERO[<audience>].sub`, JSX and entities stripped. */
function subCopy(audience: string): string {
  const record = heroRecord();
  const m = new RegExp(`\\n  ${audience}: \\{([\\s\\S]*?)\\n  \\},`).exec(record);
  if (!m) throw new Error(`HERO.${audience} not found`);
  const sub = /sub: \(\s*<>([\s\S]*?)<\/>\s*\),/.exec(m[1]);
  if (!sub) throw new Error(`HERO.${audience}.sub not found`);
  return sub[1]
    .replace(/\{" "\}/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the hero sub-copy fits the first screen", () => {
  for (const audience of Object.keys(CAPABILITIES)) {
    it(`${audience}: about 25 words, every capability kept`, () => {
      const text = subCopy(audience);
      const words = text.split(" ").length;
      expect(words, `${words} words: "${text}"`).toBeLessThanOrEqual(SUB_BUDGET);
      for (const cap of CAPABILITIES[audience]) {
        expect(cap.test(text), `${audience} sub-copy lost ${cap}: "${text}"`).toBe(true);
      }
    });
  }
});
