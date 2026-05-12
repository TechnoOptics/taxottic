import { describe, expect, it } from "vitest";
import { computeEducationCreditCents } from "./education";

/**
 * Education-credit math verification.
 *
 * Sources for the expected values:
 *   - IRS Pub 970 (Tax Benefits for Education) — worked examples
 *   - IRC § 25A
 *   - Form 8863 instructions
 *
 * AOTC formula (Pub 970, Ch 2):
 *   credit = 100% of first $2,000 + 25% of next $2,000
 *   max    = $2,500 per student
 *   refundable portion = 40% × credit (max $1,000)
 *   MAGI phase-out: $80k-$90k single, $160k-$180k MFJ
 *
 * LLC formula (Pub 970, Ch 3):
 *   credit = 20% × min(expenses, $10,000)
 *   max    = $2,000 per return
 *   non-refundable
 *   Same MAGI phase-out as AOTC
 *
 * Phase-out (both credits): linear from full credit at the threshold
 * to zero at threshold+range. Range is $10k for single/HoH/MFS,
 * $20k for MFJ.
 */

describe("AOTC — maximum credit math", () => {
  it("$4,000 of expenses → $2,500 credit (full max)", () => {
    // 100% of first $2,000 = $2,000
    // 25% of next $2,000 = $500
    // Total = $2,500
    const res = computeEducationCreditCents({
      qualifiedExpensesCents: 4_000 * 100,
      modifiedAgiCents: 50_000 * 100,
      filingStatus: "single",
      claimAotc: true,
    });
    expect(res.refundableCents + res.nonRefundableCents).toBe(2_500 * 100);
    expect(res.refundableCents).toBe(1_000 * 100); // 40% × $2,500
    expect(res.nonRefundableCents).toBe(1_500 * 100); // 60% × $2,500
    expect(res.kind).toBe("aotc");
  });

  it("$1,500 of expenses → 100% × $1,500 = $1,500 credit", () => {
    const res = computeEducationCreditCents({
      qualifiedExpensesCents: 1_500 * 100,
      modifiedAgiCents: 50_000 * 100,
      filingStatus: "single",
      claimAotc: true,
    });
    expect(res.refundableCents + res.nonRefundableCents).toBe(1_500 * 100);
    expect(res.refundableCents).toBe(600 * 100); // 40% × $1,500
    expect(res.nonRefundableCents).toBe(900 * 100);
  });

  it("$3,000 expenses → $2,000 + 25%×$1,000 = $2,250", () => {
    const res = computeEducationCreditCents({
      qualifiedExpensesCents: 3_000 * 100,
      modifiedAgiCents: 50_000 * 100,
      filingStatus: "single",
      claimAotc: true,
    });
    expect(res.refundableCents + res.nonRefundableCents).toBe(2_250 * 100);
  });

  it("$10,000 expenses → still capped at $2,500 (per-student limit)", () => {
    const res = computeEducationCreditCents({
      qualifiedExpensesCents: 10_000 * 100,
      modifiedAgiCents: 50_000 * 100,
      filingStatus: "single",
      claimAotc: true,
    });
    expect(res.refundableCents + res.nonRefundableCents).toBe(2_500 * 100);
  });
});

describe("AOTC — phase-out", () => {
  it("single, MAGI = $80,000 (at threshold) → full credit", () => {
    const res = computeEducationCreditCents({
      qualifiedExpensesCents: 4_000 * 100,
      modifiedAgiCents: 80_000 * 100,
      filingStatus: "single",
      claimAotc: true,
    });
    expect(res.refundableCents + res.nonRefundableCents).toBe(2_500 * 100);
  });

  it("single, MAGI = $85,000 (midway through phase-out) → half credit", () => {
    // phase frac = 1 - (85k - 80k) / 10k = 0.5
    // 0.5 × $2,500 = $1,250
    const res = computeEducationCreditCents({
      qualifiedExpensesCents: 4_000 * 100,
      modifiedAgiCents: 85_000 * 100,
      filingStatus: "single",
      claimAotc: true,
    });
    expect(res.refundableCents + res.nonRefundableCents).toBe(1_250 * 100);
  });

  it("single, MAGI = $90,000 (at completed phase-out) → $0", () => {
    const res = computeEducationCreditCents({
      qualifiedExpensesCents: 4_000 * 100,
      modifiedAgiCents: 90_000 * 100,
      filingStatus: "single",
      claimAotc: true,
    });
    expect(res.refundableCents).toBe(0);
    expect(res.nonRefundableCents).toBe(0);
    expect(res.kind).toBe("none");
  });

  it("MFJ, MAGI = $170,000 (midway) → half credit", () => {
    // MFJ phase-out: $160k → $180k. At $170k, phase frac = 0.5.
    const res = computeEducationCreditCents({
      qualifiedExpensesCents: 4_000 * 100,
      modifiedAgiCents: 170_000 * 100,
      filingStatus: "married_filing_jointly",
      claimAotc: true,
    });
    expect(res.refundableCents + res.nonRefundableCents).toBe(1_250 * 100);
  });

  it("MFJ, MAGI = $180,000 (completed) → $0", () => {
    const res = computeEducationCreditCents({
      qualifiedExpensesCents: 4_000 * 100,
      modifiedAgiCents: 180_000 * 100,
      filingStatus: "married_filing_jointly",
      claimAotc: true,
    });
    expect(res.refundableCents).toBe(0);
    expect(res.nonRefundableCents).toBe(0);
  });
});

