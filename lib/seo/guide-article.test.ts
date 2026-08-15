import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { guideArticleLd } from "./guide-article";

/**
 * Article rich results are all-or-nothing on `image`. Google lists it as
 * required, so a guide without one is not "slightly worse", it is
 * ineligible, and nothing in the app surfaces that. Eleven guides shipped
 * that way for two months and every page looked completely fine.
 *
 * That is the shape of bug this file exists for: correct-looking output,
 * silently rejected by a consumer we never see. The same reasoning as
 * lib/us-formatting.test.ts, which guards a different silent formatting
 * failure, and heartbeat-timer.test.ts, which guards a new ingest path
 * forgetting to arm the beat.
 *
 * Two halves, deliberately:
 *   - behavioural, that the builder emits what Google asks for
 *   - static, that every guide actually ROUTES through the builder,
 *     which is the only thing that stops guide twelve being pasted from
 *     an older copy and reintroducing the gap
 */

const GUIDES_DIR = "app/guides";

function guideDirs(): string[] {
  return readdirSync(GUIDES_DIR)
    .map((d) => join(GUIDES_DIR, d))
    .filter((p) => statSync(p).isDirectory())
    .filter((p) => {
      try {
        return statSync(join(p, "page.tsx")).isFile();
      } catch {
        return false;
      }
    });
}

describe("guideArticleLd", () => {
  const ld = guideArticleLd({
    slug: "business-mileage-deduction",
    title: "Business mileage deduction: how to track and claim it",
    description: "How the business mileage deduction works.",
    published: "2026-06-08",
    modified: "2026-07-04",
  });

  it("emits the field Google requires for Article rich results", () => {
    // Without this the item is ineligible, not merely unadorned.
    expect(Array.isArray(ld.image)).toBe(true);
    expect(ld.image[0]).toMatch(/^https:\/\/taxottic\.com\/api\/og\/guide\?title=/);
  });

  it("carries both dates, so freshness is legible to a crawler", () => {
    expect(ld.datePublished).toBe("2026-06-08");
    expect(ld.dateModified).toBe("2026-07-04");
  });

  it("URL-encodes the title into the image, so a colon cannot break it", () => {
    // The real titles contain ":" and "?", which are delimiters in a
    // query string. An unencoded title silently truncates the OG image
    // at the first colon and the card renders half a headline.
    expect(ld.image[0]).toContain("%3A");
    expect(ld.image[0]).not.toMatch(/title=[^&]*[^%]:/);
  });

  it("points mainEntityOfPage and url at the same canonical address", () => {
    expect(ld.url).toBe("https://taxottic.com/guides/business-mileage-deduction");
    expect(ld.mainEntityOfPage).toBe(ld.url);
  });

  it("references the Organization node rather than inlining a publisher", () => {
    // A second, inline publisher object would create a competing entity
    // in the graph instead of resolving to the one on the home page.
    expect(ld.publisher).toEqual({ "@id": "https://taxottic.com/#organization" });
  });
});

describe("every guide routes through the builder", () => {
  const dirs = guideDirs();

  it("finds the guides at all", () => {
    // Guards the guard. An empty list makes the assertion below pass
    // vacuously, which this repo has shipped before.
    expect(dirs.length).toBeGreaterThan(8);
  });

  it("no guide hand-rolls its own Article JSON-LD", () => {
    // THE ACTUAL REGRESSION. The builder cannot help a page that does
    // not call it, and the natural way to add guide twelve is to copy
    // guide eleven. If that copy predates this refactor it arrives with
    // no image and no dates, and looks perfect in the browser.
    const handRolled: string[] = [];
    for (const d of dirs) {
      const src = readFileSync(join(d, "page.tsx"), "utf8");
      if (!src.includes("guideArticleLd")) handRolled.push(d);
    }
    expect(
      handRolled,
      'These guides build Article JSON-LD by hand. Use guideArticleLd() ' +
        'from lib/seo/guide-article so `image`, `datePublished` and ' +
        '`dateModified` cannot be omitted.',
    ).toEqual([]);
  });

  it("every guide passes real ISO dates, not placeholders", () => {
    const bad: string[] = [];
    for (const d of dirs) {
      const src = readFileSync(join(d, "page.tsx"), "utf8");
      for (const key of ["published", "modified"]) {
        const m = new RegExp(`${key}:\\s*"([^"]*)"`).exec(src);
        if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(m[1])) {
          bad.push(`${d}: ${key}=${m?.[1] ?? "missing"}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("no guide claims to have been modified before it was published", () => {
    // A backwards pair is the fingerprint of a hand-edited date, and it
    // is the one error a crawler will actually notice.
    const bad: string[] = [];
    for (const d of dirs) {
      const src = readFileSync(join(d, "page.tsx"), "utf8");
      const pub = /published:\s*"([^"]*)"/.exec(src)?.[1];
      const mod = /modified:\s*"([^"]*)"/.exec(src)?.[1];
      if (pub && mod && mod < pub) bad.push(`${d}: ${pub} -> ${mod}`);
    }
    expect(bad).toEqual([]);
  });
});
