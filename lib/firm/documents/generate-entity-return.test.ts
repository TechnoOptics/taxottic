import { describe, it, expect } from "vitest";
import { renderEntityReturnHTML } from "./generate-entity-return";

const baseInput = (form: "1065" | "1120" | "1120-S") => ({
  form,
  firm: { name: "Smith Allen CPA", accent_color: null, logo_url: null },
  company: {
    name: "Maple Lane Design Co.",
    legal_name: "Maple Lane Design Co.",
    ein: "12-3456789",
    entity_type: "partnership",
    incorporated_state: "CA",
    address_line_1: null,
    address_city: null,
    address_region: null,
    address_postal_code: null,
  },
  taxYear: 2025,
  totals: {
    grossReceiptsCents: 50_000_000, // $500k
    returnsCents: 0,
    cogsCents: 0,
    interestCents: 250_000, // $2.5k
    dividendsCents: 0,
    royaltyCents: 0,
    rentalCents: 0,
    totalDeductionsCents: 20_000_000, // $200k
    deductionsByCategory: new Map([
      ["Salaries", 12_000_000],
      ["Rent", 5_000_000],
      ["Office expense", 3_000_000],
    ]),
    section179Cents: 0,
    salariesCents: 12_000_000,
    officerCompCents: 0,
  },
  ownerCount: 2,
  preparer: { full_name: "Alex Park", ptin: null },
});

describe("renderEntityReturnHTML", () => {
  it("Form 1065 — emits pass-through note (no entity-level tax)", () => {
    const { html, filename } = renderEntityReturnHTML(baseInput("1065"));
    expect(filename).toMatch(/form-1065-draft/);
    expect(html).toContain("Form 1065");
    expect(html).toMatch(/passes through to partners/i);
  });

  it("Form 1120 — applies 21% C-Corp tax rate", () => {
    const input = baseInput("1120");
    input.company.entity_type = "c_corp";
    const { html } = renderEntityReturnHTML(input);
    // Total income $502.5k − $200k deductions = $302.5k ord income.
    // 21% × $302.5k = $63,525.
    expect(html).toContain("$63,525.00");
  });

  it("Form 1120-S — emits pass-through note", () => {
    const input = baseInput("1120-S");
    input.company.entity_type = "s_corp";
    const { html } = renderEntityReturnHTML(input);
    expect(html).toContain("Form 1120-S");
    expect(html).toMatch(/passes through to shareholders/i);
  });

  it("renders DRAFT watermark on every form", () => {
    for (const form of ["1065", "1120", "1120-S"] as const) {
      const { html } = renderEntityReturnHTML(baseInput(form));
      expect(html).toContain("DRAFT");
    }
  });

  it("sums gross receipts onto Line 1a", () => {
    const { html } = renderEntityReturnHTML(baseInput("1065"));
    expect(html).toContain("$500,000.00");
  });

  it("lists deduction categories in descending order", () => {
    const { html } = renderEntityReturnHTML(baseInput("1065"));
    const salariesIdx = html.indexOf("Salaries");
    const rentIdx = html.indexOf("Rent");
    const officeIdx = html.indexOf("Office expense");
    expect(salariesIdx).toBeGreaterThan(-1);
    expect(rentIdx).toBeGreaterThan(salariesIdx);
    expect(officeIdx).toBeGreaterThan(rentIdx);
  });
});