describe("Lifetime Learning Credit", () => {
  it("$10,000 expenses → 20% × $10,000 = $2,000 max", () => {
    const res = computeEducationCreditCents({
      qualifiedExpensesCents: 10_000 * 100,
      modifiedAgiCents: 50_000 * 100,
      filingStatus: "single",
      claimAotc: false,
    });
    expect(res.refundableCents).toBe(0); // non-refundable
    expect(res.nonRefundableCents).toBe(2_000 * 100);
    expect(res.kind).toBe("llc");
  });

  it("$5,000 expenses → 20% × $5,000 = $1,000", () => {
    const res = computeEducationCreditCents({
      qualifiedExpensesCents: 5_000 * 100,
      modifiedAgiCents: 50_000 * 100,
      filingStatus: "single",
      claimAotc: false,
    });
    expect(res.nonRefundableCents).toBe(1_000 * 100);
  });

  it("$15,000 expenses → capped at $10k base → 20% × $10,000 = $2,000", () => {
    const res = computeEducationCreditCents({
      qualifiedExpensesCents: 15_000 * 100,
      modifiedAgiCents: 50_000 * 100,
      filingStatus: "single",
      claimAotc: false,
    });
    expect(res.nonRefundableCents).toBe(2_000 * 100);
  });

  it("LLC phase-out at $85k single → half credit", () => {
    const res = computeEducationCreditCents({
      qualifiedExpensesCents: 10_000 * 100,
      modifiedAgiCents: 85_000 * 100,
      filingStatus: "single",
      claimAotc: false,
    });
    expect(res.nonRefundableCents).toBe(1_000 * 100); // 0.5 × $2,000
  });
});

describe("Education credits — disqualifiers", () => {
  it("MFS → no credit regardless of AOTC/LLC choice", () => {
    const aotc = computeEducationCreditCents({
      qualifiedExpensesCents: 4_000 * 100,
      modifiedAgiCents: 40_000 * 100,
      filingStatus: "married_filing_separately",
      claimAotc: true,
    });
    expect(aotc.refundableCents + aotc.nonRefundableCents).toBe(0);
    expect(aotc.reasonZero).toMatch(/married-filing-separately/i);

    const llc = computeEducationCreditCents({
      qualifiedExpensesCents: 10_000 * 100,
      modifiedAgiCents: 40_000 * 100,
      filingStatus: "married_filing_separately",
      claimAotc: false,
    });
    expect(llc.nonRefundableCents).toBe(0);
    expect(llc.reasonZero).toMatch(/married-filing-separately/i);
  });

  it("zero expenses → zero credit, no nag", () => {
    const res = computeEducationCreditCents({
      qualifiedExpensesCents: 0,
      modifiedAgiCents: 50_000 * 100,
      filingStatus: "single",
      claimAotc: true,
    });
    expect(res.refundableCents + res.nonRefundableCents).toBe(0);
    expect(res.kind).toBe("none");
    expect(res.reasonZero).toBeNull();
  });

  it("AOTC over completed phase-out → reason includes the MAGI explanation", () => {
    const res = computeEducationCreditCents({
      qualifiedExpensesCents: 4_000 * 100,
      modifiedAgiCents: 95_000 * 100,
      filingStatus: "single",
      claimAotc: true,
    });
    expect(res.refundableCents + res.nonRefundableCents).toBe(0);
    expect(res.reasonZero).toMatch(/phases out/i);
    expect(res.reasonZero).toMatch(/90,000/);
  });
});

describe("Education credits — split behavior", () => {
  it("AOTC always splits refundable + non-refundable correctly", () => {
    const cases = [
      { expenses: 1_000, expected: { ref: 400, nonref: 600 } }, // $1,000 credit
      { expenses: 2_000, expected: { ref: 800, nonref: 1_200 } }, // $2,000 credit
      { expenses: 3_000, expected: { ref: 900, nonref: 1_350 } }, // $2,250 credit
      { expenses: 4_000, expected: { ref: 1_000, nonref: 1_500 } }, // $2,500 credit
    ];
    for (const c of cases) {
      const res = computeEducationCreditCents({
        qualifiedExpensesCents: c.expenses * 100,
        modifiedAgiCents: 50_000 * 100,
        filingStatus: "single",
        claimAotc: true,
      });
      expect(res.refundableCents).toBe(c.expected.ref * 100);
      expect(res.nonRefundableCents).toBe(c.expected.nonref * 100);
    }
  });
});
