import { describe, expect, it } from "vitest";
import { forecast, type ForecastInput } from "./forecast";

// Regression pins for the tax-engine defects found by the 2026-07-25
// audit. Each was a silent money error with no test coverage; these
// fail loudly if the behaviour ever reverts.

function baseInput(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    taxYear: 2026,
    filingStatus: "single",
    stateCode: "TX",
    age: 40,
    isBlind: false,
    itemize: false,
    dependents: 0,
    dependentsUnder17: 0,
    spouseIncomeCents: 0,
    estimatedPaymentsCents: 0,
    ownerW2WagesCents: 0,
    ownerW2WithheldCents: 0,
    ownerW2SsWagesCents: 0,
    spouseW2WagesCents: 0,
    spouseW2WithheldCents: 0,
    spouseW2SsWagesCents: 0,
    entityType: "self_employed_1099",
    ytdIncomeCents: 0,
    ytdBusinessExpensesCents: 0,
    ytdMealsCents: 0,
    ytdAboveTheLineCents: 0,
    ytdItemizedCents: 0,
    autoMileageCents: 0,
    autoHomeOfficeCents: 0,
    monthsEntered: 12,
    ...overrides,
  };
}

describe("audit #22: LTCG/dividends are investment income", () => {
  it("NIIT fires on capital gains alone (was dead code)", () => {
    const r = forecast(
      baseInput({
        filingStatus: "single",
        ytdIncomeCents: 150_000_00,
        longTermCapitalGainsCents: 200_000_00,
      }),
    );
    // AGI far over the $200k single NIIT threshold with real investment
    // income present, so the 3.8% must apply to something.
    expect(r.niitCents).toBeGreaterThan(0);
  });

  it("no investment income means no NIIT", () => {
    const r = forecast(baseInput({ ytdIncomeCents: 400_000_00 }));
    expect(r.niitCents).toBe(0);
  });
});

describe("audit #38: spouse income counted once in the rate denominator", () => {
  it("both spouse fields set does not inflate gross income", () => {
    const both = forecast(
      baseInput({
        filingStatus: "married_filing_jointly",
        ytdIncomeCents: 100_000_00,
        spouseW2WagesCents: 80_000_00,
        spouseIncomeCents: 80_000_00, // legacy field, same money
      }),
    );
    const onlyW2 = forecast(
      baseInput({
        filingStatus: "married_filing_jointly",
        ytdIncomeCents: 100_000_00,
        spouseW2WagesCents: 80_000_00,
        spouseIncomeCents: 0,
      }),
    );
    // Same household, same money: the effective rate must match.
    expect(both.overallEffectiveRate).toBeCloseTo(
      onlyW2.overallEffectiveRate,
      6,
    );
  });
});

describe("audit #37: employer already withholds the 0.9% surtax", () => {
  it("high W-2 wages credit the employer-withheld additional Medicare", () => {
    const r = forecast(
      baseInput({
        filingStatus: "single",
        ownerW2WagesCents: 300_000_00,
        ownerW2WithheldCents: 0,
        entityType: "s_corp",
      }),
    );
    // $100k over the $200k floor x 0.9% = $900 already withheld by law.
    expect(r.alreadyPaidCents).toBeGreaterThanOrEqual(900_00);
  });

  it("wages under the floor mean nothing extra is credited", () => {
    const r = forecast(
      baseInput({ ownerW2WagesCents: 150_000_00, entityType: "s_corp" }),
    );
    expect(r.alreadyPaidCents).toBe(0);
  });
});

describe("audit #24: QBI cap excludes net capital gain", () => {
  it("large LTCG does not inflate the QBI deduction", () => {
    const withGain = forecast(
      baseInput({
        ytdIncomeCents: 80_000_00,
        longTermCapitalGainsCents: 300_000_00,
      }),
    );
    // Taxable income minus net capital gain is what caps §199A(a)(2);
    // the deduction can never exceed 20% of business income either.
    expect(withGain.qbiDeductionCents).toBeLessThanOrEqual(
      Math.round(80_000_00 * 0.2),
    );
  });
});
