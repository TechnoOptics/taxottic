import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getTaxYearConstants } from "./constants";

/**
 * A tax rate written into prose is a rate that will go stale.
 *
 * lib/tax/mileage-rate.test.ts already pins the CONSTANT to the IRS
 * Notice. That is necessary and it was not sufficient: on 2026-08-10 the
 * constant was correct at 72.5 cents (Notice 2026-10) while
 * /calculators/mileage-deduction still said "70¢/mile" in three places
 * and the /calculators hub said it in a fourth. The interactive widget
 * read the constant and rendered 72.5, so the calculator and the
 * paragraph directly beneath it disagreed on the same screen.
 *
 * The worst copy was the FAQ answer, because it ships inside FAQPage
 * JSON-LD. A wrong IRS figure there is eligible to be lifted into a
 * Google answer and repeated by assistants, attributed to Taxottic. On a
 * site that computes United States tax, that is an accuracy failure, not
 * a typo, and it is invisible from inside the app.
 *
 * So: no cents-per-mile figure may be hardcoded anywhere in the public
 * surface. Interpolate MILEAGE_RATE_PER_MILE_CENTS instead, and the copy
 * becomes correct by construction the moment the IRS Notice lands.
 */

const SEARCH_DIRS = ["app", "components"];
const CURRENT = getTaxYearConstants(2026).MILEAGE_RATE_PER_MILE_CENTS;

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next") continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(e) && !e.includes(".test.")) out.push(full);
  }
  return out;
}

const FILES = SEARCH_DIRS.flatMap((d) => sourceFiles(d));

/** Strip block and line comments so the doc comment above cannot self-trip. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Decode the escape forms of the characters this file matches on, so a
 * literal cannot hide behind one.
 *
 * This is not hypothetical. While adding the reimbursement calculator on
 * 2026-08-10 a hardcoded "76¢ per mile" was written into the
 * calculators hub and sailed straight past these checks, because the
 * regex looks for the cent SIGN and the source contained the six
 * characters of its escape sequence instead. The guard was evadable by
 * accident, which is the only way anyone would ever evade it.
 */
function decodeEscapes(src: string): string {
  return src
    .replace(/\\u00a2/gi, "¢")
    .replace(/\\u0024/gi, "$")
    .replace(/&cent;/gi, "¢");
}

function scannable(src: string): string {
  return decodeEscapes(stripComments(src));
}

describe("no mileage rate is hardcoded into copy", () => {
  it("finds the sources at all", () => {
    // An empty list would make every assertion below vacuously pass.
    expect(FILES.length).toBeGreaterThan(100);
  });

  it("the constant itself is what the IRS published", () => {
    // Cross-check, so this file fails loudly rather than silently
    // policing copy against a value that has itself drifted.
    expect(CURRENT).toBe(72.5);
  });

  it("no cents-per-mile figure appears as a literal", () => {
    // Matches "70¢ per mile", "70¢/mile", "70 cents per mile" and the
    // decimal forms, in prose or in a JSON-LD answer string.
    const RATE_IN_COPY =
      /(\d{2}(?:\.\d)?)\s*(?:¢|cents?)\s*(?:\/|per\s+)\s*mile/gi;

    // The CHARITABLE mileage rate is the one legitimate literal. It is
    // fixed at 14 cents by statute (IRC 170(i)), not set by the annual
    // IRS Notice, so unlike the business rate it cannot drift without
    // an act of Congress. There is deliberately no constant for it: the
    // forecast models only the business rate.
    const STATUTORY_CHARITABLE_CENTS = 14;

    const offenders: string[] = [];
    for (const f of FILES) {
      const src = scannable(readFileSync(f, "utf8"));
      src.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(RATE_IN_COPY)) {
          if (Number(m[1]) === STATUTORY_CHARITABLE_CENTS) continue;
          offenders.push(`${f}:${i + 1}  "${m[0].trim()}"`);
        }
      });
    }

    expect(
      offenders,
      "These hardcode a per-mile rate. Interpolate " +
        "getTaxYearConstants(year).MILEAGE_RATE_PER_MILE_CENTS instead, so " +
        "the copy cannot disagree with the engine (or with the IRS) the " +
        "way /calculators/mileage-deduction did.",
    ).toEqual([]);
  });

  it("no dollars-per-mile literal either", () => {
    // The same claim wearing a different unit: "$0.70/mile".
    const DOLLARS = /\$0?\.\d{2}\s*(?:\/|per\s+)\s*mile/gi;
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = scannable(readFileSync(f, "utf8"));
      src.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(DOLLARS)) {
          offenders.push(`${f}:${i + 1}  "${m[0].trim()}"`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
