import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The differentiator has to be visible on the page people actually land
 * on, and in the data machines read.
 *
 * On 2026-08-10 automatic mileage capture, the single most
 * differentiated thing Taxottic does, was missing from:
 *
 *   - the PERSONAL capability list, which is the DEFAULT audience, so
 *     every first-time visitor, every arrival from search and every AI
 *     referral saw a homepage that never mentioned drive tracking
 *   - the personal product tour
 *   - the FIRM capability list, where it is the one capability
 *     TaxDome, Karbon and Canopy cannot answer at all
 *   - SoftwareApplication `featureList`, all ELEVEN entries of it, so an
 *     answer engine reading the structured data to decide whether the
 *     product tracks mileage would have concluded it does not
 *   - the site meta description and the WebSite description
 *
 * It appeared only under `?audience=business`, one unlabelled tab click
 * away. llms.txt was the only surface that named it.
 *
 * The cause is structural rather than careless: the three audience
 * capability lists are maintained by hand, and nothing tied them to what
 * the product actually does. This test is that tie. It encodes a
 * positioning decision (mileage is the wedge), so if the positioning
 * genuinely changes, change this file deliberately rather than letting
 * the copy drift out from under it.
 *
 * The Year rewrite (2026-09-05, task 8) retired the per-audience
 * CAPABILITY[] lists and the TOUR record along with the sections that
 * rendered them; the grammar guard (lib/marketing/year-grammar.test.ts)
 * now forbids either construct from coming back. Audience-specific copy
 * moved to HERO and MOMENTS in components/marketing/home-copy.ts (the hero
 * lede plus the five-moment year sequence, which is the tour's
 * replacement), and the JSON-LD builders moved to
 * lib/marketing/home-jsonld.ts. The helpers below read those in place of
 * the old blocks; the positioning check they carry (mileage is the wedge,
 * visible to every audience) is unchanged.
 */

const PAGE = "app/page.tsx";
const LAYOUT = "app/layout.tsx";
const LLMS = "public/llms.txt";
const HOME_COPY = "components/marketing/home-copy.ts";
const HOME_JSONLD = "lib/marketing/home-jsonld.ts";

const page = readFileSync(PAGE, "utf8");
const homeCopy = readFileSync(HOME_COPY, "utf8");
const homeJsonld = readFileSync(HOME_JSONLD, "utf8");

/** Body of `HERO`'s `{audience}: { ... },` entry in home-copy.ts. */
function heroBlock(audience: string): string {
  const m = new RegExp(`\\n {2}${audience}: \\{([\\s\\S]*?)\\n {2}\\},\\n`).exec(homeCopy);
  if (!m) throw new Error(`HERO.${audience} not found in ${HOME_COPY}`);
  return m[1];
}

/** Body of `MOMENTS`'s `{audience}: withCopy({ ... }),` entry, every moment concatenated. */
function momentsBlock(audience: string): string {
  const m = new RegExp(`\\n {2}${audience}: withCopy\\(\\{([\\s\\S]*?)\\n {2}\\}\\),\\n`).exec(homeCopy);
  if (!m) throw new Error(`MOMENTS.${audience} not found in ${HOME_COPY}`);
  return m[1];
}

/** The audience-specific copy that replaced the capability list: hero lede + every moment. */
function capabilityBlock(name: string): string {
  const audience = name.toLowerCase();
  return `${heroBlock(audience)}\n${momentsBlock(audience)}`;
}

/** The year sequence for one audience, the tour's replacement. */
function tourBlock(audience: string): string {
  return momentsBlock(audience);
}

/** Strip comments so this file's own rationale cannot satisfy a check. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const MENTIONS_MILEAGE = /mileage|\bmiles\b|drives?\b|driving/i;

describe("mileage is visible to every audience", () => {
  for (const list of ["PERSONAL", "BUSINESS", "FIRM"]) {
    it(`${list} capabilities mention it`, () => {
      expect(
        MENTIONS_MILEAGE.test(code(capabilityBlock(list))),
        `${list} has no mileage capability. It is the product's ` +
          `differentiator; an audience that never sees it cannot buy it.`,
      ).toBe(true);
    });
  }

  it("the DEFAULT audience is one that mentions it", () => {
    // The specific failure that shipped: mileage existed, just not on
    // the page anyone lands on without clicking a tab.
    const fallback = /: "personal";/.test(page) || /"personal"\s*;/.test(page);
    expect(fallback, "expected personal to be the default audience").toBe(true);
    expect(MENTIONS_MILEAGE.test(code(capabilityBlock("PERSONAL")))).toBe(true);
  });

  it("the personal product tour includes a mileage step", () => {
    expect(MENTIONS_MILEAGE.test(code(tourBlock("personal")))).toBe(true);
  });
});

describe("mileage is visible to machines", () => {
  it("SoftwareApplication featureList names it", () => {
    const m = /featureList: \[([\s\S]*?)\]/.exec(homeJsonld);
    expect(m, "featureList not found").not.toBeNull();
    const features = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(features.length).toBeGreaterThan(5);
    expect(
      features.some((f) => MENTIONS_MILEAGE.test(f)),
      "featureList is what an answer engine reads to enumerate what the " +
        "product does. Eleven entries once omitted mileage entirely.",
    ).toBe(true);
  });

  it("the site meta description names it", () => {
    const layout = readFileSync(LAYOUT, "utf8");
    const m = /const SITE_DESCRIPTION =\s*\n?\s*"([^"]+)"/.exec(layout);
    expect(m, "SITE_DESCRIPTION not found").not.toBeNull();
    expect(MENTIONS_MILEAGE.test(m![1])).toBe(true);
    // Google truncates around 158 characters.
    expect(m![1].length).toBeLessThanOrEqual(158);
  });

  it("llms.txt still names it", () => {
    // This was the ONLY surface that got it right. Keep it that way.
    expect(MENTIONS_MILEAGE.test(readFileSync(LLMS, "utf8"))).toBe(true);
  });
});
