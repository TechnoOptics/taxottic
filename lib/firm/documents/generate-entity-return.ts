// Tier 4 #2: Entity-level return generators.
//
// Three forms in one file because they share 90% of the shape:
//   - Form 1065 (Partnership return)
//   - Form 1120 (C-Corp return)
//   - Form 1120-S (S-Corp return)
//
// Each form aggregates the entity's books for a tax year, computes
// taxable income, and renders a draft HTML the preparer can review
// against the IRS form. The K-1 distribution to partners /
// shareholders is a separate generator (lib/firm/documents/generate-k1.ts)
// that operates on the same totals.
//
// What's automated:
//   - Gross receipts (Line 1a) from monthly_income
//   - Total deductions by Schedule C-mapped lines aggregated to the
//     1065/1120 line numbering (we re-label, not re-compute)
//   - Tax due (Form 1120 only — C-Corp pays a flat 21% federal rate
//     under TCJA; Forms 1065 and 1120-S pass through and owe zero
//     at the entity level for federal income tax)
//
// What's left to the preparer:
//   - Schedule L (Balance Sheet) — requires book balances we don't
//     yet capture in monthly_income/monthly_expenses.
//   - Schedule M-1 / M-2 reconciliation
//   - Form 4562 depreciation detail beyond §179
//   - Federal tax deposits (Form 8109 / EFTPS history)

import type { SupabaseClient } from "@supabase/supabase-js";

export type EntityForm = "1065" | "1120" | "1120-S";

export type EntityReturnInput = {
  form: EntityForm;
  firm: { name: string; accent_color: string | null; logo_url: string | null };
  company: {
    name: string;
    legal_name: string | null;
    ein: string | null;
    entity_type: string | null;
    incorporated_state: string | null;
    address_line_1: string | null;
    address_city: string | null;
    address_region: string | null;
    address_postal_code: string | null;
  };
  taxYear: number;
  totals: {
    grossReceiptsCents: number;
    returnsCents: number;
    /** Cost of goods sold — left at 0 unless captured separately. */
    cogsCents: number;
    /** Interest, dividends, royalty income separated out. */
    interestCents: number;
    dividendsCents: number;
    royaltyCents: number;
    rentalCents: number;
    /** Total deductions (sum of Schedule C-line expenses). */
    totalDeductionsCents: number;
    /** Breakdown of deductions by major category. */
    deductionsByCategory: Map<string, number>;
    /** §179 deduction. */
    section179Cents: number;
    /** Salaries and wages paid to non-owners. */
    salariesCents: number;
    /** Compensation paid to officers (1120 only). */
    officerCompCents: number;
  };
  /** Number of partners / shareholders if available. */
  ownerCount: number;
  preparer: { full_name: string | null; ptin: string | null };
};

const FORM_TITLE: Record<EntityForm, string> = {
  "1065": "Form 1065 — U.S. Return of Partnership Income",
  "1120": "Form 1120 — U.S. Corporation Income Tax Return",
  "1120-S": "Form 1120-S — U.S. Income Tax Return for an S Corporation",
};

const FORM_FILENAME_PREFIX: Record<EntityForm, string> = {
  "1065": "form-1065",
  "1120": "form-1120",
  "1120-S": "form-1120s",
};

