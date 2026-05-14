// Tier 4 #1: Form 1040 generator.
//
// Pulls together the per-tax-year facts we already have on the
// client and renders an HTML draft that matches the 2025 Form 1040
// layout closely enough for the preparer to review side-by-side
// with the IRS form. It is a DRAFT — the watermark is bold on
// every page so nobody mistakes the output for a filed return.
//
// What's automated:
//   - Filing status, age, blindness, dependents (Lines 1-9)
//   - W-2 wages (Line 1a)
//   - Schedule C net profit flows to Line 1h via Schedule 1
//   - Interest, dividends, capital gains placeholders
//   - Total income (Line 9), AGI (Line 11)
//   - Standard vs itemized deduction choice (Line 12)
//   - QBI deduction placeholder (Line 13)
//   - Federal income tax (Line 16) — bracket math via the same
//     2025 constants the forecast engine uses
//   - Federal withholding (Line 25a)
//   - Estimated payments (Line 26)
//   - Refund / amount owed (Line 34 / Line 37)
//
// What's left to the preparer:
//   - Schedules A/B/D/E breakouts that need detail beyond what
//     books currently capture (capital gains lots, partnership
//     basis tracking, etc.)
//   - Credits (Schedule 3 line items)
//   - Foreign accounts disclosure
//   - Signature blocks for the taxpayer and spouse

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FEDERAL_BRACKETS_2025,
  STANDARD_DEDUCTION_2025,
  ADDITIONAL_STD_DEDUCTION_2025,
  type FilingStatus,
} from "@/lib/tax/constants-2025";

export type Form1040Input = {
  firm: { name: string; accent_color: string | null; logo_url: string | null };
  taxYear: number;
  taxpayer: {
    full_name: string | null;
    ssn_placeholder: string; // "▢▢▢-▢▢-▢▢▢▢"
    address_line_1: string | null;
    address_city: string | null;
    address_region: string | null;
    address_postal_code: string | null;
  };
  spouse?: {
    full_name: string | null;
    ssn_placeholder: string;
  } | null;
  filingStatus: FilingStatus;
  /** Number of dependents claimed for the year. */
  dependents: number;
  isOver65: boolean;
  isBlind: boolean;
  /** All currency fields in cents. */
  income: {
    w2WagesCents: number;
    /** Net profit from Schedule C (Sole-prop business income). */
    scheduleCNetCents: number;
    interestCents: number;
    ordinaryDividendsCents: number;
    qualifiedDividendsCents: number;
    capitalGainCents: number;
    otherIncomeCents: number;
  };
  adjustments: {
    /** Deductible portion of SE tax — half of SE tax. */
    halfSeTaxCents: number;
    /** Solo 401k / SEP-IRA contributions. */
    retirementContribCents: number;
    /** Self-employed health insurance deduction. */
    seHealthInsuranceCents: number;
    /** HSA contributions deducted above-the-line. */
    hsaContribCents: number;
    /** Student loan interest, paid prior to phaseout. */
    studentLoanInterestCents: number;
  };
  itemize: boolean;
  itemizedTotalCents: number;
  payments: {
    federalWithholdingCents: number;
    estimatedPaymentsCents: number;
    seTaxCents: number;
  };
  preparer: { full_name: string | null; ptin: string | null };
};

