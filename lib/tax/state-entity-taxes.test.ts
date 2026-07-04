import { describe, it, expect } from "vitest";
import {
  computeStateEntityTax,
  stateRecognizesFederalQBI,
  statePtetAvailable,
  C_CORP_STATE_RATE,
} from "./state-entity-taxes";

// Tests cover every entity type × representative state combo:
//
//   - C-Corp in CA / NY / TX / WA (income-tax vs gross-receipts states)
//   - S-Corp in CA / NY / TX (entity-level tax + franchise + margin)
//   - LLC in CA (the canonical tiered-fee state) / DE / FL (no fee)
//   - Sole prop in CA / TX (no entity tax owed)
//   - Gross-receipts thresholds (above + below)
//   - First-year exemption (CA)
//   - PTET availability
//   - QBI conformity (CO/ND vs everyone else)

describe("computeStateEntityTax, C-Corp", () => {
  it("CA C-Corp: 8.84% on net income", () => {
    const r = computeStateEntityTax({
      stateCode: "CA",
      entityType: "c_corp",
      netBusinessIncomeCents: 10_000_000, // $100k
      grossReceiptsCents: 50_000_000,
    });
    expect(r.breakdown.cCorpIncomeTaxCents).toBe(884_000); // $8,840
    expect(r.totalEntityTaxCents).toBe(884_000);
  });

  it("NY C-Corp: 7.25% on net income", () => {
    const r = computeStateEntityTax({
      stateCode: "NY",
      entityType: "c_corp",
      netBusinessIncomeCents: 10_000_000,
      grossReceiptsCents: 0,
    });
    expect(r.breakdown.cCorpIncomeTaxCents).toBe(725_000); // $7,250
  });

  it("TX C-Corp: no income tax but margin tax applies above $1.23M receipts", () => {
    const r = computeStateEntityTax({
      stateCode: "TX",
      entityType: "c_corp",
      netBusinessIncomeCents: 50_000_000,
      grossReceiptsCents: 2_000_000_00, // $2M
    });
    expect(r.breakdown.cCorpIncomeTaxCents).toBe(0);
    // $2M - $1.23M = $770K × 0.375% = $2,887.50
    expect(r.breakdown.grossReceiptsTaxCents).toBeGreaterThan(0);
    expect(r.hasGrossReceiptsTax).toBe(true);
  });

  it("WA C-Corp: no income tax, B&O on gross receipts above threshold", () => {
    const r = computeStateEntityTax({
      stateCode: "WA",
      entityType: "c_corp",
      netBusinessIncomeCents: 50_000_000,
      grossReceiptsCents: 500_000_00, // $500k
    });
    expect(r.breakdown.cCorpIncomeTaxCents).toBe(0);
    expect(r.hasGrossReceiptsTax).toBe(true);
  });

  it("FL C-Corp: 5.5% on net income, no gross-receipts tax", () => {
    const r = computeStateEntityTax({
      stateCode: "FL",
      entityType: "c_corp",
      netBusinessIncomeCents: 10_000_000,
      grossReceiptsCents: 50_000_000,
    });
    expect(r.breakdown.cCorpIncomeTaxCents).toBe(550_000); // $5,500
    expect(r.hasGrossReceiptsTax).toBe(false);
  });
});

describe("computeStateEntityTax, S-Corp", () => {
  it("CA S-Corp: 1.5% on net income + $800 min franchise", () => {
    const r = computeStateEntityTax({
      stateCode: "CA",
      entityType: "s_corp",
      netBusinessIncomeCents: 10_000_000, // $100k
      grossReceiptsCents: 0,
    });
    expect(r.breakdown.sCorpEntityTaxCents).toBe(150_000); // 1.5% × $100k = $1,500
    expect(r.breakdown.minimumFranchiseCents).toBe(80_000); // $800
    expect(r.totalEntityTaxCents).toBe(230_000); // $2,300 total
  });

  it("CA S-Corp first year: no $800 minimum", () => {
    const r = computeStateEntityTax({
      stateCode: "CA",
      entityType: "s_corp",
      netBusinessIncomeCents: 10_000_000,
      grossReceiptsCents: 0,
      isFirstYear: true,
    });
    expect(r.breakdown.minimumFranchiseCents).toBe(0);
    expect(r.breakdown.sCorpEntityTaxCents).toBe(150_000);
    expect(r.totalEntityTaxCents).toBe(150_000);
  });

  it("NY S-Corp: $25 fixed-dollar minimum tax", () => {
    const r = computeStateEntityTax({
      stateCode: "NY",
      entityType: "s_corp",
      netBusinessIncomeCents: 10_000_000,
      grossReceiptsCents: 0,
    });
    expect(r.breakdown.minimumFranchiseCents).toBe(2_500); // $25
  });

  it("IL S-Corp: 1.5% replacement tax on net income", () => {
    const r = computeStateEntityTax({
      stateCode: "IL",
      entityType: "s_corp",
      netBusinessIncomeCents: 10_000_000,
      grossReceiptsCents: 0,
    });
    expect(r.breakdown.sCorpEntityTaxCents).toBe(150_000); // $1,500
  });

  it("non-listed state S-Corp: no entity-level tax", () => {
    const r = computeStateEntityTax({
      stateCode: "FL",
      entityType: "s_corp",
      netBusinessIncomeCents: 10_000_000,
      grossReceiptsCents: 0,
    });
    expect(r.totalEntityTaxCents).toBe(0);
  });
});

