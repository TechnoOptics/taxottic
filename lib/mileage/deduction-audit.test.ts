/**
 * The audit must find violations, and the cron must actually call it.
 *
 * The second half is the point of this file. `checkTrip` and
 * `checkTrips` were correct, fully unit-tested, and had ZERO callers
 * for a week, during which two new violating rows appeared in
 * production. A detector nobody runs is a comment, so the wiring is
 * asserted here as strictly as the rules are.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { auditDeductions } from "./deduction-audit";

/** Strip comments so a guard cannot match its own explanation. */
function sourceWithoutComments(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

type Row = {
  id: string;
  classification: string | null;
  needs_confirmation: boolean | null;
  deduction_cents: number | null;
  distance_miles: number | null;
};

/** A fake that records the filter it was asked for. */
function fakeDb(pages: Row[][], error?: unknown) {
  const seen = { table: "", cols: "", filter: "", ranges: [] as string[] };
  let call = 0;
  return {
    seen,
    db: {
      from(table: string) {
        seen.table = table;
        return {
          select(cols: string) {
            seen.cols = cols;
            return {
              or(filter: string) {
                seen.filter = filter;
                return {
                  order() {
                    return {
                      async range(from: number, to: number) {
                        seen.ranges.push(`${from}-${to}`);
                        if (error) return { data: null, error };
                        return { data: pages[call++] ?? [], error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

const clean: Row = {
  id: "t1",
  classification: "business",
  needs_confirmation: false,
  deduction_cents: 1000,
  distance_miles: 13,
};

describe("auditDeductions", () => {
  it("reports a clean table as clean, and complete", async () => {
    const { db } = fakeDb([[clean]]);
    const r = await auditDeductions(db, () => {});
    expect(r.violations).toEqual([]);
    expect(r.summary).toBe("ok");
    expect(r.complete).toBe(true);
    expect(r.scanned).toBe(1);
  });

  it("finds the shape that is live in production today", async () => {
    // Two business trips at the business rate, still awaiting the
    // driver's confirmation. This is what the hand-run found on
    // 2026-08-22: 16.45 and 17.44 USD.
    const { db } = fakeDb([
      [
        { ...clean, id: "a", needs_confirmation: true, deduction_cents: 1645 },
        { ...clean, id: "b", needs_confirmation: true, deduction_cents: 1744 },
      ],
    ]);
    const r = await auditDeductions(db, () => {});
    expect(r.violations.map((v) => v.kind)).toEqual([
      "unconfirmed_with_deduction",
      "unconfirmed_with_deduction",
    ]);
    expect(r.summary).toContain("33.89");
  });

  it("asks only for rows that can possibly violate", async () => {
    // A row at zero satisfies every rule, so scanning them would be
    // work that cannot produce a finding.
    const { db, seen } = fakeDb([[]]);
    await auditDeductions(db, () => {});
    expect(seen.table).toBe("mileage_trips");
    expect(seen.filter).toContain("deduction_cents.gt.0");
    expect(seen.filter).toContain("deduction_cents.lt.0");
  });

  it("never reports a read failure as a clean table", async () => {
    // The most dangerous possible output of this function is
    // "no violations" produced by a query that never ran.
    const { db } = fakeDb([], new Error("connection reset"));
    const r = await auditDeductions(db, () => {});
    expect(r.complete).toBe(false);
    expect(r.violations).toEqual([]);
    expect(r.scanned).toBe(0);
  });

  it("does not throw when the client throws", async () => {
    const exploding = {
      from() {
        throw new Error("boom");
      },
    };
    await expect(auditDeductions(exploding, () => {})).resolves.toMatchObject({
      complete: false,
    });
  });

  it("logs one greppable line naming the offending trips", async () => {
    const lines: string[] = [];
    const { db } = fakeDb([
      [{ ...clean, id: "bad-1", classification: "personal" }],
    ]);
    await auditDeductions(db, (l) => lines.push(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[deduction-audit]");
    expect(lines[0]).toContain("bad-1");
  });
});

describe("the finalize cron actually calls it", () => {
  const CRON = "app/api/cron/mileage-finalize/route.ts";

  it("imports and invokes auditDeductions", () => {
    const src = sourceWithoutComments(CRON);
    expect(src).toContain("auditDeductions");
    // An import alone is not a call. This is the exact distinction the
    // module went a week without.
    expect(src).toMatch(/await\s+auditDeductions\s*\(/);
  });

  it("reports the result in the cron's response body", () => {
    // A result computed and discarded is the same as not computing it.
    const src = sourceWithoutComments(CRON);
    expect(src).toContain("deductionAudit");
  });

  it("guards the guard: the cron source is really being read", () => {
    // If the read or the comment strip ever empties this string, every
    // assertion above passes vacuously.
    const src = sourceWithoutComments(CRON);
    expect(src.length).toBeGreaterThan(5000);
    expect(src).toContain("mileage_points_raw");
  });
});