export async function loadForm1040Data(
  admin: SupabaseClient,
  args: { ownerUserId: string; companyId: string; taxYear: number },
): Promise<{
  taxpayer: Form1040Input["taxpayer"];
  filingStatus: FilingStatus;
  dependents: number;
  isOver65: boolean;
  isBlind: boolean;
  itemize: boolean;
  itemizedTotalCents: number;
  income: Form1040Input["income"];
  adjustments: Form1040Input["adjustments"];
  payments: Form1040Input["payments"];
}> {
  // Fetch tax profile, books, and owner profile in parallel.
  const [
    { data: profile },
    { data: ownerRow },
    { data: incomeRows },
    { data: expenseRows },
  ] = await Promise.all([
    admin
      .from("tax_profiles")
      .select(
        "filing_status, dependents, age, is_blind, itemize, itemized_total_cents, owner_w2_wages_cents, owner_w2_withheld_cents, spouse_w2_wages_cents, spouse_w2_withheld_cents, estimated_payments_cents, solo_401k_contribution_cents, sep_ira_contribution_cents, traditional_ira_contribution_cents, hsa_contribution_cents, se_health_insurance_cents, student_loan_interest_cents",
      )
      .eq("user_id", args.ownerUserId)
      .eq("tax_year", args.taxYear)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("full_name, email")
      .eq("id", args.ownerUserId)
      .maybeSingle(),
    admin
      .from("monthly_income")
      .select("amount_cents, source")
      .eq("company_id", args.companyId)
      .eq("tax_year", args.taxYear),
    admin
      .from("monthly_expenses")
      .select(
        "amount_cents, category:deduction_categories(schedule_c_line, is_meal)",
      )
      .eq("company_id", args.companyId)
      .eq("tax_year", args.taxYear),
  ]);

  // Schedule-C-style net profit. We re-derive it here rather than
  // calling loadScheduleCData so the 1040 stays renderable when
  // Schedule C hasn't been generated separately.
  let gross = 0;
  let interest = 0;
  let dividends = 0;
  for (const r of incomeRows ?? []) {
    const cents = r.amount_cents ?? 0;
    if (r.source === "interest") interest += cents;
    else if (r.source === "dividends") dividends += cents;
    else gross += cents;
  }
  let expensesTotal = 0;
  let mealsTotal = 0;
  for (const e of expenseRows ?? []) {
    const cat = (
      e as unknown as {
        category?: { schedule_c_line: string | null; is_meal: boolean | null };
      }
    ).category;
    if (!cat?.schedule_c_line) continue;
    const cents = e.amount_cents ?? 0;
    if (cat.is_meal) mealsTotal += cents;
    else expensesTotal += cents;
  }
  const mealsDeductible = Math.floor(mealsTotal * 0.5);
  const scheduleCNet = Math.max(0, gross - expensesTotal - mealsDeductible);

  // SE tax math (same formula as forecast engine).
  const seBase = Math.floor(scheduleCNet * 0.9235);
  const seTax = Math.floor(seBase * 0.153);
  const halfSeTax = Math.floor(seTax / 2);

  const filingStatus: FilingStatus =
    (profile?.filing_status as FilingStatus) ?? "single";

  const retirementContrib =
    (profile?.solo_401k_contribution_cents ?? 0) +
    (profile?.sep_ira_contribution_cents ?? 0) +
    (profile?.traditional_ira_contribution_cents ?? 0);

  return {
    taxpayer: {
      full_name: ownerRow?.full_name ?? ownerRow?.email ?? null,
      ssn_placeholder: "▢▢▢-▢▢-▢▢▢▢",
      address_line_1: null,
      address_city: null,
      address_region: null,
      address_postal_code: null,
    },
    filingStatus,
    dependents: profile?.dependents ?? 0,
    isOver65: (profile?.age ?? 0) >= 65,
    isBlind: !!profile?.is_blind,
    itemize: !!profile?.itemize,
    itemizedTotalCents: profile?.itemized_total_cents ?? 0,
    income: {
      w2WagesCents:
        (profile?.owner_w2_wages_cents ?? 0) +
        (profile?.spouse_w2_wages_cents ?? 0),
      scheduleCNetCents: scheduleCNet,
      interestCents: interest,
      ordinaryDividendsCents: dividends,
      qualifiedDividendsCents: 0,
      capitalGainCents: 0,
      otherIncomeCents: 0,
    },
    adjustments: {
      halfSeTaxCents: halfSeTax,
      retirementContribCents: retirementContrib,
      seHealthInsuranceCents: profile?.se_health_insurance_cents ?? 0,
      hsaContribCents: profile?.hsa_contribution_cents ?? 0,
      studentLoanInterestCents: profile?.student_loan_interest_cents ?? 0,
    },
    payments: {
      federalWithholdingCents:
        (profile?.owner_w2_withheld_cents ?? 0) +
        (profile?.spouse_w2_withheld_cents ?? 0),
      estimatedPaymentsCents: profile?.estimated_payments_cents ?? 0,
      seTaxCents: seTax,
    },
  };
}

/** Federal tax via 2025 bracket table (cents in, cents out). */
function computeBracketTax(taxableCents: number, fs: FilingStatus): number {
  if (taxableCents <= 0) return 0;
  const brackets = FEDERAL_BRACKETS_2025[fs];
  let owed = 0;
  let prev = 0;
  for (const b of brackets) {
    const ceiling = b.upTo ?? Number.POSITIVE_INFINITY;
    if (taxableCents <= prev) break;
    const slice = Math.min(taxableCents, ceiling) - prev;
    owed += Math.floor(slice * b.rate);
    prev = ceiling;
    if (taxableCents <= ceiling) break;
  }
  return owed;
}

