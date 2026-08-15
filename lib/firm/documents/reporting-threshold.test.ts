import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getTaxYearConstants } from "@/lib/tax/constants";
import { loadNECRecipients } from "./generate-1099";

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

/**
 * BEHAVIOURAL cover, added after a review showed the checks above are
 * defeatable in one line.
 *
 * The tests above grep the source. That catches a numeric literal
 * reappearing in the filter, and it does NOT catch the obvious
 * workaround: leave the call to reportingThresholdCents(taxYear) exactly
 * where it is and make that function `return 60_000`. Every string
 * assertion still passes and the $600 bug is fully restored.
 *
 * So these call the real exported loader with a stubbed client and
 * assert on which recipients survive. That is the behaviour the firm
 * actually gets, and no amount of source rearrangement can fake it.
 */
describe("the threshold is enforced, not merely referenced", () => {
  /** Minimal stand-in for the PostgREST chain the loader uses. */
  function stubAdmin(rows: { amount_cents: number; notes: string }[]) {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in"]) {
      chain[m] = () => chain;
    }
    // Awaiting the chain resolves to the PostgREST envelope.
    (chain as { then: unknown }).then = (
      resolve: (v: { data: unknown }) => unknown,
    ) => resolve({ data: rows });
    return { from: () => chain } as unknown as Parameters<
      typeof loadNECRecipients
    >[0];
  }

  const ROWS = [
    { amount_cents: 199_900, notes: "Just under 2026 threshold" },
    { amount_cents: 200_000, notes: "Exactly at 2026 threshold" },
    { amount_cents: 500_000, notes: "Well over" },
    { amount_cents: 60_000, notes: "Old $600 threshold" },
  ];

  it("2026 excludes everyone under $2,000", async () => {
    const out = await loadNECRecipients(stubAdmin(ROWS), "co", 2026);
    const names = out.map((r) => r.name).sort();
    expect(names).toEqual(["Exactly at 2026 threshold", "Well over"]);
    // The specific regression: a $600 contractor must NOT get a form.
    expect(names).not.toContain("Old $600 threshold");
  });

  it("2025 still uses the pre-OBBBA $600 threshold", async () => {
    // Correctness in both directions. A firm filing a late 2025 return
    // must still get forms for $600 payments, so the fix must not have
    // simply raised the number everywhere.
    const out = await loadNECRecipients(stubAdmin(ROWS), 2025 as never, 2025);
    expect(out).toHaveLength(4);
  });

  it("is boundary-exact: one cent under is excluded", async () => {
    const edge = [
      { amount_cents: 199_999, notes: "one cent under" },
      { amount_cents: 200_000, notes: "exactly at" },
    ];
    const out = await loadNECRecipients(stubAdmin(edge), "co", 2026);
    expect(out.map((r) => r.name)).toEqual(["exactly at"]);
  });
});
