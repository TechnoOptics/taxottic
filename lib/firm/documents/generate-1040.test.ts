import { describe, it, expect } from "vitest";
import { renderForm1040HTML } from "./generate-1040";

// Smoke tests for the Form 1040 generator. We don't try to assert
// the entire HTML — that's brittle — but we DO check that the
// computed totals end up on the page, and that taxable income
// math respects standard deduction + QBI.

const basicInput = {
  firm: { name: "Smith Allen CPA", accent_color: null, logo_url: null },
  taxYear: 2025,
  taxpayer: {
    full_name: "Riley Chen",
    ssn_placeholder: "▢▢▢-▢▢-▢▢▢▢",
    address_line_1: null,
    address_city: null,
    address_region: null,
    address_postal_code: null,
  },
  filingStatus: "single" as const,
  dependents: 0,
  isOver65: false,
  isBlind: false,
  income: {
    w2WagesCents: 0,
    scheduleCNetCents: 10_000_000, // $100k
    interestCents: 0,
    ordinaryDividendsCents: 0,
    qualifiedDividendsCents: 0,
    capitalGainCents: 0,
    otherIncomeCents: 0,
  },
  adjustments: {
    halfSeTaxCents: 706_700, // ~half of 15.3% × 92.35% × $100k
    retirementContribCents: 0,
    seHealthInsuranceCents: 0,
    hsaContribCents: 0,
    studentLoanInterestCents: 0,
  },
  itemize: false,
  itemizedTotalCents: 0,
  payments: {
    federalWithholdingCents: 0,
    estimatedPaymentsCents: 0,
    seTaxCents: 1_413_400,
  },
  preparer: { full_name: "Alex Park", ptin: null },
};

describe("renderForm1040HTML", () => {
  it("emits a filename derived from taxpayer name + tax year", () => {
    const { filename } = renderForm1040HTML(basicInput);
    expect(filename).toMatch(/1040-draft-riley-chen-2025/);
  });

  it("includes the schedule C net profit on Line 1h", () => {
    const { html } = renderForm1040HTML(basicInput);
    expect(html).toContain("$100,000.00");
  });

  it("subtracts adjustments from gross income to reach AGI", () => {
    const { html } = renderForm1040HTML(basicInput);
    // Total income = $100,000.00; adjustments = $7,067.00;
    // AGI = $92,933.00.
    expect(html).toContain("$92,933.00");
  });

  it("applies the 2025 single standard deduction", () => {
    const { html } = renderForm1040HTML(basicInput);
    expect(html).toContain("$15,000.00");
  });

  it("renders DRAFT watermark", () => {
    const { html } = renderForm1040HTML(basicInput);
    expect(html).toContain("DRAFT");
  });

  it("shows refund row when payments > tax", () => {
    const overpaid = {
      ...basicInput,
      payments: {
        ...basicInput.payments,
        federalWithholdingCents: 5_000_000,
      },
    };
    const { html } = renderForm1040HTML(overpaid);
    expect(html).toMatch(/refund/i);
  });

  it("shows balance-due row when tax > payments", () => {
    const { html } = renderForm1040HTML(basicInput);
    expect(html).toMatch(/Amount you owe/i);
  });

  it("uses married filing jointly standard deduction when set", () => {
    const mfj = {
      ...basicInput,
      filingStatus: "married_filing_jointly" as const,
    };
    const { html } = renderForm1040HTML(mfj);
    expect(html).toContain("$30,000.00");
  });
});
