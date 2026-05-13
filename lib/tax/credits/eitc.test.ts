import { describe, expect, it } from "vitest";
import { computeEitcCents } from "./eitc";

/**
 * EITC math verification.
 *
 * Sources for the expected values:
 *   - IRS Rev. Proc. 2025-32 § 4.06 (2026 EITC parameters)
 *   - IRS Pub 596 (worked examples — typically the 2024 edition for
 *     2025 tax year; for 2026 we cross-check against the phase-in /
 *     plateau / phase-out formula directly)
 *   - The phase-in math: credit_at_plateau = max_credit
 *                        phase_in_value    = min(EI, EI_amount) × (max / EI_amount)
 *                        phase_out_amount  = max(0, max(EI, AGI) - threshold)
 *                                              × (max / (completed - threshold))
 *                        credit            = max(0, phase_in_value - phase_out_amount)
 *
 * Test strategy:
 *   1. Verify max credit hits at the plateau for each (kids, status).
 *   2. Verify phase-in produces the correct linear-rate credit before
 *      the plateau.
 *   3. Verify phase-out reaches exactly zero at the completed threshold.
 *   4. Verify edge cases: investment-income disqualifier, MFS exclusion,
 *      zero earned income, all-zero inputs.
 */

const ZERO_EI = {
  agiCents: 0,
  investmentIncomeCents: 0,
  qualifyingChildren: 0,
  filingStatus: "single" as const,
  taxYear: 2026,
  earnedIncomeCents: 0,
};