describe("computeStateEntityTax, LLC", () => {
  it("CA LLC: $800 minimum + $900 tier at $300k receipts", () => {
    const r = computeStateEntityTax({
      stateCode: "CA",
      entityType: "multi_llc",
      netBusinessIncomeCents: 0,
      grossReceiptsCents: 300_000_00, // $300k, in the $250K-$499K tier
    });
    // $800 minimum + $900 tier fee = $1,700
    expect(r.breakdown.llcFeeCents).toBe(170_000);
  });

  it("CA LLC: $6,000 tier at $2M receipts ($1M-$4.99M tier)", () => {
    const r = computeStateEntityTax({
      stateCode: "CA",
      entityType: "multi_llc",
      netBusinessIncomeCents: 0,
      grossReceiptsCents: 2_000_000_00, // $2M
    });
    // $800 minimum + $6,000 tier = $6,800
    expect(r.breakdown.llcFeeCents).toBe(680_000);
  });

  it("CA LLC: $11,790 top-tier at $10M receipts", () => {
    const r = computeStateEntityTax({
      stateCode: "CA",
      entityType: "multi_llc",
      netBusinessIncomeCents: 0,
      grossReceiptsCents: 10_000_000_00, // $10M
    });
    // $800 minimum + $11,790 top tier = $12,590
    expect(r.breakdown.llcFeeCents).toBe(1_259_000);
  });

  it("CA LLC: $800 only when receipts below $250k", () => {
    const r = computeStateEntityTax({
      stateCode: "CA",
      entityType: "single_llc",
      netBusinessIncomeCents: 0,
      grossReceiptsCents: 20_000_00, // $20k
    });
    expect(r.breakdown.llcFeeCents).toBe(80_000); // $800 only
  });

  it("CA LLC first year: zero minimum, but tier fee still applies", () => {
    const r = computeStateEntityTax({
      stateCode: "CA",
      entityType: "multi_llc",
      netBusinessIncomeCents: 0,
      grossReceiptsCents: 2_000_000_00, // $2M
      isFirstYear: true,
    });
    // $800 minimum waived; $6,000 tier fee remains.
    expect(r.breakdown.llcFeeCents).toBe(600_000);
  });

  it("DE LLC: $300 flat", () => {
    const r = computeStateEntityTax({
      stateCode: "DE",
      entityType: "single_llc",
      netBusinessIncomeCents: 0,
      grossReceiptsCents: 0,
    });
    expect(r.breakdown.llcFeeCents).toBe(30_000); // $300
  });

  it("FL LLC: no LLC fee", () => {
    const r = computeStateEntityTax({
      stateCode: "FL",
      entityType: "multi_llc",
      netBusinessIncomeCents: 0,
      grossReceiptsCents: 0,
    });
    expect(r.totalEntityTaxCents).toBe(0);
  });
});

describe("computeStateEntityTax, Sole prop / partnership", () => {
  it("CA sole prop: no entity-level state tax", () => {
    const r = computeStateEntityTax({
      stateCode: "CA",
      entityType: "sole_prop",
      netBusinessIncomeCents: 10_000_000,
      grossReceiptsCents: 50_000_000,
    });
    expect(r.totalEntityTaxCents).toBe(0);
  });

  it("TX sole prop: subject to margin tax above threshold", () => {
    const r = computeStateEntityTax({
      stateCode: "TX",
      entityType: "sole_prop",
      netBusinessIncomeCents: 0,
      grossReceiptsCents: 2_000_000_00, // $2M
    });
    expect(r.hasGrossReceiptsTax).toBe(true);
  });
});

