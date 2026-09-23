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

const COPY = "components/marketing/home-copy.ts";
const HERO_FILE = "components/marketing/HomeHero.tsx";
const INSTRUMENT = "components/HeroInstrument.tsx";

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const copy = code(readFileSync(COPY, "utf8"));

/** Body of the `const HERO: Record<Audience, HeroCopy> = { ... };` block. */
function heroRecord(): string {
  const m = /const HERO: Record<Audience, HeroCopy> = \{([\s\S]*?)\n\};/.exec(copy);
  if (!m) throw new Error(`HERO record not found in ${COPY}`);
  return m[1];
}

/** Body of `export function HomeHero(...) { ... }`. */
function heroComponent(): string {
  const src = code(readFileSync(HERO_FILE, "utf8"));
  const m = /export function HomeHero\([\s\S]*?\n\}\n/.exec(src);
  if (!m) throw new Error(`HomeHero component not found in ${HERO_FILE}`);
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

  it("no headline or lede uses a retired word", () => {
    expect(heroRecord()).not.toMatch(/\b(calmer|calm|gentle|gently|quiet|quietly|friendly|scary)\b/i);
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

  it("Hero renders HeroInstrument", () => {
    expect(/<HeroInstrument\b/.test(heroComponent()), `${HERO_FILE} does not mount HeroInstrument`).toBe(true);
  });
});

/**
 * The sub-copy under the h1 was 46 words: five lines at desktop, eight
 * on a phone, so the first screen read as a paragraph rather than a
 * promise. About 25 words, and no capability dropped: each audience
 * names four, and every one must survive a tightening.
 */
const SUB_BUDGET = 36;

const CAPABILITIES: Record<string, RegExp[]> = {
  personal: [/federal and state/i, /before each payment/i, /\bmiles?\b/i, /deduction/i],
  business: [/federal and state/i, /Schedule C/i, /IRS code/i, /\bmile\b/i],
  firm: [/federal and state/i, /engagement/i, /\bmileage\b/i, /bulk export/i, /branded as your firm/i],
};

/** Plain text of `HERO[<audience>].lede`. */
function subCopy(audience: string): string {
  const record = heroRecord();
  const m = new RegExp(`\\n  ${audience}: \\{([\\s\\S]*?)\\n  \\},`).exec(record);
  if (!m) throw new Error(`HERO.${audience} not found`);
  const sub = /lede:\s*"([^"]*)"/.exec(m[1]);
  if (!sub) throw new Error(`HERO.${audience}.lede not found`);
  return sub[1].replace(/\s+/g, " ").trim();
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
