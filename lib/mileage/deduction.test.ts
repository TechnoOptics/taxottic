import { describe, it, expect } from "vitest";
import {
  businessMileageDeductionCents,
  tripDeductionCents,
  summarizeMileageDeduction,
  resolveAutoMileageCents,
} from "./deduction";

// IRS standard business mileage rate is 70¢/mi for both 2025 and
// 2026 in the bundled constants (MILEAGE_RATE_*_PER_MILE_CENTS).

describe("businessMileageDeductionCents", () => {
  it("100 business miles @ 2025 rate = $70.00 (7000¢)", () => {
    expect(businessMileageDeductionCents(100, 2025)).toBe(7000);
  });

  it("100 business miles @ 2026 rate = $72.50 (7250¢, IRS Notice 2026-10)", () => {
    expect(businessMileageDeductionCents(100, 2026)).toBe(7250);
  });

  it("rounds to the nearest cent", () => {
    // 10.4 mi × 70 = 728.0 ¢
    expect(businessMileageDeductionCents(10.4, 2025)).toBe(728);
    // 12.345 mi × 70 = 864.15 → 864 ¢
    expect(businessMileageDeductionCents(12.345, 2025)).toBe(864);
  });

  it("zero / negative miles deduct nothing", () => {
    expect(businessMileageDeductionCents(0, 2025)).toBe(0);
    expect(businessMileageDeductionCents(-5, 2025)).toBe(0);
  });

  it("out-of-range years fall back, not throw", () => {
    expect(() => businessMileageDeductionCents(50, 2019)).not.toThrow();
    expect(businessMileageDeductionCents(50, 2099)).toBeGreaterThan(0);
  });
});

describe("tripDeductionCents", () => {
  const trip = { distanceMiles: 42 };

  it("business trip deducts at the standard rate", () => {
    expect(tripDeductionCents(trip, "business", 2025)).toBe(
      Math.round(42 * 70),
    );
  });

  it("personal and unclassified deduct $0", () => {
    expect(tripDeductionCents(trip, "personal", 2025)).toBe(0);
    expect(tripDeductionCents(trip, "unclassified", 2025)).toBe(0);
  });
});

describe("summarizeMileageDeduction", () => {
  it("sums ONLY business miles and deducts on the total", () => {
    const trips = [
      { distanceMiles: 10, classification: "business" as const },
      { distanceMiles: 25, classification: "personal" as const },
      { distanceMiles: 5.5, classification: "business" as const },
      { distanceMiles: 100, classification: "unclassified" as const },
    ];
    const s = summarizeMileageDeduction(trips, 2025);
    expect(s.businessMiles).toBeCloseTo(15.5, 6);
    expect(s.deductionCents).toBe(Math.round(15.5 * 70)); // 1085¢
  });

  it("no business trips → zero", () => {
    const s = summarizeMileageDeduction(
      [{ distanceMiles: 80, classification: "personal" }],
      2025,
    );
    expect(s).toEqual({ businessMiles: 0, deductionCents: 0 });
  });
});

