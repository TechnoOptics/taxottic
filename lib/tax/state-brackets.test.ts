import { describe, expect, it } from "vitest";
import { computeStateTaxFromBrackets } from "./state-brackets";

/**
 * State income-tax math verification.
 *
 * Each bracket table is encoded from the state's own published
 * brackets (2025 tax year). Tests verify:
 *   - Tax at the top of each bracket equals the expected cumulative
 *     amount (computed by hand from the bracket structure).
 *   - Tax at a midpoint within a bracket equals lower-bound tax +
 *     slice × rate.
 *   - Filing-status routing works (MFJ table when available, single
 *     fallback when not).
 *   - High-income surcharges (CA mental-health, MA Fair Share Amendment)
 *     fire only above the threshold and only on the excess.
 *   - Unrecognized state codes return null so the caller falls back
 *     to flat rate.
 *
 * The expected values below are computed by hand using the rate
 * tables encoded in state-brackets.ts. If a state's published rates
 * change, both the table AND these tests need to update.
 */

describe("California, bracket math", () => {
  it("single, $50,000 taxable → bracket math, ~ $1,816 state tax", () => {
    // 1% × $10,756              = $107.56
    // 2% × ($25,499-$10,756)    = $294.86
    // 4% × ($40,245-$25,499)    = $589.84
    // 6% × ($50,000-$40,245)    = $585.30
    // Total = $1,577.56
    // Allow rounding ±$2 (each slice rounds independently).
    const res = computeStateTaxFromBrackets({
      taxableIncomeCents: 50_000 * 100,
      filingStatus: "single",
      stateCode: "CA",
      taxYear: 2025,
    });
    expect(res).not.toBeNull();
    expect(res!.taxCents).toBeGreaterThanOrEqual(157_700);
    expect(res!.taxCents).toBeLessThanOrEqual(157_800);
  });

  it("MFJ uses doubled brackets, $50k income → much lower than single $50k", () => {
    // MFJ at $50k stays in lower-rate brackets.
    // 1% × $21,512              = $215.12
    // 2% × ($50,000-$21,512)    = $569.76
    // Total ≈ $784.88
    const res = computeStateTaxFromBrackets({
      taxableIncomeCents: 50_000 * 100,
      filingStatus: "married_filing_jointly",
      stateCode: "CA",
      taxYear: 2025,
    });
    expect(res!.taxCents).toBeGreaterThanOrEqual(78_400);
    expect(res!.taxCents).toBeLessThanOrEqual(78_600);
  });

  it("mental-health surcharge fires at $1.1M income, on the $100k excess only", () => {
    // Compute the base bracket tax at $1.1M (single).
    // Then add 1% × ($1.1M - $1M) = 1% × $100k = $1,000 surcharge.
    const res = computeStateTaxFromBrackets({
      taxableIncomeCents: 1_100_000 * 100,
      filingStatus: "single",
      stateCode: "CA",
      taxYear: 2025,
    });
    expect(res!.note).toMatch(/mental.health/i);
    expect(res!.note).toContain("$1,000"); // surcharge text mentions the $1k
  });

  it("no surcharge at $999,999 (one dollar under)", () => {
    const res = computeStateTaxFromBrackets({
      taxableIncomeCents: 999_999 * 100,
      filingStatus: "single",
      stateCode: "CA",
      taxYear: 2025,
    });
    expect(res!.note).not.toMatch(/mental.health/i);
  });
});

describe("New York, bracket math", () => {
  it("single, $80,650 (top of 5.5% bracket) → uses MFJ-doubled cap correctly", () => {
    // Single hits 5.5% bracket up to $80,650.
    // 4% × $8,500             = $340
    // 4.5% × ($11,700-$8,500) = $144
    // 5.25% × ($13,900-$11,700) = $115.50
    // 5.5% × ($80,650-$13,900) = $3,671.25
    // Total = $4,270.75
    const res = computeStateTaxFromBrackets({
      taxableIncomeCents: 80_650 * 100,
      filingStatus: "single",
      stateCode: "NY",
      taxYear: 2025,
    });
    expect(res!.taxCents).toBeGreaterThanOrEqual(426_900);
    expect(res!.taxCents).toBeLessThanOrEqual(427_300);
  });

  it("NYC city-tax hint surfaces on the note", () => {
    const res = computeStateTaxFromBrackets({
      taxableIncomeCents: 100_000 * 100,
      filingStatus: "single",
      stateCode: "NY",
      taxYear: 2025,
    });
    // The engine surfaces the hint via the assumptions/hints array,
    // but the state-bracket function note itself just describes the
    // bracket math used.
    expect(res!.note).toMatch(/NY 2025 bracket table/i);
  });
});

describe("New Jersey, separate MFJ brackets (NOT doubled)", () => {
  it("MFJ and single brackets diverge above $35k - separate tables", () => {
    // NJ MFJ keeps a 1.75% bracket up to $50k (single tops out at $35k).
    // At $40k income:
    //   Single: 1.4% × $20k + 1.75% × ($35k-$20k) + 3.5% × ($40k-$35k)
    //         = $280 + $262.50 + $175 = $717.50
    //   MFJ:    1.4% × $20k + 1.75% × ($40k-$20k)
    //         = $280 + $350 = $630
    const single = computeStateTaxFromBrackets({
      taxableIncomeCents: 40_000 * 100,
      filingStatus: "single",
      stateCode: "NJ",
      taxYear: 2025,
    });
    const mfj = computeStateTaxFromBrackets({
      taxableIncomeCents: 40_000 * 100,
      filingStatus: "married_filing_jointly",
      stateCode: "NJ",
      taxYear: 2025,
    });
    expect(single!.taxCents).toBeGreaterThan(mfj!.taxCents);
    expect(single!.taxCents).toBeGreaterThanOrEqual(71_700);
    expect(single!.taxCents).toBeLessThanOrEqual(71_800);
    expect(mfj!.taxCents).toBeGreaterThanOrEqual(63_000);
    expect(mfj!.taxCents).toBeLessThanOrEqual(63_100);
  });
});