describe("Gross-receipts thresholds", () => {
  it("TX below $1.23M: no margin tax", () => {
    const r = computeStateEntityTax({
      stateCode: "TX",
      entityType: "c_corp",
      netBusinessIncomeCents: 50_000_000,
      grossReceiptsCents: 1_000_000_00, // $1M < $1.23M threshold
    });
    expect(r.breakdown.grossReceiptsTaxCents).toBe(0);
    expect(r.hasGrossReceiptsTax).toBe(false);
  });

  it("OH below $3M: no CAT", () => {
    const r = computeStateEntityTax({
      stateCode: "OH",
      entityType: "c_corp",
      netBusinessIncomeCents: 50_000_000,
      grossReceiptsCents: 2_500_000_00, // $2.5M
    });
    expect(r.hasGrossReceiptsTax).toBe(false);
  });

  it("OH above $3M: CAT applies", () => {
    const r = computeStateEntityTax({
      stateCode: "OH",
      entityType: "c_corp",
      netBusinessIncomeCents: 0,
      grossReceiptsCents: 5_000_000_00, // $5M
    });
    expect(r.hasGrossReceiptsTax).toBe(true);
    // ($5M - $3M) × 0.26% = $5,200
    expect(r.breakdown.grossReceiptsTaxCents).toBe(520_000);
  });

  it("OR above $1M: CAT applies", () => {
    const r = computeStateEntityTax({
      stateCode: "OR",
      entityType: "multi_llc",
      netBusinessIncomeCents: 0,
      grossReceiptsCents: 5_000_000_00,
    });
    expect(r.hasGrossReceiptsTax).toBe(true);
  });
});

describe("stateRecognizesFederalQBI", () => {
  it("CO conforms", () => {
    expect(stateRecognizesFederalQBI("CO")).toBe(true);
  });

  it("ND conforms", () => {
    expect(stateRecognizesFederalQBI("ND")).toBe(true);
  });

  it("CA does NOT conform", () => {
    expect(stateRecognizesFederalQBI("CA")).toBe(false);
  });

  it("NY does NOT conform", () => {
    expect(stateRecognizesFederalQBI("NY")).toBe(false);
  });

  it("null/undefined returns false", () => {
    expect(stateRecognizesFederalQBI(null)).toBe(false);
    expect(stateRecognizesFederalQBI(undefined)).toBe(false);
  });
});

describe("statePtetAvailable", () => {
  it("CA has PTET", () => {
    expect(statePtetAvailable("CA")).toBe(true);
  });

  it("NY has PTET", () => {
    expect(statePtetAvailable("NY")).toBe(true);
  });

  it("FL no income tax = no PTET", () => {
    expect(statePtetAvailable("FL")).toBe(false);
  });

  it("WY no income tax = no PTET", () => {
    expect(statePtetAvailable("WY")).toBe(false);
  });
});

describe("C-Corp rate table coverage", () => {
  it("covers all 50 states + DC", () => {
    const expected = [
      "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
      "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
      "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
      "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
      "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    ];
    for (const s of expected) {
      expect(C_CORP_STATE_RATE[s], `Missing C-Corp rate for ${s}`).toBeDefined();
    }
  });

  it("no-income-tax states have rate 0", () => {
    for (const s of ["NV", "OH", "SD", "TX", "WA", "WY"]) {
      expect(C_CORP_STATE_RATE[s].rate).toBe(0);
    }
  });
});

describe("Notes + hints", () => {
  it("CA C-Corp surfaces a note about the rate", () => {
    const r = computeStateEntityTax({
      stateCode: "CA",
      entityType: "c_corp",
      netBusinessIncomeCents: 10_000_000,
      grossReceiptsCents: 0,
    });
    expect(r.notes.join(" ")).toMatch(/8\.84/);
  });

  it("PTET hint surfaces for pass-through in PTET state", () => {
    const r = computeStateEntityTax({
      stateCode: "CA",
      entityType: "s_corp",
      netBusinessIncomeCents: 50_000_000,
      grossReceiptsCents: 0,
    });
    expect(r.hints.join(" ")).toMatch(/PTET/);
  });

  it("PTET hint suppressed for C-Corp", () => {
    const r = computeStateEntityTax({
      stateCode: "CA",
      entityType: "c_corp",
      netBusinessIncomeCents: 50_000_000,
      grossReceiptsCents: 0,
    });
    expect(r.hints.join(" ")).not.toMatch(/PTET/);
  });

  it("QBI non-conformity hint surfaces for non-conforming state", () => {
    const r = computeStateEntityTax({
      stateCode: "CA",
      entityType: "sole_prop",
      netBusinessIncomeCents: 10_000_000,
      grossReceiptsCents: 0,
    });
    expect(r.hints.join(" ")).toMatch(/QBI/);
  });

  it("QBI hint suppressed in conforming state (CO)", () => {
    const r = computeStateEntityTax({
      stateCode: "CO",
      entityType: "sole_prop",
      netBusinessIncomeCents: 10_000_000,
      grossReceiptsCents: 0,
    });
    expect(r.hints.join(" ")).not.toMatch(/QBI/);
  });
});
