import { describe, expect, it } from "vitest";
import { computeSaversCreditCents } from "./savers";

/**
 * Saver's Credit math verification.
 *
 * Sources for the expected values:
 *   - IRS Form 8880 instructions (the official worked examples)
 *   - IR-2024-285 (the COLA-driven AGI brackets for 2025)
 *   - Statutory rule: credit = bracket% × min(contribution, $2,000
 *     single / $4,000 MFJ)
 *
 * Bracket structure (2026, this commit's preliminary figures pending
 * IRS confirmation in early November):
 *   Single/MFS: 50% ≤ $24,000; 20% ≤ $26,000; 10% ≤ $40,000
 *   HoH:        50% ≤ $36,000; 20% ≤ $39,000; 10% ≤ $60,000
 *   MFJ:        50% ≤ $48,000; 20% ≤ $52,000; 10% ≤ $80,000
 */

describe("Saver's Credit, 2026 brackets", () => {
  it("single, $20k AGI, $2k contribution → 50% × $2,000 = $1,000 max", () => {
    const res = computeSaversCreditCents({
      retirementContributionsCents: 2_000 * 100,
      agiCents: 20_000 * 100,
      filingStatus: "single",
      age: 35,
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(1_000 * 100);
    expect(res.rate).toBe(0.5);
  });

  it("MFJ, $40k AGI, $4k contribution → 50% × $4,000 = $2,000 (max for any return)", () => {
    const res = computeSaversCreditCents({
      retirementContributionsCents: 4_000 * 100,
      agiCents: 40_000 * 100,
      filingStatus: "married_filing_jointly",
      age: 40,
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(2_000 * 100);
    expect(res.rate).toBe(0.5);
  });

  it("MFJ, $50k AGI, $4k contribution → 20% × $4,000 = $800", () => {
    const res = computeSaversCreditCents({
      retirementContributionsCents: 4_000 * 100,
      agiCents: 50_000 * 100,
      filingStatus: "married_filing_jointly",
      age: 40,
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(800 * 100);
    expect(res.rate).toBe(0.2);
  });

  it("single, $35k AGI, $2k contribution → 10% × $2,000 = $200", () => {
    const res = computeSaversCreditCents({
      retirementContributionsCents: 2_000 * 100,
      agiCents: 35_000 * 100,
      filingStatus: "single",
      age: 40,
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(200 * 100);
    expect(res.rate).toBe(0.1);
  });

  it("single, $40,001 AGI → fully phased out", () => {
    const res = computeSaversCreditCents({
      retirementContributionsCents: 2_000 * 100,
      agiCents: 40_001 * 100,
      filingStatus: "single",
      age: 40,
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(0);
    expect(res.rate).toBe(0);
    expect(res.reasonZero).toMatch(/phases out/i);
  });

  it("HoH at $36k AGI → 50% bracket (right at boundary, ≤ is inclusive)", () => {
    const res = computeSaversCreditCents({
      retirementContributionsCents: 2_000 * 100,
      agiCents: 36_000 * 100,
      filingStatus: "head_of_household",
      age: 40,
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(1_000 * 100);
    expect(res.rate).toBe(0.5);
  });

  it("contribution exceeds $2,000 cap (single) → capped at $2,000", () => {
    // User contributed $7,500 but the credit base is capped at $2,000.
    const res = computeSaversCreditCents({
      retirementContributionsCents: 7_500 * 100,
      agiCents: 20_000 * 100,
      filingStatus: "single",
      age: 35,
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(1_000 * 100); // 50% × $2,000 cap
  });
});

describe("Saver's Credit, disqualifiers", () => {
  it("zero contribution → zero credit (silent, no warning)", () => {
    const res = computeSaversCreditCents({
      retirementContributionsCents: 0,
      agiCents: 20_000 * 100,
      filingStatus: "single",
      age: 35,
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(0);
    // No reasonZero - there's nothing to nag about.
    expect(res.reasonZero).toBeNull();
  });

  it("age 17 → no credit (under 18)", () => {
    const res = computeSaversCreditCents({
      retirementContributionsCents: 2_000 * 100,
      agiCents: 15_000 * 100,
      filingStatus: "single",
      age: 17,
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(0);
    expect(res.reasonZero).toMatch(/18 or older/i);
  });

  it("null age → treated as 18+ (we assume adult)", () => {
    const res = computeSaversCreditCents({
      retirementContributionsCents: 2_000 * 100,
      agiCents: 20_000 * 100,
      filingStatus: "single",
      age: null,
      taxYear: 2026,
    });
    expect(res.creditCents).toBe(1_000 * 100);
  });
});

describe("Saver's Credit, 2025 brackets (back-year coverage)", () => {
  it("MFJ, $46k AGI, $4k → 2025 figure: 50% × $4k = $2,000", () => {
    // 2025 MFJ 50% bracket caps at $46,000 (lower than 2026's $48,000).
    const res = computeSaversCreditCents({
      retirementContributionsCents: 4_000 * 100,
      agiCents: 46_000 * 100,
      filingStatus: "married_filing_jointly",
      age: 40,
      taxYear: 2025,
    });
    expect(res.creditCents).toBe(2_000 * 100);
    expect(res.rate).toBe(0.5);
  });

  it("MFJ, $47k AGI, 2025 → 20% bracket (above 2025's $46k 50% line)", () => {
    const res = computeSaversCreditCents({
      retirementContributionsCents: 4_000 * 100,
      agiCents: 47_000 * 100,
      filingStatus: "married_filing_jointly",
      age: 40,
      taxYear: 2025,
    });
    expect(res.rate).toBe(0.2);
  });
});
