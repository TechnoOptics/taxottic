import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  splitScheduleC,
  mergeScheduleC,
  isAwaitingConfirmation,
  EMPTY_SPLIT,
} from "./schedule-c-totals";

const drive = (
  miles: number,
  cents: number,
  needs: boolean | null,
) => ({ distance_miles: miles, deduction_cents: cents, needs_confirmation: needs });

describe("splitScheduleC", () => {
  it("keeps confirmed drives in the Schedule C total", () => {
    const s = splitScheduleC([drive(10, 760, false), drive(5, 380, false)]);
    expect(s.settledCount).toBe(2);
    expect(s.settledCents).toBe(1140);
    expect(s.pendingCount).toBe(0);
  });

  it("holds out the two drives that were live in production", () => {
    // 2026-08-22: both business at the business rate, both awaiting the
    // driver's confirmation, both inside the headline deduction.
    const s = splitScheduleC([
      drive(21.643, 1645, true),
      drive(22.952, 1744, true),
    ]);
    expect(s.settledCents).toBe(0);
    expect(s.pendingCount).toBe(2);
    expect(s.pendingCents).toBe(3389);
  });

  it("treats a NULL flag as settled, not pending", () => {
    // Rows predating the confirmation migration carry NULL. Treating
    // them as pending would empty the headline for every account older
    // than that migration, which is this bug pointed the other way.
    const s = splitScheduleC([drive(10, 760, null)]);
    expect(s.settledCount).toBe(1);
    expect(s.pendingCount).toBe(0);
    expect(isAwaitingConfirmation(drive(10, 760, null))).toBe(false);
  });

  it("never loses a drive between the two buckets", () => {
    const trips = [
      drive(1, 76, true),
      drive(2, 152, false),
      drive(3, 228, null),
      drive(4, 304, true),
    ];
    const s = splitScheduleC(trips);
    expect(s.settledCount + s.pendingCount).toBe(trips.length);
    expect(s.settledCents + s.pendingCents).toBe(76 + 152 + 228 + 304);
    expect(s.settledMiles + s.pendingMiles).toBeCloseTo(10, 6);
  });

  it("survives null and string values from the driver", () => {
    // distance_miles arrives as a string from PostgREST for numeric
    // columns, and a half-written row can carry nulls.
    const s = splitScheduleC([
      { distance_miles: "12.5", deduction_cents: null, needs_confirmation: false },
      { distance_miles: null, deduction_cents: 100, needs_confirmation: false },
    ]);
    expect(s.settledMiles).toBeCloseTo(12.5, 6);
    expect(s.settledCents).toBe(100);
  });

  it("is empty for an empty set", () => {
    expect(splitScheduleC([])).toEqual(EMPTY_SPLIT);
  });
});

describe("mergeScheduleC", () => {
  it("folds pages without double counting", () => {
    const a = splitScheduleC([drive(10, 760, false)]);
    const b = splitScheduleC([drive(5, 380, true)]);
    const m = mergeScheduleC(a, b);
    expect(m.settledCents).toBe(760);
    expect(m.pendingCents).toBe(380);
    expect(m.settledCount + m.pendingCount).toBe(2);
  });
});

describe("every page showing a deduction applies the same split", () => {
  // WHY BOTH PAGES ARE LISTED HERE. /mileage/business adopted the split
  // in #616 and /mileage did not, so for two days the same concept had
  // two answers. Seen on a real phone on 2026-08-24: /mileage read 23.7
  // business miles against 5.34 USD, because the miles counted every
  // business drive while the money counted only the confirmed ones. A
  // driver reads that as the app underpaying them.
  //
  // A page that shows business miles or a mileage deduction and does
  // not go through splitScheduleC is the bug, so the list is the
  // assertion. Add a page here when it starts showing either number.
  const DEDUCTION_PAGES = [
    "app/mileage/business/page.tsx",
    "app/mileage/page.tsx",
  ] as const;

  it("routes every deduction page through the shared rule", () => {
    for (const page of DEDUCTION_PAGES) {
      const src = readFileSync(resolve(process.cwd(), page), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(?<!:)\/\/[^\n]*/g, " ");
      expect(src, `${page} does not import the shared rule`).toContain(
        "splitScheduleC",
      );
      // Deliberately NOT asserting the page is free of
      // `needs_confirmation === true`. The first version of this guard
      // did, and it failed on correct code: /mileage passes that flag
      // through to TripList so a row can show its own pending state,
      // which is a legitimate read of the field and not a second copy
      // of the totals rule. Banning the string would have pushed a
      // future author to work around the guard rather than with it.
      //
      // What actually matters is that the money is derived from the
      // shared function, and the assertion above is what says so.
      expect(
        src,
        `${page} sums a deduction without the shared rule`,
      ).not.toMatch(
        /reduce\(\s*\(a[^)]*\)\s*=>\s*a\s*\+\s*Number\(t\.deduction_cents\)/,
      );
    }
  });
});

describe("the business page actually applies the split", () => {
  const PAGE = "app/mileage/business/page.tsx";

  function source(): string {
    return readFileSync(resolve(process.cwd(), PAGE), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  }

  it("selects the confirmation flag in both queries", () => {
    // The rule cannot be applied to a column the query never asked for,
    // and PostgREST returns undefined rather than erroring for a field
    // that was not selected, so this would fail silently.
    const src = source();
    const selects = [...src.matchAll(/\.select\(\s*\n?\s*"([^"]*mileage|[^"]*deduction_cents[^"]*)"/g)];
    expect(selects.length).toBeGreaterThan(0);
    for (const m of selects) {
      expect(m[1]).toContain("needs_confirmation");
    }
  });

  it("applies the shared rule rather than reimplementing it", () => {
    const src = source();
    // Both the paged sweep and the single-drive branch must go through
    // the same function. Two copies of a money rule drift, and the
    // single-drive view is the one a driver opens from their expense
    // line, so a divergence there is the one they would act on.
    expect([...src.matchAll(/splitScheduleC\s*\(/g)]).toHaveLength(2);
    // And it must not keep a private copy of the comparison.
    expect(src).not.toMatch(/needs_confirmation\s*===\s*true/);
  });

  it("the rule itself tests the flag for exactly true", () => {
    // Not because truthiness disagrees on boolean|null, it does not,
    // but because a field the query forgot to select comes back as
    // undefined rather than raising. The strict form keeps such a row
    // on the settled side, matching the pre-migration NULL default,
    // instead of letting the shape of a mistake decide.
    const rule = readFileSync(
      resolve(process.cwd(), "lib/mileage/schedule-c-totals.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    expect(rule).toMatch(/needs_confirmation\s*===\s*true/);
  });

  it("discloses the held-back drives rather than silently dropping them", () => {
    const src = source();
    expect(src).toContain("pendingCount");
    expect(src).toMatch(/waiting for you to confirm/i);
  });

  it("guards the guard: the page source is really being read", () => {
    const src = source();
    expect(src.length).toBeGreaterThan(5000);
    expect(src).toContain("mileage_trips");
  });
});
