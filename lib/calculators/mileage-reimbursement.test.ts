import { describe, expect, it } from "vitest";
import {
  calculateReimbursement,
  ratePeriodsForYear,
} from "./mileage-reimbursement";
import { getTaxYearConstants } from "@/lib/tax/constants";

/**
 * This is public, free, and about United States tax, so the arithmetic
 * gets pinned rather than eyeballed.
 *
 * The specific trap it must not fall into is the one the public mileage
 * deduction calculator already fell into: multiplying a whole year of
 * miles by MILEAGE_RATE_PER_MILE_CENTS, which in 2026 is only the
 * January to June rate. See lib/tax/split-rate-mileage.test.ts.
 */

const YEAR = 2026;
const C = getTaxYearConstants(YEAR);

describe("rate periods for a year", () => {
  it("splits 2026 into two six-month periods", () => {
    const p = ratePeriodsForYear(YEAR);
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ months: 6, centsPerMile: 72.5 });
    expect(p[1]).toMatchObject({ months: 6, centsPerMile: 76 });
    expect(p[0].label).toBe("Jan to Jun");
    expect(p[1].label).toBe("Jul to Dec");
  });

  it("always covers exactly twelve months", () => {
    // A period table that does not span the year would silently
    // under-count reimbursement for the missing months.
    const total = ratePeriodsForYear(YEAR).reduce((s, p) => s + p.months, 0);
    expect(total).toBe(12);
  });

  it("collapses a single-rate year into one full-year period", () => {
    const p = ratePeriodsForYear(2025);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ months: 12, label: "All year" });
    expect(p[0].centsPerMile).toBe(
      getTaxYearConstants(2025).MILEAGE_RATE_PER_MILE_CENTS,
    );
  });
});

describe("calculateReimbursement", () => {
  const base = { drivers: 5, milesPerDriverPerMonth: 400, taxYear: YEAR, marginalRate: 0.21 };

  it("prices each half of a split year at its own rate", () => {
    const r = calculateReimbursement(base);
    // 5 drivers x 400 mi x 6 months = 12,000 miles per period.
    expect(r.periods[0].miles).toBe(12_000);
    expect(r.periods[1].miles).toBe(12_000);
    expect(r.periods[0].cents).toBe(870_000); // 12,000 x 72.5
    expect(r.periods[1].cents).toBe(912_000); // 12,000 x 76
    expect(r.totalCents).toBe(1_782_000); // $17,820
  });

  it("does NOT apply the flat constant to the whole year", () => {
    // The exact bug this file exists to prevent. A flat 72.5 across
    // 24,000 miles would give $17,400, understating by $420.
    const r = calculateReimbursement(base);
    const flat = Math.round(24_000 * C.MILEAGE_RATE_PER_MILE_CENTS);
    expect(r.totalCents).not.toBe(flat);
    expect(r.totalCents - flat).toBe(42_000);
  });

  it("reports annual miles per driver and in total", () => {
    const r = calculateReimbursement(base);
    expect(r.annualMilesPerDriver).toBe(4_800);
    expect(r.annualMilesTotal).toBe(24_000);
  });

  it("splits the total evenly per driver", () => {
    const r = calculateReimbursement(base);
    expect(r.perDriverCents).toBe(Math.round(1_782_000 / 5));
  });

  it("nets the deduction out of the cost", () => {
    const r = calculateReimbursement(base);
    expect(r.taxSavedCents).toBe(Math.round(1_782_000 * 0.21));
    expect(r.netCostCents).toBe(1_782_000 - r.taxSavedCents);
    expect(r.netCostCents).toBeLessThan(r.totalCents);
  });

  it("displayed period rows sum to the displayed total", () => {
    // Rounding per period rather than once at the end is deliberate;
    // this guards that the visible rows still add up to the visible
    // total, which is the thing a user checks with a calculator.
    const r = calculateReimbursement({ ...base, milesPerDriverPerMonth: 333 });
    expect(r.periods.reduce((s, p) => s + p.cents, 0)).toBe(r.totalCents);
  });

  it("returns zeroes rather than NaN for an empty team", () => {
    const r = calculateReimbursement({ ...base, drivers: 0 });
    expect(r.totalCents).toBe(0);
    expect(r.perDriverCents).toBe(0);
    expect(Number.isFinite(r.netCostCents)).toBe(true);
  });

  it("treats negative input as zero rather than crediting the employer", () => {
    const r = calculateReimbursement({
      ...base,
      drivers: -3,
      milesPerDriverPerMonth: -100,
    });
    expect(r.totalCents).toBe(0);
  });

  it("scales linearly with team size", () => {
    const one = calculateReimbursement({ ...base, drivers: 1 });
    const ten = calculateReimbursement({ ...base, drivers: 10 });
    expect(ten.totalCents).toBe(one.totalCents * 10);
  });

  it("handles fractional miles without drifting a cent", () => {
    const r = calculateReimbursement({
      drivers: 1,
      milesPerDriverPerMonth: 100.5,
      taxYear: YEAR,
      marginalRate: 0,
    });
    // 603 miles x 72.5 = 43,717.5 -> 43,718 ; 603 x 76 = 45,828
    expect(r.periods[0].cents).toBe(43_718);
    expect(r.periods[1].cents).toBe(45_828);
  });
});