export function renderForm1040HTML(input: Form1040Input): {
  html: string;
  filename: string;
} {
  const cta = input.firm.accent_color || "#0F2D24";

  // Line math.
  const totalIncome =
    input.income.w2WagesCents +
    input.income.scheduleCNetCents +
    input.income.interestCents +
    input.income.ordinaryDividendsCents +
    input.income.capitalGainCents +
    input.income.otherIncomeCents;

  const adjustmentsTotal =
    input.adjustments.halfSeTaxCents +
    input.adjustments.retirementContribCents +
    input.adjustments.seHealthInsuranceCents +
    input.adjustments.hsaContribCents +
    input.adjustments.studentLoanInterestCents;

  const agi = Math.max(0, totalIncome - adjustmentsTotal);

  const stdDeduction =
    STANDARD_DEDUCTION_2025[input.filingStatus] +
    (input.isOver65
      ? input.filingStatus === "single" ||
        input.filingStatus === "head_of_household"
        ? ADDITIONAL_STD_DEDUCTION_2025.single
        : ADDITIONAL_STD_DEDUCTION_2025.married
      : 0) +
    (input.isBlind
      ? input.filingStatus === "single" ||
        input.filingStatus === "head_of_household"
        ? ADDITIONAL_STD_DEDUCTION_2025.single
        : ADDITIONAL_STD_DEDUCTION_2025.married
      : 0);

  const deductionTaken = input.itemize
    ? Math.max(stdDeduction, input.itemizedTotalCents)
    : stdDeduction;

  // QBI: simple 20% of Schedule C net, capped at 20% of (AGI -
  // deductionTaken). The real QBI math has phaseouts and SSTB
  // rules; we leave that for the preparer review.
  const qbiCandidate = Math.floor(input.income.scheduleCNetCents * 0.2);
  const qbiCap = Math.floor(Math.max(0, agi - deductionTaken) * 0.2);
  const qbi = Math.max(0, Math.min(qbiCandidate, qbiCap));

  const taxableIncome = Math.max(0, agi - deductionTaken - qbi);
  const incomeTax = computeBracketTax(taxableIncome, input.filingStatus);

  const totalTax = incomeTax + input.payments.seTaxCents;
  const totalPayments =
    input.payments.federalWithholdingCents +
    input.payments.estimatedPaymentsCents;

  const refundOrOwed = totalPayments - totalTax;
  const refundCents = Math.max(0, refundOrOwed);
  const owedCents = Math.max(0, -refundOrOwed);

  const fsLabel: Record<FilingStatus, string> = {
    single: "Single",
    married_filing_jointly: "Married Filing Jointly",
    married_filing_separately: "Married Filing Separately",
    head_of_household: "Head of Household",
    qualifying_widow: "Qualifying Surviving Spouse",
  };

  const rows = (lines: Array<[string, string, number | string]>) =>
    lines
      .map(
        ([num, label, val]) =>
          `<tr>
            <td class="line">${escapeHtml(num)}</td>
            <td class="label">${escapeHtml(label)}</td>
            <td class="amount">${typeof val === "number" ? (val > 0 ? formatCents(val) : "—") : escapeHtml(val)}</td>
          </tr>`,
      )
      .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Form 1040 draft — ${escapeHtml(input.taxpayer.full_name ?? "Taxpayer")} ${input.taxYear}</title>
<style>
  @page { margin: 0.75in; }
  body { font-family: Georgia, "Times New Roman", serif; color: #18181B; font-size: 11pt; line-height: 1.5; }
  h1 { font-size: 16pt; margin: 0 0 4pt; color: ${cta}; }
  h2 { font-size: 12pt; margin: 18pt 0 6pt; color: ${cta}; border-bottom: 1pt solid ${cta}; padding-bottom: 3pt; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12pt; }
  td { padding: 4pt 8pt; border-bottom: 1px solid #E5E5E5; vertical-align: top; }
  .line { font-family: 'Courier New', monospace; font-size: 10pt; color: #555; width: 10%; }
  .label { width: 65%; }
  .amount { text-align: right; font-variant-numeric: tabular-nums; width: 25%; }
  .totals td { font-weight: bold; }
  .draft-badge { display: inline-block; padding: 2pt 8pt; background: #fef3c7; color: #92400e; border-radius: 4pt; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.1em; font-weight: bold; margin-bottom: 8pt; }
  .small { font-size: 9pt; color: #71717A; line-height: 1.5; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 32pt; margin-top: 12pt; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12pt; }
  .signature-line { margin-top: 24pt; border-top: 1pt solid #18181B; padding-top: 3pt; font-size: 9pt; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="draft-badge">DRAFT — for preparer review</div>
      <h1>Form 1040 — U.S. Individual Income Tax Return</h1>
      <div class="small">Tax year ${input.taxYear} · prepared by ${escapeHtml(input.firm.name)}</div>
    </div>
  </div>

  <h2>Taxpayer</h2>
  <table>
    <tr><td class="line">—</td><td class="label">Name</td><td class="amount">${escapeHtml(input.taxpayer.full_name ?? "—")}</td></tr>
    <tr><td class="line">—</td><td class="label">Social security number</td><td class="amount">${escapeHtml(input.taxpayer.ssn_placeholder)}</td></tr>
    <tr><td class="line">—</td><td class="label">Filing status</td><td class="amount">${escapeHtml(fsLabel[input.filingStatus])}</td></tr>
    <tr><td class="line">—</td><td class="label">Dependents</td><td class="amount">${input.dependents}</td></tr>
    ${input.spouse ? `<tr><td class="line">—</td><td class="label">Spouse</td><td class="amount">${escapeHtml(input.spouse.full_name ?? "—")} · ${escapeHtml(input.spouse.ssn_placeholder)}</td></tr>` : ""}
  </table>

  <h2>Income</h2>
  <table>
    ${rows([
      ["1a", "Total wages from W-2 box 1", input.income.w2WagesCents],
      ["1h", "Other earned income (Schedule C net profit)", input.income.scheduleCNetCents],
      ["2b", "Taxable interest", input.income.interestCents],
      ["3b", "Ordinary dividends", input.income.ordinaryDividendsCents],
      ["3a", "Qualified dividends (memo)", input.income.qualifiedDividendsCents],
      ["7", "Capital gain or (loss)", input.income.capitalGainCents],
      ["8", "Other income from Schedule 1", input.income.otherIncomeCents],
      ["9", "Total income", totalIncome],
    ])}
  </table>

  <h2>Adjustments (Schedule 1 Part II)</h2>
  <table>
    ${rows([
      ["15", "Deductible portion of self-employment tax", input.adjustments.halfSeTaxCents],
      ["16", "Self-employed retirement contributions (solo 401k, SEP-IRA, IRA)", input.adjustments.retirementContribCents],
      ["17", "Self-employed health insurance deduction", input.adjustments.seHealthInsuranceCents],
      ["13", "HSA deduction", input.adjustments.hsaContribCents],
      ["21", "Student loan interest deduction", input.adjustments.studentLoanInterestCents],
      ["26", "Total adjustments to income", adjustmentsTotal],
    ])}
  </table>

  <h2>Deduction + taxable income</h2>
  <table>
    ${rows([
      ["11", "Adjusted gross income (Line 9 − Line 10)", agi],
      ["12", `${input.itemize ? "Itemized deductions (Schedule A)" : "Standard deduction"}`, deductionTaken],
      ["13", "Qualified business income deduction (Form 8995)", qbi],
      ["15", "Taxable income (Line 11 − Lines 12 + 13)", taxableIncome],
    ])}
  </table>

  <h2>Tax + payments</h2>
  <table>
    ${rows([
      ["16", "Federal income tax (2025 brackets)", incomeTax],
      ["23", "Other taxes (Schedule SE, etc.) — self-employment tax", input.payments.seTaxCents],
      ["24", "Total tax (Line 16 + Line 23)", totalTax],
      ["25a", "Federal income tax withheld from W-2", input.payments.federalWithholdingCents],
      ["26", "2025 estimated tax payments", input.payments.estimatedPaymentsCents],
      ["33", "Total payments", totalPayments],
    ])}
  </table>

  ${
    refundCents > 0
      ? `<table class="totals">
          <tr><td class="line">34</td><td class="label">Amount overpaid — refund</td><td class="amount" style="color: #166534;">${formatCents(refundCents)}</td></tr>
        </table>`
      : owedCents > 0
        ? `<table class="totals">
            <tr><td class="line">37</td><td class="label">Amount you owe</td><td class="amount" style="color: #92400e;">${formatCents(owedCents)}</td></tr>
          </table>`
        : `<table class="totals">
            <tr><td class="line">—</td><td class="label">Balance due / refund</td><td class="amount">$0.00</td></tr>
          </table>`
  }

  <h2>Sign here</h2>
  <div class="grid-2">
    <div>
      <div class="signature-line">Taxpayer signature</div>
      <div class="small" style="margin-top: 2pt;">Date</div>
    </div>
    <div>
      <div class="signature-line">Paid preparer signature</div>
      <div class="small" style="margin-top: 2pt;">${escapeHtml(input.preparer.full_name ?? "")} · PTIN ${escapeHtml(input.preparer.ptin ?? "—")}</div>
    </div>
  </div>

  <p class="small" style="margin-top: 24pt;">
    This is an auto-generated DRAFT produced by Taxottic for review.
    Compare every line item to the IRS-issued Form 1040 for tax year
    ${input.taxYear} before signing or filing. Capital gains, foreign
    accounts, and itemized deductions (Schedule A) require additional
    schedules not included in this draft.
  </p>
</body>
</html>`;

  const filename = `1040-draft-${input.taxpayer.full_name?.replace(/\s+/g, "-").toLowerCase() ?? "taxpayer"}-${input.taxYear}.html`;
  return { html, filename };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}