export async function loadEntityReturnTotals(
  admin: SupabaseClient,
  companyId: string,
  taxYear: number,
): Promise<EntityReturnInput["totals"]> {
  const [{ data: income }, { data: expenses }] = await Promise.all([
    admin
      .from("monthly_income")
      .select("amount_cents, source")
      .eq("company_id", companyId)
      .eq("tax_year", taxYear),
    admin
      .from("monthly_expenses")
      .select(
        "amount_cents, category:deduction_categories(schedule_c_line, name, is_meal)",
      )
      .eq("company_id", companyId)
      .eq("tax_year", taxYear),
  ]);

  let gross = 0;
  let interest = 0;
  let dividends = 0;
  let royalty = 0;
  let rental = 0;
  for (const r of income ?? []) {
    const cents = r.amount_cents ?? 0;
    switch (r.source) {
      case "interest":
        interest += cents;
        break;
      case "dividends":
        dividends += cents;
        break;
      case "royalty":
        royalty += cents;
        break;
      case "rental":
        rental += cents;
        break;
      default:
        gross += cents;
    }
  }

  const deductionsByCategory = new Map<string, number>();
  let total = 0;
  let salaries = 0;
  const officerComp = 0;
  let section179 = 0;
  let mealsTotal = 0;
  for (const e of expenses ?? []) {
    const cat = (
      e as unknown as {
        category?: {
          schedule_c_line: string | null;
          name: string | null;
          is_meal: boolean | null;
        };
      }
    ).category;
    if (!cat?.schedule_c_line) continue;
    const cents = e.amount_cents ?? 0;
    if (cat.is_meal) {
      mealsTotal += cents;
      continue;
    }
    if (cat.schedule_c_line === "Line 26") {
      // Schedule C Line 26 is "Wages" — we re-bucket to salaries.
      salaries += cents;
    }
    if (cat.schedule_c_line === "Line 13") section179 += cents;
    deductionsByCategory.set(
      cat.name ?? cat.schedule_c_line,
      (deductionsByCategory.get(cat.name ?? cat.schedule_c_line) ?? 0) + cents,
    );
    total += cents;
  }
  const mealsDeductible = Math.floor(mealsTotal * 0.5);
  total += mealsDeductible;
  if (mealsDeductible > 0) {
    deductionsByCategory.set(
      "Meals (50% deductible)",
      (deductionsByCategory.get("Meals (50% deductible)") ?? 0) +
        mealsDeductible,
    );
  }

  return {
    grossReceiptsCents: gross,
    returnsCents: 0,
    cogsCents: 0,
    interestCents: interest,
    dividendsCents: dividends,
    royaltyCents: royalty,
    rentalCents: rental,
    totalDeductionsCents: total,
    deductionsByCategory,
    section179Cents: section179,
    salariesCents: salaries,
    officerCompCents: officerComp,
  };
}