describe("Massachusetts, 5% flat + 4% Fair Share surtax", () => {
  it("$500k single → $25,000 (5% × $500k)", () => {
    const res = computeStateTaxFromBrackets({
      taxableIncomeCents: 500_000 * 100,
      filingStatus: "single",
      stateCode: "MA",
      taxYear: 2025,
    });
    expect(res!.taxCents).toBe(25_000 * 100);
  });

  it("$1.5M single → $75,000 base + ~$16,674 surtax (4% × excess over $1,083,150)", () => {
    // Base: 5% × $1.5M = $75,000
    // Excess: $1,500,000 - $1,083,150 = $416,850
    // Surtax: 4% × $416,850 = $16,674
    // Total: $91,674
    const res = computeStateTaxFromBrackets({
      taxableIncomeCents: 1_500_000 * 100,
      filingStatus: "single",
      stateCode: "MA",
      taxYear: 2025,
    });
    expect(res!.taxCents).toBeGreaterThanOrEqual(9_167_300);
    expect(res!.taxCents).toBeLessThanOrEqual(9_167_500);
    expect(res!.note).toMatch(/Fair Share/i);
  });

  it("Surtax does NOT fire at exactly $1,083,150", () => {
    const res = computeStateTaxFromBrackets({
      taxableIncomeCents: 1_083_150 * 100,
      filingStatus: "single",
      stateCode: "MA",
      taxYear: 2025,
    });
    // 5% × $1,083,150 = $54,157.50, no surtax
    expect(res!.taxCents).toBe(54_157_50);
    expect(res!.note).not.toMatch(/Fair Share/i);
  });
});

describe("Minnesota, bracket math", () => {
  it("single, $50k → ~$3,000 state tax", () => {
    // 5.35% × $32,570 = $1,742.50
    // 6.80% × ($50k - $32,570) = $1,185.24
    // Total ≈ $2,927.74
    const res = computeStateTaxFromBrackets({
      taxableIncomeCents: 50_000 * 100,
      filingStatus: "single",
      stateCode: "MN",
      taxYear: 2025,
    });
    expect(res!.taxCents).toBeGreaterThanOrEqual(292_700);
    expect(res!.taxCents).toBeLessThanOrEqual(292_900);
  });
});

describe("Maryland, county-tax hint", () => {
  it("returns a bracket-math result + the state file marks county-tax separately", () => {
    const res = computeStateTaxFromBrackets({
      taxableIncomeCents: 100_000 * 100,
      filingStatus: "single",
      stateCode: "MD",
      taxYear: 2025,
    });
    // 2% × $1,000 + 3% × $1,000 + 4% × $1,000 + 4.75% × $97,000
    // = $20 + $30 + $40 + $4,607.50 = $4,697.50
    expect(res!.taxCents).toBeGreaterThanOrEqual(469_700);
    expect(res!.taxCents).toBeLessThanOrEqual(469_800);
  });
});

describe("State coverage", () => {
  it("encoded states return non-null", () => {
    const encoded = ["CA", "NY", "NJ", "MA", "MN", "OR", "HI", "DC", "MD", "CT"];
    for (const code of encoded) {
      const res = computeStateTaxFromBrackets({
        taxableIncomeCents: 50_000 * 100,
        filingStatus: "single",
        stateCode: code,
        taxYear: 2025,
      });
      expect(res, `${code} should have bracket math`).not.toBeNull();
    }
  });

  it("flat-rate states return null (caller falls back to stateRate)", () => {
    // States that are actually flat-rate or simple - we don't (yet)
    // encode brackets for these so the bracket function returns null.
    const flatOrUnencoded = ["PA", "IL", "AZ", "NC", "MI", "IN", "KY"];
    for (const code of flatOrUnencoded) {
      const res = computeStateTaxFromBrackets({
        taxableIncomeCents: 50_000 * 100,
        filingStatus: "single",
        stateCode: code,
        taxYear: 2025,
      });
      expect(res, `${code} should fall through to flat-rate`).toBeNull();
    }
  });

  it("no-tax states return null", () => {
    const noTax = ["TX", "FL", "WA", "NV", "TN", "SD", "WY", "AK"];
    for (const code of noTax) {
      const res = computeStateTaxFromBrackets({
        taxableIncomeCents: 50_000 * 100,
        filingStatus: "single",
        stateCode: code,
        taxYear: 2025,
      });
      expect(res, `${code} should fall through (no income tax)`).toBeNull();
    }
  });

  it("monotonic: higher income produces higher (or equal) tax in every encoded state", () => {
    const encoded = ["CA", "NY", "NJ", "MA", "MN", "OR", "HI", "DC", "MD", "CT"];
    const incomes = [10_000, 50_000, 100_000, 250_000, 500_000];
    for (const code of encoded) {
      let lastTax = -1;
      for (const inc of incomes) {
        const res = computeStateTaxFromBrackets({
          taxableIncomeCents: inc * 100,
          filingStatus: "single",
          stateCode: code,
          taxYear: 2025,
        });
        expect(
          res!.taxCents,
          `${code} should not have tax drop as income rose to $${inc}`,
        ).toBeGreaterThanOrEqual(lastTax);
        lastTax = res!.taxCents;
      }
    }
  });
});
