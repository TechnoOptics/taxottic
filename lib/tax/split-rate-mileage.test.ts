import { describe, expect, it } from "vitest";
import { getTaxYearConstants } from "./constants";
import { priceMilesByPeriod } from "@/lib/calculators/mileage-reimbursement";
import { mileageRateCentsForDate } from "@/lib/mileage/deduction";

/**
 * 2026 is a SPLIT-RATE year and the public calculator did not know it.
 *
 * The IRS raised the business standard mileage rate mid-year: 72.5 cents
 * for Jan 1 to Jun 30 (Notice 2026-10), 76 cents from Jul 1.
 * MILEAGE_RATE_PER_MILE_CENTS holds only the FIRST period, and
 * components/calculators/MileageDeductionCalculator.tsx multiplied every
 * mile by it, so every mile driven in the second half of the year was
 * valued 3.5 cents low. On 10,000 second-half miles that is $350 of
 * deduction the calculator simply did not report.
 *
 * The app's own engine was never wrong (lib/mileage/deduction.ts prices
 * each drive by its date). Only the free, public, indexed calculator
 * was, which is the worst place for it: it is the top of the funnel for
 * the product's own wedge feature, and a visitor has no way to know the
 * number is low.
 *
 * These tests pin the arithmetic a split year requires, so a future
 * "simplification" back to one flat rate fails loudly.
 */

const TAX_YEAR = 2026;
const C = getTaxYearConstants(TAX_YEAR);

/**
 * THE FUNCTION THE CALCULATOR ACTUALLY CALLS.
 *
 * This file used to define its own copy of the period loop here. A
 * review pointed out the consequence: reverting the calculator to
 * `Math.round(miles * RATE_CENTS)`, the exact bug this file exists to
 * prevent, left every test below green, because they were exercising
 * the copy. Now they drive the shipped code.
 */
function deductionCents(milesByPeriod: number[]): number {
  return priceMilesByPeriod(
    milesByPeriod,
    C.MILEAGE_RATE_PERIODS ?? [
      { centsPerMile: C.MILEAGE_RATE_PER_MILE_CENTS },
    ],
  );
}

describe("2026 split-rate mileage deduction", () => {
  it("the year really does have two rates", () => {
    // If this ever becomes one period the UI collapses to a single
    // field, which is correct, but it should be a deliberate change.
    expect(C.MILEAGE_RATE_PERIODS).toBeDefined();
    expect(C.MILEAGE_RATE_PERIODS).toHaveLength(2);
    expect(C.MILEAGE_RATE_PERIODS?.[0].centsPerMile).toBe(72.5);
    expect(C.MILEAGE_RATE_PERIODS?.[1].centsPerMile).toBe(76);
  });

  it("the flat constant is ONLY the first period, not the year", () => {
    // The exact misreading that caused the bug. Stated as a test so the
    // next person cannot make it by accident.
    expect(C.MILEAGE_RATE_PER_MILE_CENTS).toBe(72.5);
    expect(C.MILEAGE_RATE_PER_MILE_CENTS).not.toBe(
      C.MILEAGE_RATE_PERIODS?.[1].centsPerMile,
    );
  });

  it("prices second-half miles at the higher rate", () => {
    // 10,000 miles driven after Jul 1 is $7,600, not $7,250.
    expect(deductionCents([0, 10_000])).toBe(760_000);
  });

  it("reproduces the old bug's understatement so the gap is explicit", () => {
    const correct = deductionCents([0, 10_000]);
    const oldFlatRate = Math.round(10_000 * C.MILEAGE_RATE_PER_MILE_CENTS);
    expect(correct - oldFlatRate).toBe(35_000); // $350.00 in cents
  });

  it("sums the two periods rather than applying one rate to the total", () => {
    // 6,000 early + 4,000 late = 435,000 + 304,000 = 739,000 cents.
    expect(deductionCents([6_000, 4_000])).toBe(739_000);
    // A single flat rate on the same 10,000 total would give 725,000.
    expect(deductionCents([6_000, 4_000])).not.toBe(725_000);
  });

  it("still handles a whole year in the first period", () => {
    expect(deductionCents([12_000, 0])).toBe(870_000);
  });

  it("agrees with the engine's per-date pricing at the boundary", () => {
    // The calculator and the app must not diverge on the split date.
    expect(mileageRateCentsForDate(TAX_YEAR, "2026-06-30")).toBe(
      C.MILEAGE_RATE_PERIODS?.[0].centsPerMile,
    );
    expect(mileageRateCentsForDate(TAX_YEAR, "2026-07-01")).toBe(
      C.MILEAGE_RATE_PERIODS?.[1].centsPerMile,
    );
  });

  it("handles fractional miles without drifting a cent", () => {
    // 1,234.5 miles at 76¢ = 93,822 cents exactly.
    expect(deductionCents([0, 1_234.5])).toBe(93_822);
  });
});