describe("resolveAutoMileageCents", () => {
  const base = {
    onStandardVehicle: true,
    trackedYtdCents: 0,
    trackedTripCount: 0,
    manualProjectedCents: 12000,
    manualYtdCents: 3000,
    trackedProjectionMonths: 3,
  };

  it("explicit actual-expense election suppresses both paths", () => {
    // Real costs are deducted instead, so adding standard mileage on top
    // would double-count the same vehicle.
    expect(
      resolveAutoMileageCents({
        ...base,
        onStandardVehicle: false,
        onActualMethod: true,
        trackedYtdCents: 50000,
        trackedTripCount: 9,
      }),
    ).toEqual({ ytdCents: 0, projectedCents: 0 });
  });

  it("no vehicle configured and nothing tracked → nothing to claim", () => {
    expect(
      resolveAutoMileageCents({
        ...base,
        onStandardVehicle: false,
        manualProjectedCents: 0,
        manualYtdCents: 0,
      }),
    ).toEqual({ ytdCents: 0, projectedCents: 0 });
  });

  it("tracked business drives count even when has_vehicle was never set", () => {
    // Regression: an unconfigured profile silently zeroed a real tracked
    // deduction. Production had a company showing $36.61 of business
    // mileage on the Mileage page while the forecast valued it at $0.
    // Logging classified-business drives IS evidence of a business
    // vehicle; only an explicit "actual" election opts out.
    expect(
      resolveAutoMileageCents({
        ...base,
        onStandardVehicle: false,
        onActualMethod: false,
        trackedYtdCents: 3661,
        trackedTripCount: 3,
        trackedProjectionMonths: 6,
      }),
    ).toEqual({ ytdCents: 3661, projectedCents: 7322 });
  });

  it("an unset profile does not resurrect the MANUAL estimate", () => {
    // The implied-vehicle rule is evidence-based: it trusts real drives,
    // not a manual miles figure typed into a profile that was never
    // completed.
    expect(
      resolveAutoMileageCents({
        ...base,
        onStandardVehicle: false,
        trackedYtdCents: 0,
        trackedTripCount: 0,
      }),
    ).toEqual({ ytdCents: 0, projectedCents: 0 });
  });

  it("no tracked trips → manual estimate passes through unchanged", () => {
    expect(resolveAutoMileageCents(base)).toEqual({
      ytdCents: 3000,
      projectedCents: 12000,
    });
  });

  it("tracked classified-business trips override the manual estimate", () => {
    // 3 months of real drives totalling $400; year-end pace = 400 × 12/3.
    const r = resolveAutoMileageCents({
      ...base,
      trackedYtdCents: 40000,
      trackedTripCount: 7,
      trackedProjectionMonths: 3,
    });
    expect(r.ytdCents).toBe(40000); // ground truth, not projected
    expect(r.projectedCents).toBe(160000); // 40000 × 12 / 3
  });

  it("a tracked total of $0 does not override (falls back to manual)", () => {
    expect(
      resolveAutoMileageCents({ ...base, trackedTripCount: 4, trackedYtdCents: 0 }),
    ).toEqual({ ytdCents: 3000, projectedCents: 12000 });
  });

  it("clamps the tracked projection month basis to [1, 12]", () => {
    // 0 months → treated as 1 (no divide-by-zero, no >12 inflation).
    expect(
      resolveAutoMileageCents({
        ...base,
        trackedYtdCents: 5000,
        trackedTripCount: 1,
        trackedProjectionMonths: 0,
      }).projectedCents,
    ).toBe(60000); // 5000 × 12 / 1
    // 18 months → clamped to 12 → projected == ytd.
    expect(
      resolveAutoMileageCents({
        ...base,
        trackedYtdCents: 5000,
        trackedTripCount: 1,
        trackedProjectionMonths: 18,
      }).projectedCents,
    ).toBe(5000); // 5000 × 12 / 12
  });
});

// ── Split-rate year (2026 IRS mid-year adjustment) ──────────────────
// The IRS raised the business rate to 76¢/mi effective Jul 1, 2026;
// 72.5¢ applies Jan 1 – Jun 30 (Notice 2026-10). Every trip must be
// priced at the rate in force ON ITS DATE, and annualized projections
// at the month-weighted average. These tests pin that behaviour so a
// future "simplify to one constant" regression fails loudly.
import {
  mileageRateCentsForDate,
  fullYearAverageMileageRateCents,
} from "./deduction";

describe("2026 split-rate pricing", () => {
  it("resolves the rate by trip date across the Jul 1 boundary", () => {
    expect(mileageRateCentsForDate(2026, "2026-06-30T23:59:00Z")).toBe(72.5);
    expect(mileageRateCentsForDate(2026, "2026-07-01T00:00:00Z")).toBe(76);
    expect(mileageRateCentsForDate(2026, "2026-01-15")).toBe(72.5);
    expect(mileageRateCentsForDate(2026, "2026-12-31")).toBe(76);
  });

  it("undated calls fall back to the base year rate", () => {
    expect(mileageRateCentsForDate(2026)).toBe(72.5);
    expect(mileageRateCentsForDate(2025, "2025-08-01")).toBe(70);
  });

  it("prices a trip at its own date's rate", () => {
    expect(businessMileageDeductionCents(100, 2026, "2026-03-10")).toBe(7250);
    expect(businessMileageDeductionCents(100, 2026, "2026-08-10")).toBe(7600);
  });

  it("tripDeductionCents: business-only, date-aware", () => {
    expect(
      tripDeductionCents({ distanceMiles: 10 }, "business", 2026, "2026-09-01"),
    ).toBe(760);
    expect(
      tripDeductionCents({ distanceMiles: 10 }, "personal", 2026, "2026-09-01"),
    ).toBe(0);
  });

  it("full-year average is month-weighted (6mo @72.5 + 6mo @76)", () => {
    expect(fullYearAverageMileageRateCents(2026)).toBeCloseTo(74.25, 5);
    expect(fullYearAverageMileageRateCents(2025)).toBe(70);
  });
});
