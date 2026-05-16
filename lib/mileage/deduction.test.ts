import { describe, it, expect } from "vitest";
import {
  businessMileageDeductionCents,
  tripDeductionCents,
  summarizeMileageDeduction,
} from "./deduction";

// IRS standard business mileage rate is 70¢/mi for both 2025 and
// 2026 in the bundled constants (MILEAGE_RATE_*_PER_MILE_CENTS).

describe("businessMileageDeductionCents", () => {
  it("100 business miles @ 2025 rate = $70.00 (7000¢)", () => {
    expect(businessMileageDeductionCents(100, 2025)).toBe(7000);
  });

  it("2026 uses the 2026 bundled rate", () => {
    expect(businessMileageDeductionCents(100, 2026)).toBe(7000);
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
