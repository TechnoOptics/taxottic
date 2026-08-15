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
 */

const PAGE = "app/page.tsx";
const LAYOUT = "app/layout.tsx";
const LLMS = "public/llms.txt";

const page = readFileSync(PAGE, "utf8");

/** Body of a `const NAME: Capability[] = [ ... ];` block. */
function capabilityBlock(name: string): string {
  const m = new RegExp(
    `const ${name}: Capability\\[\\] = \\[([\\s\\S]*?)\\n\\];`,
  ).exec(page);
  if (!m) throw new Error(`capability list ${name} not found in ${PAGE}`);
  return m[1];
}

/** Body of one audience key inside the TOUR record. */
function tourBlock(audience: string): string {
  const tour = /const TOUR[^=]*= \{([\s\S]*?)\n\};/.exec(page);
  if (!tour) throw new Error("TOUR record not found");
  const parts = tour[1].split(/^ {2}(personal|business|firm): \{/m);
  const i = parts.indexOf(audience);
  if (i === -1) throw new Error(`tour audience ${audience} not found`);
  return parts[i + 1];
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
    const m = /featureList: \[([\s\S]*?)\]/.exec(page);
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