describe("EITC — 2026 maximum credit (plateau)", () => {
  it("single, 0 kids, earned income at the plateau → $664 max credit", () => {
    const res = computeEitcCents({
      earnedIncomeCents: 8_680 * 100,
      agiCents: 8_680 * 100,
      investmentIncomeCents: 0,
      qualifyingChildren: 0,
      filingStatus: "single",
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(664 * 100);
    expect(res.reasonZero).toBeNull();
  });

  it("single, 1 child, at the plateau → $4,427 max credit", () => {
    const res = computeEitcCents({
      earnedIncomeCents: 13_020 * 100,
      agiCents: 13_020 * 100,
      investmentIncomeCents: 0,
      qualifyingChildren: 1,
      filingStatus: "single",
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(4_427 * 100);
  });

  it("MFJ, 2 kids, plateau → $7,316", () => {
    const res = computeEitcCents({
      earnedIncomeCents: 18_290 * 100,
      agiCents: 18_290 * 100,
      investmentIncomeCents: 0,
      qualifyingChildren: 2,
      filingStatus: "married_filing_jointly",
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(7_316 * 100);
  });

  it("HoH, 3 kids, plateau → $8,231 (max credit overall)", () => {
    const res = computeEitcCents({
      earnedIncomeCents: 18_290 * 100,
      agiCents: 18_290 * 100,
      investmentIncomeCents: 0,
      qualifyingChildren: 3,
      filingStatus: "head_of_household",
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(8_231 * 100);
  });

  it("HoH, 4 kids → treated same as 3 (max bucket caps at 3+)", () => {
    const res = computeEitcCents({
      earnedIncomeCents: 18_290 * 100,
      agiCents: 18_290 * 100,
      investmentIncomeCents: 0,
      qualifyingChildren: 4,
      filingStatus: "head_of_household",
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(8_231 * 100);
  });
});

describe("EITC — 2026 phase-in (linear ramp)", () => {
  it("single, 1 kid, EI = half of phase-in amount → half of max credit", () => {
    // phase-in for 1 kid: max_credit / earned_income_amount = 4427 / 13020 = 34%
    // At earned income = $6,510 (half of $13,020), credit should be
    // 6510 × 0.34 ≈ 2213.40
    const res = computeEitcCents({
      earnedIncomeCents: 6_510 * 100,
      agiCents: 6_510 * 100,
      investmentIncomeCents: 0,
      qualifyingChildren: 1,
      filingStatus: "single",
      taxYear: 2026,
    });
    // 6,510 × (4427 / 13020) = 6510 × 0.340015... = ~$2,213.50
    // Allow ±$1 for rounding.
    expect(res.creditCents).toBeGreaterThanOrEqual(2_212 * 100);
    expect(res.creditCents).toBeLessThanOrEqual(2_215 * 100);
  });

  it("single, 0 kids, EI = $4,340 (half phase-in) → ~$332", () => {
    // phase-in rate for 0 kids: 664 / 8680 = 7.65%
    // 4,340 × 0.0765 = $332.01
    const res = computeEitcCents({
      earnedIncomeCents: 4_340 * 100,
      agiCents: 4_340 * 100,
      investmentIncomeCents: 0,
      qualifyingChildren: 0,
      filingStatus: "single",
      taxYear: 2026,
    });
    expect(res.creditCents).toBeGreaterThanOrEqual(331 * 100);
    expect(res.creditCents).toBeLessThanOrEqual(333 * 100);
  });
});

describe("EITC — 2026 phase-out", () => {
  it("single, 1 kid, AGI exactly at threshold → max credit (no phase-out yet)", () => {
    // Threshold phaseout for 1 kid (single) is $23,890.
    // At earned income $13,020 plateau but AGI right at threshold,
    // phase-out hasn't started → credit should still be max.
    const res = computeEitcCents({
      earnedIncomeCents: 23_890 * 100, // at threshold
      agiCents: 23_890 * 100,
      investmentIncomeCents: 0,
      qualifyingChildren: 1,
      filingStatus: "single",
      taxYear: 2026,
    });
    // Earned income at $23,890 (above $13,020 plateau cap), AGI also
    // at threshold → phase_out_basis = max(EI, AGI) - threshold = 0
    // → no phase-out → full max credit.
    expect(res.creditCents).toBe(4_427 * 100);
  });

  it("single, 1 kid, AGI at completed phase-out → $0 credit", () => {
    const res = computeEitcCents({
      earnedIncomeCents: 51_593 * 100,
      agiCents: 51_593 * 100,
      investmentIncomeCents: 0,
      qualifyingChildren: 1,
      filingStatus: "single",
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(0);
    expect(res.reasonZero).toMatch(/completed.phaseout/i);
  });

  it("MFJ, 2 kids, AGI midway through phase-out → ~half max credit", () => {
    // MFJ 2-kid threshold = $31,160, completed = $65,899
    // Midpoint = $48,529.50. At that AGI, credit should be ~half max.
    const res = computeEitcCents({
      earnedIncomeCents: 48_530 * 100,
      agiCents: 48_530 * 100,
      investmentIncomeCents: 0,
      qualifyingChildren: 2,
      filingStatus: "married_filing_jointly",
      taxYear: 2026,
    });
    // Expected: 7316 - (48530 - 31160) × (7316 / (65899 - 31160))
    //         = 7316 - 17370 × 0.21066
    //         = 7316 - 3659 = 3657
    // Allow ±$2 for rounding.
    expect(res.creditCents).toBeGreaterThanOrEqual(3_655 * 100);
    expect(res.creditCents).toBeLessThanOrEqual(3_659 * 100);
  });
});

describe("EITC — disqualifiers", () => {
  it("zero earned income → no credit", () => {
    const res = computeEitcCents({
      ...ZERO_EI,
      qualifyingChildren: 2,
    });
    expect(res.creditCents).toBe(0);
    expect(res.reasonZero).toMatch(/earned income/i);
  });

  it("investment income > $12,200 → no credit (§ 32(i))", () => {
    const res = computeEitcCents({
      earnedIncomeCents: 25_000 * 100,
      agiCents: 25_000 * 100,
      investmentIncomeCents: 12_201 * 100, // $1 over
      qualifyingChildren: 1,
      filingStatus: "single",
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(0);
    expect(res.reasonZero).toMatch(/investment income/i);
  });

  it("investment income exactly at $12,200 → credit allowed (>= compares STRICTLY)", () => {
    const res = computeEitcCents({
      earnedIncomeCents: 13_020 * 100,
      agiCents: 13_020 * 100,
      investmentIncomeCents: 12_200 * 100,
      qualifyingChildren: 1,
      filingStatus: "single",
      taxYear: 2026,
    });
    // Investment income equal to threshold is OK; only > triggers
    // disqualification per § 32(i).
    expect(res.creditCents).toBe(4_427 * 100);
  });

  it("MFS → no credit (without § 32(d) exception)", () => {
    const res = computeEitcCents({
      earnedIncomeCents: 25_000 * 100,
      agiCents: 25_000 * 100,
      investmentIncomeCents: 0,
      qualifyingChildren: 1,
      filingStatus: "married_filing_separately",
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(0);
    expect(res.reasonZero).toMatch(/separated-spouse/i);
  });
});

describe("EITC — 2025 figures (back-year coverage)", () => {
  // The 2025 max for 3+ kids per Rev. Proc. 2024-40 § 4.06 is $8,046,
  // which is what the engine should return for a 2025 forecast.
  it("HoH, 3 kids, 2025 plateau → $8,046 (not the 2026 $8,231)", () => {
    const res = computeEitcCents({
      earnedIncomeCents: 17_880 * 100,
      agiCents: 17_880 * 100,
      investmentIncomeCents: 0,
      qualifyingChildren: 3,
      filingStatus: "head_of_household",
      taxYear: 2025,
    });
    expect(res.creditCents).toBe(8_046 * 100);
  });

  it("2025 investment-income disqualifier is $11,950 (not 2026's $12,200)", () => {
    const res = computeEitcCents({
      earnedIncomeCents: 25_000 * 100,
      agiCents: 25_000 * 100,
      investmentIncomeCents: 12_000 * 100,
      qualifyingChildren: 1,
      filingStatus: "single",
      taxYear: 2025,
    });
    // $12,000 > $11,950 (2025) → disqualified
    expect(res.creditCents).toBe(0);
  });
});