export function renderEntityReturnHTML(input: EntityReturnInput): {
  html: string;
  filename: string;
} {
  const cta = input.firm.accent_color || "#1d2843";
  const isC = input.form === "1120";
  const isS = input.form === "1120-S";
  const isPartnership = input.form === "1065";

  const grossIncome =
    input.totals.grossReceiptsCents - input.totals.returnsCents;
  const grossProfit = grossIncome - input.totals.cogsCents;
  const otherIncome =
    input.totals.interestCents +
    input.totals.dividendsCents +
    input.totals.royaltyCents +
    input.totals.rentalCents;
  const totalIncomeLine = grossProfit + otherIncome;
  const ordinaryIncome = totalIncomeLine - input.totals.totalDeductionsCents;

  // Form 1120 C-Corp tax: flat 21% under TCJA.
  const corpTax = isC ? Math.max(0, Math.floor(ordinaryIncome * 0.21)) : 0;

  const deductionRows = Array.from(input.totals.deductionsByCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .map(
      ([name, cents]) =>
        `<tr>
          <td class="line">—</td>
          <td class="label">${escapeHtml(name)}</td>
          <td class="amount">${formatCents(cents)}</td>
        </tr>`,
    )
    .join("");

  const formNumber = input.form;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${FORM_TITLE[input.form]} draft — ${escapeHtml(input.company.name)} ${input.taxYear}</title>
<style>
  @page { margin: 0.75in; }
  body { font-family: Georgia, "Times New Roman", serif; color: #18181B; font-size: 11pt; line-height: 1.5; }
  h1 { font-size: 15pt; margin: 0 0 4pt; color: ${cta}; }
  h2 { font-size: 11pt; margin: 18pt 0 6pt; color: ${cta}; border-bottom: 1pt solid ${cta}; padding-bottom: 3pt; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12pt; }
  td { padding: 4pt 8pt; border-bottom: 1px solid #E5E5E5; vertical-align: top; }
  .line { font-family: 'Courier New', monospace; font-size: 10pt; color: #555; width: 12%; }
  .label { width: 63%; }
  .amount { text-align: right; font-variant-numeric: tabular-nums; width: 25%; }
  .totals td { font-weight: bold; }
  .draft-badge { display: inline-block; padding: 2pt 8pt; background: #fef3c7; color: #92400e; border-radius: 4pt; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.1em; font-weight: bold; margin-bottom: 8pt; }
  .small { font-size: 9pt; color: #71717A; line-height: 1.5; }
  .signature-line { margin-top: 24pt; border-top: 1pt solid #18181B; padding-top: 3pt; font-size: 9pt; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 32pt; margin-top: 12pt; }
</style>
</head>
<body>
  <div class="draft-badge">DRAFT — for preparer review</div>
  <h1>${escapeHtml(FORM_TITLE[input.form])}</h1>
  <div class="small">Tax year ${input.taxYear} · prepared by ${escapeHtml(input.firm.name)}</div>

  <h2>Entity</h2>
  <table>
    <tr><td class="line">—</td><td class="label">Name of partnership / corporation</td><td class="amount">${escapeHtml(input.company.legal_name ?? input.company.name)}</td></tr>
    <tr><td class="line">—</td><td class="label">EIN</td><td class="amount">${escapeHtml(input.company.ein ?? "—")}</td></tr>
    <tr><td class="line">—</td><td class="label">Entity type</td><td class="amount">${escapeHtml(input.company.entity_type ?? "—")}</td></tr>
    ${input.company.incorporated_state ? `<tr><td class="line">—</td><td class="label">State of incorporation</td><td class="amount">${escapeHtml(input.company.incorporated_state)}</td></tr>` : ""}
    <tr><td class="line">—</td><td class="label">Number of ${isPartnership ? "partners" : "shareholders"}</td><td class="amount">${input.ownerCount}</td></tr>
  </table>

  <h2>Income</h2>
  <table>
    <tr><td class="line">1a</td><td class="label">Gross receipts or sales</td><td class="amount">${formatCents(input.totals.grossReceiptsCents)}</td></tr>
    <tr><td class="line">1b</td><td class="label">Returns and allowances</td><td class="amount">${input.totals.returnsCents > 0 ? formatCents(input.totals.returnsCents) : "—"}</td></tr>
    <tr><td class="line">1c</td><td class="label">Subtract Line 1b from 1a</td><td class="amount">${formatCents(grossIncome)}</td></tr>
    <tr><td class="line">2</td><td class="label">Cost of goods sold (Schedule A — Form 1125-A)</td><td class="amount">${input.totals.cogsCents > 0 ? formatCents(input.totals.cogsCents) : "—"}</td></tr>
    <tr><td class="line">3</td><td class="label">Gross profit (Line 1c − Line 2)</td><td class="amount">${formatCents(grossProfit)}</td></tr>
    <tr><td class="line">4</td><td class="label">Ordinary dividends</td><td class="amount">${input.totals.dividendsCents > 0 ? formatCents(input.totals.dividendsCents) : "—"}</td></tr>
    <tr><td class="line">5</td><td class="label">Interest income</td><td class="amount">${input.totals.interestCents > 0 ? formatCents(input.totals.interestCents) : "—"}</td></tr>
    <tr><td class="line">6</td><td class="label">Gross rents</td><td class="amount">${input.totals.rentalCents > 0 ? formatCents(input.totals.rentalCents) : "—"}</td></tr>
    <tr><td class="line">7</td><td class="label">Gross royalties</td><td class="amount">${input.totals.royaltyCents > 0 ? formatCents(input.totals.royaltyCents) : "—"}</td></tr>
    <tr class="totals"><td class="line">${isC ? "11" : "8"}</td><td class="label">Total income (combine Lines 3–7)</td><td class="amount">${formatCents(totalIncomeLine)}</td></tr>
  </table>

  <h2>Deductions</h2>
  <table>
    ${
      isC
        ? `<tr><td class="line">12</td><td class="label">Compensation of officers</td><td class="amount">${input.totals.officerCompCents > 0 ? formatCents(input.totals.officerCompCents) : "—"}</td></tr>
           <tr><td class="line">13</td><td class="label">Salaries and wages (excluding officers)</td><td class="amount">${input.totals.salariesCents > 0 ? formatCents(input.totals.salariesCents) : "—"}</td></tr>`
        : `<tr><td class="line">${isPartnership ? "9" : "7"}</td><td class="label">Salaries and wages</td><td class="amount">${input.totals.salariesCents > 0 ? formatCents(input.totals.salariesCents) : "—"}</td></tr>`
    }
    <tr><td class="line">—</td><td class="label" colspan="2"><strong>Deduction detail by category:</strong></td></tr>
    ${deductionRows || `<tr><td class="line">—</td><td class="label" colspan="2"><span style="color:#71717A;">No category-mapped expenses yet.</span></td></tr>`}
    <tr class="totals"><td class="line">${isC ? "27" : "20"}</td><td class="label">Total deductions</td><td class="amount">${formatCents(input.totals.totalDeductionsCents)}</td></tr>
  </table>

  <h2>${isC ? "Taxable income + tax" : "Ordinary business income (loss)"}</h2>
  <table>
    <tr class="totals"><td class="line">${isC ? "30" : isPartnership ? "22" : "21"}</td><td class="label">${isC ? "Taxable income (Line 11 − Line 27)" : "Ordinary business income or (loss)"}</td><td class="amount">${formatCents(ordinaryIncome)}</td></tr>
    ${
      isC
        ? `<tr class="totals"><td class="line">31</td><td class="label">Total tax (Line 30 × 21%, TCJA flat rate)</td><td class="amount" style="color: #92400e;">${formatCents(corpTax)}</td></tr>`
        : isPartnership
          ? `<tr><td class="line">—</td><td class="label" colspan="2"><span class="small">Partnership income passes through to partners via Schedule K-1; no federal tax due at the entity level.</span></td></tr>`
          : `<tr><td class="line">—</td><td class="label" colspan="2"><span class="small">S-Corp ordinary income passes through to shareholders via Schedule K-1; no federal income tax due at the entity level (built-in gains + LIFO recapture taxes computed separately).</span></td></tr>`
    }
  </table>

  <h2>Sign here</h2>
  <div class="grid-2">
    <div>
      <div class="signature-line">${isPartnership ? "General partner" : "Officer"} signature</div>
      <div class="small" style="margin-top: 2pt;">Date · Title</div>
    </div>
    <div>
      <div class="signature-line">Paid preparer signature</div>
      <div class="small" style="margin-top: 2pt;">${escapeHtml(input.preparer.full_name ?? "")} · PTIN ${escapeHtml(input.preparer.ptin ?? "—")}</div>
    </div>
  </div>

  <p class="small" style="margin-top: 24pt;">
    This is an auto-generated DRAFT of Form ${formNumber}. Schedule
    L (Balance Sheet), Schedule M-1 / M-2 reconciliation, and
    Form 4562 depreciation detail still need preparer attention
    before filing. ${isPartnership || isS ? "Each owner's share is computed on the separate K-1 generator." : ""}
  </p>
</body>
</html>`;

  const filename = `${FORM_FILENAME_PREFIX[input.form]}-draft-${input.company.name
    .replace(/\s+/g, "-")
    .toLowerCase()}-${input.taxYear}.html`;
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
