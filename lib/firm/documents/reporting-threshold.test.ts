import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getTaxYearConstants } from "@/lib/tax/constants";

/**
 * The section 6041 information-reporting threshold is not a constant,
 * and the 1099 generator treated it as one.
 *
 * It filtered recipients at a literal 60_000 cents ($600), the
 * long-standing figure, while OBBBA section 70433 raised it to $2,000
 * for payments made after 2025-12-31. So for tax year 2026 the generator
 * produced a 1099-NEC draft for every contractor paid $600 to $1,999,
 * none of whom need one, and the checklist printed on each draft told
 * the preparer to "Confirm $600 threshold met".
 *
 * This is the third instance of the same bug shape found on 2026-08-10:
 * a tax figure hardcoded in one place while lib/tax holds the correct,
 * year-aware value. The other two were the public mileage calculator
 * (see lib/tax/split-rate-mileage.test.ts) and its surrounding copy.
 * The pattern is what the tests are really guarding, not the number.
 *
 * Wrong guidance to a CPA is the worst version of it. Over-issuing a
 * 1099 is not a penalty, but it is incorrect professional output from a
 * product whose entire pitch is that the figures are right.
 */

const GENERATOR = "lib/firm/documents/generate-1099.ts";

describe("1099 reporting threshold follows the tax year", () => {
  it("2026 really is $2,000, not $600", () => {
    expect(getTaxYearConstants(2026).INFO_REPORTING_THRESHOLD_CENTS).toBe(
      200_000,
    );
  });

  it("the generator reads the threshold instead of hardcoding it", () => {
    const src = readFileSync(GENERATOR, "utf8");
    // Strip comments: the file explains the old value on purpose.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(
      code,
      "the filter must derive from the tax year",
    ).toContain("reportingThresholdCents(taxYear)");

    expect(
      /\.filter\([^)]*>=\s*\d[\d_]*\)/.test(code),
      "found a numeric literal in the recipient filter, which is exactly " +
        "the bug: it was >= 60_000 while 2026 requires >= 200_000",
    ).toBe(false);
  });

  it("threads the tax year into every rollup call", () => {
    // A caller that forgets the argument would not compile, but this
    // states the requirement so it survives a refactor to a default.
    const src = readFileSync(GENERATOR, "utf8");
    const calls = [...src.matchAll(/rollupByRecipient\(([^)]*)\)/g)]
      .map((m) => m[1])
      .filter((args) => !args.includes("rows:")); // skip the definition
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      expect(args, `rollupByRecipient(${args}) is missing taxYear`).toContain(
        "taxYear",
      );
    }
  });

  it("no 1099 surface prints a hardcoded dollar threshold", () => {
    const surfaces = [
      GENERATOR,
      "app/firm/clients/[engagementId]/w9/page.tsx",
      "app/firm/clients/[engagementId]/documents/page.tsx",
    ];
    const offenders: string[] = [];
    for (const f of surfaces) {
      const code = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      // A dollar figure sitting next to the word "threshold" or "1099".
      for (const m of code.matchAll(
        /\$\s?(\d{3,}(?:,\d{3})*)\+?[^\n]{0,40}(threshold|1099)/gi,
      )) {
        offenders.push(`${f}: "${m[0].slice(0, 60)}"`);
      }
    }
    expect(
      offenders,
      "Print getTaxYearConstants(year).INFO_REPORTING_THRESHOLD_CENTS " +
        "instead. The threshold inflation-adjusts from 2027, so any " +
        "literal is wrong again every year.",
    ).toEqual([]);
  });
});
