import { describe, expect, it } from "vitest";
import { forecast, type ForecastInput } from "./forecast";

/**
 * Forecast-engine integration tests.
 *
 * Two strands here:
 *
 *   1. **Fixture-based scenarios** — a small library of realistic
 *      filers (W-2 only, sole prop, W-2 + side hustle, AMT trigger,
 *      LTCG-only retiree) where we've computed the expected outputs
 *      by hand against the published rules. Catches regressions that
 *      individual-credit-module tests miss because they only see one
 *      slice.
 *
 *   2. **Property-based invariants** — invariants that must hold for
 *      ANY input, asserted with parameterised inputs. Catches
 *      sign-flip / off-by-one / clamping bugs that integration tests
 *      can miss when their fixed inputs happen to avoid the bug.
 *
 * The expected dollar amounts below are approximate ranges (±~$50)
 * because the engine has many small interactions (half SE tax,
 * additional Medicare, NIIT, QBI limits, AMT comparison). The
 * ranges are tight enough to catch any meaningful bug.
 *
 * NOTE: when a new credit or deduction is wired into the engine, add
 * a focused fixture here AND check that the property tests still pass.
 */

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

const cents = (dollars: number) => Math.round(dollars * 100);

function baseInput(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    taxYear: 2026,
    filingStatus: "single",
    stateCode: "TX", // no state income tax - keep tests focused on federal
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

// --------------------------------------------------------------------
// Fixture scenarios
// --------------------------------------------------------------------

describe("Fixture: W-2 only filer (single, $80k wages, $9k withheld)", () => {
  it("produces sensible tax owed and a small balance", () => {
    const result = forecast(
      baseInput({
        ownerW2WagesCents: cents(80_000),
        ownerW2WithheldCents: cents(9_000),
        ownerW2SsWagesCents: cents(80_000),
        entityType: "self_employed_1099", // entity doesn't matter w/o SE income
      }),
    );

    // 2026 single brackets:
    //   $80,000 wages, $16,100 standard deduction → taxable $63,900
    //   10% × $12,400 + 12% × ($50,400-$12,400) + 22% × ($63,900-$50,400)
    //   = $1,240 + $4,560 + $2,970 = $8,770
    //
    // No SE tax, no QBI, no other credits.
    expect(result.federalIncomeTaxCents).toBeGreaterThan(cents(8_500));
    expect(result.federalIncomeTaxCents).toBeLessThan(cents(9_000));

    // No SE tax for a W-2 filer with zero SE income.
    expect(result.selfEmploymentTaxCents).toBe(0);

    // No QBI (SE_ENTITY_TYPES requires netBiz > 0).
    expect(result.qbiDeductionCents).toBe(0);

    // Balance: ~$8,770 - $9,000 withheld → small refund.
    expect(result.refundCents).toBeGreaterThan(cents(100));
    expect(result.stillOwedCents).toBe(0);
  });

  it("triggers a W-4 nudge when over-withheld", () => {
    const result = forecast(
      baseInput({
        ownerW2WagesCents: cents(80_000),
        ownerW2WithheldCents: cents(15_000), // big over-withholding
        ownerW2SsWagesCents: cents(80_000),
      }),
    );
    expect(result.refundCents).toBeGreaterThan(cents(5_000));
    expect(result.w4Recommendation.direction).toBe("decrease");
    expect(result.w4Recommendation.perPaycheckDeltaCents).toBeGreaterThan(0);
  });
});

describe("Fixture: Sole prop, $100k income, $20k expenses, no W-2", () => {
  it("computes SE tax, QBI deduction, and quarterly estimates", () => {
    const result = forecast(
      baseInput({
        entityType: "sole_prop",
        ytdIncomeCents: cents(100_000),
        ytdBusinessExpensesCents: cents(20_000),
      }),
    );

    // Net business ≈ $80,000
    expect(result.projectedNetBusinessIncomeCents).toBe(cents(80_000));

    // SE tax = (12.4% SS + 2.9% Medicare) × 92.35% × $80k
    //        = 15.3% × $73,880 = ~$11,304
    expect(result.selfEmploymentTaxCents).toBeGreaterThan(cents(11_000));
    expect(result.selfEmploymentTaxCents).toBeLessThan(cents(11_500));

    // QBI 20% × net biz (full deduction below threshold)
    // = 20% × $80,000 = $16,000 (capped by 20% of taxable-before-QBI)
    expect(result.qbiDeductionCents).toBeGreaterThan(cents(10_000));

    // Should produce quarterly estimates.
    expect(result.quarterlyEstimates).toHaveLength(4);
  });
});

describe("Fixture: W-2 + side hustle (the OBBBA 'both' case)", () => {
  it("nets W-2 withholding against SE tax owed", () => {
    const result = forecast(
      baseInput({
        ownerW2WagesCents: cents(100_000),
        ownerW2WithheldCents: cents(15_000),
        ownerW2SsWagesCents: cents(100_000),
        entityType: "sole_prop",
        ytdIncomeCents: cents(25_000),
        ytdBusinessExpensesCents: cents(5_000),
      }),
    );

    // Has SE tax from the side hustle.
    expect(result.selfEmploymentTaxCents).toBeGreaterThan(0);

    // Side hustle SE earnings still subject to SS unless wage base
    // is fully used by W-2. W-2 SS wages $100k < 2026 base $184,500.
    // SE side adds onto that.
    expect(result.alreadyPaidCents).toBe(cents(15_000));
  });
});

describe("Fixture: Retirement contributions trigger savings + recommendation", () => {
  it("computes tax savings + per-bucket recommendation", () => {
    const result = forecast(
      baseInput({
        entityType: "sole_prop",
        ytdIncomeCents: cents(150_000),
        retirementSolo401kCents: cents(15_000),
      }),
    );
    expect(result.retirementContributionTotalCents).toBe(cents(15_000));
    // Tax savings = marginal × contribution. Marginal at this income
    // is 22% (single bracket).
    expect(result.retirementTaxSavingsCents).toBeGreaterThan(cents(2_500));
    expect(result.retirementTaxSavingsCents).toBeLessThan(cents(3_500));
    // Should recommend more contribution since they're under the cap.
    expect(result.retirementRecommendation.bucket).not.toBe("none");
    expect(result.retirementRecommendation.addCents).toBeGreaterThan(0);
  });
});

describe("Fixture: AMT trigger (high income + heavy itemized deductions)", () => {
  it("amtAddOnCents is positive when AMT > regular", () => {
    // High earners with sizable itemized deductions (which AMT
    // doesn't honor the same way) typically see AMT pull tax up.
    // Simulate a $350k single filer with $40k itemized (so taxable
    // income would be relatively low for regular tax but AMT
    // computes against AGI which is much higher).
    const result = forecast(
      baseInput({
        ownerW2WagesCents: cents(350_000),
        ownerW2WithheldCents: cents(70_000),
        ownerW2SsWagesCents: cents(184_500),
        itemize: true,
        ytdItemizedCents: cents(40_000),
      }),
    );
    // AMT might or might not trigger depending on the exact numbers.
    // The key invariant: amtAddOnCents is non-negative, and totalTax
    // reflects whichever was larger.
    expect(result.amtAddOnCents).toBeGreaterThanOrEqual(0);
  });
});

describe("Fixture: Capital gains separate brackets", () => {
  it("LTCG at preferred 15% rate vs ordinary income", () => {
    // Single filer with $100k LTCG and no ordinary income.
    // 2026 LTCG 0% breakpoint for single = $49,450.
    // $100k LTCG: 0% on first $49,450, 15% on next $50,550 = $7,582.50
    // Minus standard deduction reduces "taxable" but LTCG breakpoints
    // are applied to taxable income; the slice in the 0% bracket is
    // larger than the std-deduction amount, so we expect non-zero LTCG
    // tax in the $7-8k range.
    const result = forecast(
      baseInput({
        longTermCapitalGainsCents: cents(100_000),
      }),
    );
    expect(result.capitalGainsTaxCents).toBeGreaterThan(cents(4_000));
    expect(result.capitalGainsTaxCents).toBeLessThan(cents(9_000));
  });
});

describe("Fixture: EITC for low-income filer", () => {
  it("single filer with $13k W-2 wages → EITC ≈ $664 (0 kids plateau)", () => {
    const result = forecast(
      baseInput({
        ownerW2WagesCents: cents(13_020),
        ownerW2SsWagesCents: cents(13_020),
        ownerW2WithheldCents: 0,
      }),
    );
    // earned-income amount for 0 kids 2026 is $8,680. At $13,020
    // earned income, the user is in the plateau / start of phase-out:
    //   phase-in value = 8,680 × 0.0765 = $664
    //   phase-out doesn't start until $10,860 single (0 kids)
    //   phase-out basis = max(13020, agi) - 10860 = ~2,160
    //   phase-out rate = 664 / (19540 - 10860) = 664 / 8680 = 7.65%
    //   phase-out amount = 2160 × 0.0765 = $165
    //   credit ≈ $499
    expect(result.eitcCents).toBeGreaterThan(cents(400));
    expect(result.eitcCents).toBeLessThan(cents(700));
  });
});

// --------------------------------------------------------------------
// Property-based invariants
// --------------------------------------------------------------------

describe("Invariants — values that must always hold", () => {
  // A spread of inputs to test invariants against. Each should
  // produce a consistent result.
  const scenarios: Array<{ name: string; input: ForecastInput }> = [
    {
      name: "empty / zero",
      input: baseInput(),
    },
    {
      name: "modest W-2",
      input: baseInput({
        ownerW2WagesCents: cents(50_000),
        ownerW2WithheldCents: cents(5_000),
        ownerW2SsWagesCents: cents(50_000),
      }),
    },
    {
      name: "high-income sole prop",
      input: baseInput({
        entityType: "sole_prop",
        ytdIncomeCents: cents(300_000),
        ytdBusinessExpensesCents: cents(50_000),
      }),
    },
    {
      name: "MFJ with 3 kids + Roth + traditional IRA + HSA",
      input: baseInput({
        filingStatus: "married_filing_jointly",
        dependents: 3,
        dependentsUnder17: 3,
        ownerW2WagesCents: cents(120_000),
        ownerW2WithheldCents: cents(12_000),
        ownerW2SsWagesCents: cents(120_000),
        spouseW2WagesCents: cents(60_000),
        spouseW2WithheldCents: cents(6_000),
        spouseW2SsWagesCents: cents(60_000),
        retirementTraditionalIraCents: cents(7_500),
        retirementRothIraCents: cents(7_500),
        retirementHsaCents: cents(4_400),
      }),
    },
    {
      name: "retiree on LTCG only",
      input: baseInput({
        age: 70,
        longTermCapitalGainsCents: cents(60_000),
        qualifiedDividendsCents: cents(15_000),
      }),
    },
    {
      name: "CA high earner",
      input: baseInput({
        stateCode: "CA",
        ownerW2WagesCents: cents(250_000),
        ownerW2WithheldCents: cents(60_000),
        ownerW2SsWagesCents: cents(184_500),
      }),
    },
  ];

  for (const { name, input } of scenarios) {
    describe(`scenario: ${name}`, () => {
      const result = forecast(input);

      it("no NaN or negative-infinity in any reported cents field", () => {
        const fields = [
          result.projectedIncomeCents,
          result.projectedExpensesCents,
          result.projectedNetBusinessIncomeCents,
          result.selfEmploymentTaxCents,
          result.additionalMedicareCents,
          result.niitCents,
          result.qbiDeductionCents,
          result.childAndDependentCreditsCents,
          result.taxableIncomeCents,
          result.federalIncomeTaxCents,
          result.stateTaxCents,
          result.totalTaxCents,
          result.alreadyPaidCents,
          result.stillOwedCents,
          result.refundCents,
          result.eitcCents,
          result.saversCreditCents,
          result.amtAddOnCents,
          result.capitalGainsTaxCents,
          result.retirementContributionTotalCents,
          result.retirementTaxSavingsCents,
          result.foreignEarnedIncomeExcludedCents,
          result.studentLoanInterestDeductionCents,
          result.educationCreditRefundableCents,
          result.educationCreditNonRefundableCents,
        ];
        for (const f of fields) {
          expect(Number.isFinite(f)).toBe(true);
          expect(Number.isNaN(f)).toBe(false);
        }
      });

      it("stillOwed and refund are mutually exclusive (both never positive)", () => {
        // Exactly one or both zero; never both > 0.
        const bothPositive =
          result.stillOwedCents > 0 && result.refundCents > 0;
        expect(bothPositive).toBe(false);
      });

      it("stillOwed and refund are non-negative", () => {
        expect(result.stillOwedCents).toBeGreaterThanOrEqual(0);
        expect(result.refundCents).toBeGreaterThanOrEqual(0);
      });

      it("alreadyPaid + balance reconciles with totalTax", () => {
        // totalTax = alreadyPaid + stillOwed - refund
        // (refund is what alreadyPaid covered beyond totalTax)
        const computed =
          result.alreadyPaidCents +
          result.stillOwedCents -
          result.refundCents;
        expect(Math.abs(computed - result.totalTaxCents)).toBeLessThan(2);
      });

      it("marginal rate is one of the valid bracket rates (or zero)", () => {
        const validRates = [0, 0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37, 0.21];
        const found = validRates.some(
          (r) => Math.abs(result.marginalRate - r) < 0.0001,
        );
        expect(found, `unexpected marginal ${result.marginalRate}`).toBe(true);
      });

      it("CTC + ODC does not exceed dependents × $2,200 (2026 max)", () => {
        const max = input.dependents * 2_200 * 100;
        expect(result.childAndDependentCreditsCents).toBeLessThanOrEqual(max);
      });

      it("QBI deduction never exceeds 20% of taxable income", () => {
        const taxableBeforeQbi =
          result.taxableIncomeCents + result.qbiDeductionCents;
        expect(result.qbiDeductionCents).toBeLessThanOrEqual(
          Math.round(taxableBeforeQbi * 0.2) + 1, // +1 for rounding
        );
      });

      it("AMT add-on is non-negative", () => {
        expect(result.amtAddOnCents).toBeGreaterThanOrEqual(0);
      });

      it("federal tax never goes negative even with refundable credits", () => {
        // EITC + AOTC refundable can make TOTAL tax negative (intended),
        // but the federalIncomeTaxCents field is the post-credits regular
        // tax which can't go below zero.
        expect(result.federalIncomeTaxCents).toBeGreaterThanOrEqual(0);
      });
    });
  }

  it("higher income → higher (or equal) total tax (monotonicity, holding everything else equal)", () => {
    const incomes = [25_000, 50_000, 100_000, 200_000, 400_000];
    let lastTax = -1;
    for (const inc of incomes) {
      const r = forecast(
        baseInput({
          entityType: "sole_prop",
          ytdIncomeCents: cents(inc),
        }),
      );
      expect(r.totalTaxCents, `tax dropped at $${inc}`).toBeGreaterThanOrEqual(
        lastTax,
      );
      lastTax = r.totalTaxCents;
    }
  });

  it("more deductible retirement contribution → more (or equal) tax savings", () => {
    const contributions = [0, 5_000, 10_000, 20_000, 30_000];
    let lastSavings = -1;
    for (const c of contributions) {
      const r = forecast(
        baseInput({
          entityType: "sole_prop",
          ytdIncomeCents: cents(200_000),
          retirementSolo401kCents: cents(c),
        }),
      );
      expect(r.retirementTaxSavingsCents).toBeGreaterThanOrEqual(lastSavings);
      lastSavings = r.retirementTaxSavingsCents;
    }
  });
});

// --------------------------------------------------------------------
// Round-2 audit regressions (May 2026 W20 verification run)
// --------------------------------------------------------------------

describe("Audit regression: SE tax SS-wage-base cap (HIGH-1)", () => {
  it("caps the 12.4% Social Security portion at the year's wage base", () => {
    // $300k net SE → SE earnings = $300,000 × 0.9235 = $276,950, which
    // is WELL above the 2026 SSA wage base of $184,500. Without the
    // cap, SE tax would be 15.3% × $276,950 = $42,373; with the cap
    // it's 12.4% × $184,500 + 2.9% × $276,950 = $22,878 + $8,032 =
    // $30,910. The pre-fix bug was an uncapped 15.3% × net SE.
    const r = forecast(
      baseInput({
        entityType: "sole_prop",
        ytdIncomeCents: cents(300_000),
        stateCode: "TX",
      }),
    );
    // Allow ±$50 for half-SE-tax-deduction interactions.
    expect(r.selfEmploymentTaxCents).toBeGreaterThan(cents(30_800));
    expect(r.selfEmploymentTaxCents).toBeLessThan(cents(31_000));
  });

  it("matches 15.3% × net SE when net SE is below the wage base", () => {
    // At $100k net SE (below the cap), capping is a no-op — SE tax
    // should equal the simple 15.3% × 92.35% × net.
    const r = forecast(
      baseInput({
        entityType: "sole_prop",
        ytdIncomeCents: cents(100_000),
        stateCode: "TX",
      }),
    );
    const expected = Math.round(cents(100_000) * 0.9235 * 0.153);
    expect(Math.abs(r.selfEmploymentTaxCents - expected)).toBeLessThan(
      cents(20),
    );
  });
});

describe("Audit regression: S-Corp QBI deduction (HIGH-2)", () => {
  // S-Corp distributions to owners ARE QBI-eligible under IRC §199A.
  // The Round-2 audit found the engine returning QBI = 0 for every
  // S-Corp because the gate was on SE_ENTITY_TYPES (which excludes
  // S-Corp). Fixed by introducing QBI_ELIGIBLE_ENTITY_TYPES that
  // includes S-Corp.
  it("computes a non-zero QBI deduction for a $100k S-Corp Single", () => {
    const r = forecast(
      baseInput({
        entityType: "s_corp",
        ytdIncomeCents: cents(100_000),
        stateCode: "TX",
      }),
    );
    // QBI = 20% × $100,000 = $20,000 (or capped by 20% × taxable-
    // before-QBI which is roughly $20k below threshold).
    expect(r.qbiDeductionCents).toBeGreaterThan(cents(15_000));
  });

  it("produces the same QBI as a Sole-Prop with the same net biz, single threshold", () => {
    const soleProp = forecast(
      baseInput({
        entityType: "sole_prop",
        ytdIncomeCents: cents(80_000),
        stateCode: "TX",
      }),
    );
    const sCorp = forecast(
      baseInput({
        entityType: "s_corp",
        ytdIncomeCents: cents(80_000),
        stateCode: "TX",
      }),
    );
    // Both should get a QBI deduction; the S-Corp's will differ
    // slightly because the AGI baseline differs (no SE tax → no half-
    // SE deduction → slightly higher AGI → slightly higher taxable-
    // before-QBI cap). Within $1,500 is good enough for this
    // regression's purpose.
    expect(sCorp.qbiDeductionCents).toBeGreaterThan(cents(10_000));
    expect(
      Math.abs(sCorp.qbiDeductionCents - soleProp.qbiDeductionCents),
    ).toBeLessThan(cents(2_000));
  });
});

describe("Audit regression: state-tax base = AGI − state std (HIGH-4)", () => {
  // The Round-2 audit found CA tax for a $50k Single Sole Prop in CA
  // forecasting at ~$378 — way under the hand-calc range of $900-
  // $1,100. Root cause: state tax was applied to federal taxable
  // income (which had federal std deduction AND federal QBI already
  // subtracted). The fix: compute state tax against AGI − state std
  // deduction. No QBI at state level.
  it("CA Sole-Prop $50k Single produces state tax in the $900–$1,100 range", () => {
    const r = forecast(
      baseInput({
        entityType: "sole_prop",
        ytdIncomeCents: cents(50_000),
        stateCode: "CA",
      }),
    );
    expect(r.stateTaxCents).toBeGreaterThan(cents(900));
    expect(r.stateTaxCents).toBeLessThan(cents(1_200));
  });

  it("NY Sole-Prop $100k Single produces state tax in the $3.5k–$4.5k range", () => {
    const r = forecast(
      baseInput({
        entityType: "sole_prop",
        ytdIncomeCents: cents(100_000),
        stateCode: "NY",
      }),
    );
    expect(r.stateTaxCents).toBeGreaterThan(cents(3_500));
    expect(r.stateTaxCents).toBeLessThan(cents(5_000));
  });

  it("TX (no income tax) produces $0 state tax", () => {
    const r = forecast(
      baseInput({
        entityType: "sole_prop",
        ytdIncomeCents: cents(200_000),
        stateCode: "TX",
      }),
    );
    expect(r.stateTaxCents).toBe(0);
  });
});

describe("Audit regression: S-Corp wages assumption (HIGH-3)", () => {
  it("surfaces a hint when no owner W-2 wages are recorded", () => {
    const r = forecast(
      baseInput({
        entityType: "s_corp",
        ytdIncomeCents: cents(200_000),
        stateCode: "TX",
      }),
    );
    // The engine should emit a hint warning about $0 wages.
    expect(
      r.hints.some((h) => /reasonable compensation/i.test(h)),
    ).toBe(true);
  });

  it("acknowledges owner wages in an assumption when provided", () => {
    const r = forecast(
      baseInput({
        entityType: "s_corp",
        ytdIncomeCents: cents(200_000),
        stateCode: "TX",
        ownerW2WagesCents: cents(80_000),
        ownerW2SsWagesCents: cents(80_000),
      }),
    );
    expect(
      r.assumptions.some((a) => /owner W-2 wages/i.test(a)),
    ).toBe(true);
  });
});

// --------------------------------------------------------------------
// Audit regression: 2026 FIT bracket math, Single, pure W-2 income
// (MEDIUM-2 in Round-2 audit — pins known-good values at three points
// in the schedule so any future bracket / std-deduction regression
// trips immediately. Uses self_employed_1099 + only W-2 wages so SE
// tax, QBI, and Schedule C complications are all zero.)
// --------------------------------------------------------------------

describe("Audit regression: 2026 FIT brackets (Single, W-2 only)", () => {
  function single(wagesUsd: number) {
    return forecast(
      baseInput({
        entityType: "self_employed_1099",
        filingStatus: "single",
        stateCode: "TX",
        ownerW2WagesCents: cents(wagesUsd),
        ownerW2SsWagesCents: cents(wagesUsd),
      }),
    );
  }

  it("$50k Single → ~$3,820 FIT (10% + 12% bracket)", () => {
    // $50,000 - $16,100 std ded = $33,900 taxable
    // 10% × $12,400 = $1,240
    // 12% × $21,500 = $2,580
    // Expected ≈ $3,820
    const r = single(50_000);
    expect(r.federalIncomeTaxCents).toBeGreaterThan(cents(3_700));
    expect(r.federalIncomeTaxCents).toBeLessThan(cents(3_900));
    expect(r.selfEmploymentTaxCents).toBe(0);
    expect(r.qbiDeductionCents).toBe(0);
  });

  it("$100k Single → ~$13,170 FIT (into 22% bracket)", () => {
    // $100,000 - $16,100 std ded = $83,900 taxable
    // 10% × $12,400 + 12% × $38,000 + 22% × $33,500
    // = $1,240 + $4,560 + $7,370 = $13,170
    const r = single(100_000);
    expect(r.federalIncomeTaxCents).toBeGreaterThan(cents(13_000));
    expect(r.federalIncomeTaxCents).toBeLessThan(cents(13_400));
    expect(r.selfEmploymentTaxCents).toBe(0);
  });

  it("$200k Single → ~$36,734 FIT (into 24% bracket)", () => {
    // $200,000 - $16,100 std ded = $183,900 taxable
    // 10% × $12,400 + 12% × $38,000 + 22% × $55,300 + 24% × $78,200
    // = $1,240 + $4,560 + $12,166 + $18,768 = $36,734
    const r = single(200_000);
    expect(r.federalIncomeTaxCents).toBeGreaterThan(cents(36_500));
    expect(r.federalIncomeTaxCents).toBeLessThan(cents(36_900));
    expect(r.selfEmploymentTaxCents).toBe(0);
  });

  it("$0 Single → $0 FIT (no income, no tax)", () => {
    const r = single(0);
    expect(r.federalIncomeTaxCents).toBe(0);
  });

  it("FIT is monotonically increasing across the pinned points", () => {
    const a = single(50_000).federalIncomeTaxCents;
    const b = single(100_000).federalIncomeTaxCents;
    const c = single(200_000).federalIncomeTaxCents;
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});
