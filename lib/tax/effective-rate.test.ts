import { describe, it, expect } from "vitest";
import { forecast } from "./forecast";
import { neutralForecastInput, toCents } from "@/lib/calculators/base-input";

/**
 * Regression guard for the effectiveRate → overallEffectiveRate rename.
 *
 * The old `effectiveRate` divided total tax by BUSINESS income only, so a
 * pure-W-2 filer got 0% (business income = 0) and mixed filers were
 * overstated (whole tax ÷ just the business slice), the May 2026 audit's
 * "the field name lies about its denominator" finding. `overallEffectiveRate`
 * divides by total gross income (business + W-2 + spouse).
 */
const input = (over: Record<string, unknown>) => ({
  ...neutralForecastInput(2026, "single"),
  ...over,
});

describe("overallEffectiveRate", () => {
  it("is non-zero for a pure W-2 filer (the old business-only rate returned 0%)", () => {
    const r = forecast(
      input({
        ytdIncomeCents: 0,
        ownerW2WagesCents: toCents(100_000),
        ownerW2SsWagesCents: toCents(100_000),
      }),
    );
    expect(r.totalTaxCents).toBeGreaterThan(0);
    expect(r.overallEffectiveRate).toBeGreaterThan(0.05);
  });

  it("equals total tax ÷ income for a pure self-employed filer (unchanged)", () => {
    const r = forecast(input({ ytdIncomeCents: toCents(100_000) }));
    expect(r.overallEffectiveRate).toBeCloseTo(
      r.totalTaxCents / toCents(100_000),
      6,
    );
  });

  it("blends W-2 + self-employment income in the denominator", () => {
    const r = forecast(
      input({
        ytdIncomeCents: toCents(50_000),
        ownerW2WagesCents: toCents(50_000),
        ownerW2SsWagesCents: toCents(50_000),
      }),
    );
    // Denominator = 50k business + 50k W-2 = 100k gross.
    expect(r.overallEffectiveRate).toBeCloseTo(
      r.totalTaxCents / toCents(100_000),
      6,
    );
  });
});
