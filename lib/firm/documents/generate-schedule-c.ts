import type { SupabaseClient } from "@supabase/supabase-js";

// Schedule C (Form 1040, Profit or Loss From Business) draft
// generator. Reads the client's books for the engagement's
// tax_year and produces an HTML draft formatted to match the
// IRS Schedule C 2024 layout closely enough that the firm
// preparer can review it side-by-side with the real form.
//
// What this generator DOES:
//   - Sum income by source → Line 1 (Gross receipts).
//   - Sum expenses by category, mapping each category's
//     schedule_c_line column to the corresponding box (Line 8
//     Advertising, Line 9 Car/truck, Line 22 Supplies, etc.).
//   - Handle 50% meal limitation (Line 24b).
//   - Compute net profit/loss (Line 31).
//
// What this generator does NOT do (left for follow-ups):
//   - Cost of Goods Sold (Part III). Most service-business
//     clients don't need it; we render the section blank with
//     a "fill in if applicable" callout.
//   - Vehicle expense breakout (Part IV), requires standard-
//     mileage vs actual-expense choice we'd need to ask the
//     preparer.
//   - Form 8829 (home office), we surface the line item but
//     don't compute the allocated portion.
//
// The output is HTML (print-to-PDF in the browser). Real
// server-side PDF rendering via Chromium lands in Phase 11.5
// when we wire automated e-filing.

export type ScheduleCInput = {
  firm: {
    name: string;
    accent_color: string | null;
    logo_url: string | null;
  };
  company: {
    name: string;
    legal_name: string | null;
    ein: string | null;
    address_line_1: string | null;
    address_city: string | null;
    address_region: string | null;
    address_postal_code: string | null;
  };
  taxYear: number;
  /** Sole prop owner (the company's manager), Schedule C is
   *  filed under the owner's name + SSN, not the business EIN. */
  owner: {
    full_name: string | null;
    ssn: string | null; // never actually stored; surfaces "▢▢▢-▢▢-▢▢▢▢" placeholder
  };
  income: {
    /** Sum of all monthly_income for the company + tax_year. */
    grossReceiptsCents: number;
    /** Returns + allowances, we don't track separately yet; 0 today. */
    returnsCents: number;
    /** Other income (interest, rebates not part of gross receipts). */
    otherIncomeCents: number;
  };
  /** Map of schedule_c_line → sum-of-cents. */
  expensesByLine: Map<string, number>;
  /** Meals deductible bucket (50% of total meals already applied). */
  mealsDeductibleCents: number;
  /** Optional preparer signature block. */
  preparer: {
    full_name: string | null;
    title: string | null;
    ptin: string | null; // never auto-filled
  };
};

const SCHEDULE_C_LINE_DEFS: { line: string; label: string }[] = [
  { line: "Line 8", label: "Advertising" },
  { line: "Line 9", label: "Car and truck expenses" },
  { line: "Line 10", label: "Commissions and fees" },
  { line: "Line 11", label: "Contract labor" },
  { line: "Line 12", label: "Depletion" },
  { line: "Line 13", label: "Depreciation and §179" },
  { line: "Line 14", label: "Employee benefit programs" },
  { line: "Line 15", label: "Insurance (other than health)" },
  { line: "Line 16a", label: "Mortgage interest paid to banks" },
  { line: "Line 16b", label: "Other interest" },
  { line: "Line 17", label: "Legal and professional services" },
  { line: "Line 18", label: "Office expense" },
  { line: "Line 19", label: "Pension and profit-sharing plans" },
  { line: "Line 20a", label: "Rent, vehicles, machinery, equipment" },
  { line: "Line 20b", label: "Rent, other business property" },
  { line: "Line 21", label: "Repairs and maintenance" },
  { line: "Line 22", label: "Supplies" },
  { line: "Line 23", label: "Taxes and licenses" },
  { line: "Line 24a", label: "Travel" },
  { line: "Line 24b", label: "Deductible meals" },
  { line: "Line 25", label: "Utilities" },
  { line: "Line 26", label: "Wages (less employment credits)" },
  { line: "Line 27a", label: "Other expenses (see Part V)" },
  { line: "Line 30", label: "Home office (Form 8829)" },
];

export async function loadScheduleCData(
  admin: SupabaseClient,
  companyId: string,
  taxYear: number,
): Promise<{
  grossReceiptsCents: number;
  otherIncomeCents: number;
  expensesByLine: Map<string, number>;
  mealsDeductibleCents: number;
}> {
  const [{ data: income }, { data: expenses }] = await Promise.all([
    admin
      .from("monthly_income")
      .select("amount_cents, source")
      .eq("company_id", companyId)
      .eq("tax_year", taxYear),
    admin
      .from("monthly_expenses")
      .select(
        "amount_cents, category_code, category:deduction_categories(schedule_c_line, is_meal)",
      )
      .eq("company_id", companyId)
      .eq("tax_year", taxYear),
  ]);

  let grossReceipts = 0;
  let otherIncome = 0;
  for (const r of income ?? []) {
    if (
      r.source === "interest" ||
      r.source === "dividends" ||
      r.source === "royalty"
    ) {
      otherIncome += r.amount_cents ?? 0;
    } else {
      grossReceipts += r.amount_cents ?? 0;
    }
  }

  const expensesByLine = new Map<string, number>();
  let mealsTotal = 0;
  for (const e of expenses ?? []) {
    const cat = (
      e as unknown as {
        category?: { schedule_c_line: string | null; is_meal: boolean | null };
      }
    ).category;
    if (!cat?.schedule_c_line) continue;
    const cents = e.amount_cents ?? 0;
    if (cat.is_meal) {
      mealsTotal += cents;
      // Skip adding to expensesByLine here; we compute the 50%
      // deductible separately and slot it into Line 24b below.
      continue;
    }
    expensesByLine.set(
      cat.schedule_c_line,
      (expensesByLine.get(cat.schedule_c_line) ?? 0) + cents,
    );
  }
  const mealsDeductible = Math.floor(mealsTotal * 0.5);
  if (mealsDeductible > 0) {
    expensesByLine.set("Line 24b", mealsDeductible);
  }

  return {
    grossReceiptsCents: grossReceipts,
    otherIncomeCents: otherIncome,
    expensesByLine,
    mealsDeductibleCents: mealsDeductible,
  };
}

export function renderScheduleCHTML(input: ScheduleCInput): {
  html: string;
  filename: string;
} {
  const cta = input.firm.accent_color || "#1d2843";
  const totalExpenses = Array.from(input.expensesByLine.values()).reduce(
    (a, c) => a + c,
    0,
  );
  const grossIncome = input.income.grossReceiptsCents - input.income.returnsCents;
  const grossProfit = grossIncome; // No COGS modeled yet
  const totalIncomeForLine7 = grossProfit + input.income.otherIncomeCents;
  const netProfit = totalIncomeForLine7 - totalExpenses;

  const expenseRows = SCHEDULE_C_LINE_DEFS.map((line) => {
    const cents = input.expensesByLine.get(line.line) ?? 0;
    return `<tr>
      <td style="padding: 6px 8px; border-bottom: 1px solid #E5E5E5; font-family: 'Courier New', monospace; font-size: 10pt; color: #555;">${escapeHtml(line.line)}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #E5E5E5;">${escapeHtml(line.label)}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #E5E5E5; text-align: right; font-variant-numeric: tabular-nums;">${cents > 0 ? formatCents(cents) : "-"}</td>
    </tr>`;
  }).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Schedule C draft, ${escapeHtml(input.company.name)} ${input.taxYear}</title>
<style>
  @page { margin: 0.75in; }
  body { font-family: Georgia, "Times New Roman", serif; color: #18181B; font-size: 11pt; line-height: 1.5; }
  h1 { font-size: 16pt; margin: 0 0 4pt; color: ${cta}; }
  h2 { font-size: 12pt; margin: 18pt 0 6pt; color: ${cta}; border-bottom: 1pt solid ${cta}; padding-bottom: 3pt; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12pt; }
  table.totals { margin-top: 12pt; border-top: 2pt solid #18181B; }
  table.totals td { padding: 4pt 8pt; font-weight: bold; }
  .meta { font-size: 10pt; color: #444; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12pt; }
  .draft-badge { display: inline-block; padding: 2pt 8pt; background: #fef3c7; color: #92400e; border-radius: 4pt; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.1em; font-weight: bold; margin-bottom: 8pt; }
  .small { font-size: 9pt; color: #71717A; line-height: 1.5; }
  .signature-line { margin-top: 24pt; border-top: 1pt solid #18181B; padding-top: 3pt; font-size: 9pt; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 32pt; margin-top: 12pt; }
</style>
</head>
<body>
  <div class="header">
    <div>
      ${input.firm.logo_url ? `<img src="${escapeAttr(input.firm.logo_url)}" alt="" style="max-height: 36pt;" />` : ""}
      <div style="font-weight: bold; color: ${cta}; margin-top: 4pt;">${escapeHtml(input.firm.name)}</div>
    </div>
    <div class="meta" style="text-align: right;">
      <div>Prepared by ${escapeHtml(input.firm.name)}</div>
      <div>Tax year ${input.taxYear}</div>
      <div>Generated ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date())}</div>
    </div>
  </div>

  <div class="draft-badge">Draft, for preparer review</div>

  <h1>Schedule C, Profit or Loss From Business (Sole Proprietorship)</h1>
  <p class="meta">Form 1040 attachment. This draft is auto-populated from the client's books; the preparer must review, complete Part III/IV/V as applicable, and verify before filing.</p>

  <h2>Filing information</h2>
  <table>
    <tr>
      <td style="width: 35%; padding: 6px 8px; vertical-align: top; color: #555;">A. Principal business or profession</td>
      <td style="padding: 6px 8px;"><strong>${escapeHtml(input.company.name)}</strong></td>
    </tr>
    <tr>
      <td style="padding: 6px 8px; vertical-align: top; color: #555;">C. Business name</td>
      <td style="padding: 6px 8px;">${escapeHtml(input.company.legal_name ?? input.company.name)}</td>
    </tr>
    <tr>
      <td style="padding: 6px 8px; vertical-align: top; color: #555;">D. EIN</td>
      <td style="padding: 6px 8px; font-family: 'Courier New', monospace;">${escapeHtml(input.company.ein ?? "-")}</td>
    </tr>
    <tr>
      <td style="padding: 6px 8px; vertical-align: top; color: #555;">E. Business address</td>
      <td style="padding: 6px 8px;">${escapeHtml(
        [
          input.company.address_line_1,
          [
            input.company.address_city,
            input.company.address_region,
            input.company.address_postal_code,
          ]
            .filter(Boolean)
            .join(" "),
        ]
          .filter(Boolean)
          .join(", ") || "-",
      )}</td>
    </tr>
    <tr>
      <td style="padding: 6px 8px; vertical-align: top; color: #555;">Proprietor</td>
      <td style="padding: 6px 8px;">${escapeHtml(input.owner.full_name ?? "-")}</td>
    </tr>
    <tr>
      <td style="padding: 6px 8px; vertical-align: top; color: #555;">Proprietor SSN</td>
      <td style="padding: 6px 8px; font-family: 'Courier New', monospace;">▢▢▢, ▢▢, ▢▢▢▢ &nbsp;<span class="small">(preparer enters)</span></td>
    </tr>
  </table>

  <h2>Part I, Income</h2>
  <table>
    <tr>
      <td style="width: 12%; padding: 4pt 8pt; font-family: 'Courier New', monospace; font-size: 10pt; color: #555;">Line 1</td>
      <td style="padding: 4pt 8pt;">Gross receipts or sales</td>
      <td style="padding: 4pt 8pt; text-align: right; font-variant-numeric: tabular-nums;">${formatCents(input.income.grossReceiptsCents)}</td>
    </tr>
    <tr>
      <td style="padding: 4pt 8pt; font-family: 'Courier New', monospace; font-size: 10pt; color: #555;">Line 2</td>
      <td style="padding: 4pt 8pt;">Returns and allowances</td>
      <td style="padding: 4pt 8pt; text-align: right; font-variant-numeric: tabular-nums;">${formatCents(input.income.returnsCents)}</td>
    </tr>
    <tr style="background: #f8f6e8;">
      <td style="padding: 4pt 8pt; font-family: 'Courier New', monospace; font-size: 10pt; color: #555;">Line 3</td>
      <td style="padding: 4pt 8pt; font-weight: bold;">Subtract Line 2 from Line 1</td>
      <td style="padding: 4pt 8pt; text-align: right; font-weight: bold; font-variant-numeric: tabular-nums;">${formatCents(grossIncome)}</td>
    </tr>
    <tr>
      <td style="padding: 4pt 8pt; font-family: 'Courier New', monospace; font-size: 10pt; color: #555;">Line 4</td>
      <td style="padding: 4pt 8pt;">Cost of goods sold (Part III) <span class="small">- complete if applicable</span></td>
      <td style="padding: 4pt 8pt; text-align: right; color: #71717A;">-</td>
    </tr>
    <tr>
      <td style="padding: 4pt 8pt; font-family: 'Courier New', monospace; font-size: 10pt; color: #555;">Line 5</td>
      <td style="padding: 4pt 8pt;">Gross profit (Line 3 − Line 4)</td>
      <td style="padding: 4pt 8pt; text-align: right; font-variant-numeric: tabular-nums;">${formatCents(grossProfit)}</td>
    </tr>
    <tr>
      <td style="padding: 4pt 8pt; font-family: 'Courier New', monospace; font-size: 10pt; color: #555;">Line 6</td>
      <td style="padding: 4pt 8pt;">Other income</td>
      <td style="padding: 4pt 8pt; text-align: right; font-variant-numeric: tabular-nums;">${formatCents(input.income.otherIncomeCents)}</td>
    </tr>
    <tr style="background: #f8f6e8;">
      <td style="padding: 4pt 8pt; font-family: 'Courier New', monospace; font-size: 10pt; color: #555;">Line 7</td>
      <td style="padding: 4pt 8pt; font-weight: bold;">Gross income (Lines 5 + 6)</td>
      <td style="padding: 4pt 8pt; text-align: right; font-weight: bold; font-variant-numeric: tabular-nums;">${formatCents(totalIncomeForLine7)}</td>
    </tr>
  </table>

  <h2>Part II, Expenses</h2>
  <table>
    ${expenseRows}
    <tr style="background: #f8f6e8;">
      <td style="padding: 6px 8px; font-family: 'Courier New', monospace; font-size: 10pt; color: #555;">Line 28</td>
      <td style="padding: 6px 8px; font-weight: bold;">Total expenses</td>
      <td style="padding: 6px 8px; text-align: right; font-weight: bold; font-variant-numeric: tabular-nums;">${formatCents(totalExpenses)}</td>
    </tr>
  </table>

  <h2>Net profit or loss</h2>
  <table class="totals">
    <tr>
      <td style="font-family: 'Courier New', monospace; font-size: 10pt; color: #555;">Line 29</td>
      <td>Tentative profit or loss (Line 7 − Line 28)</td>
      <td style="text-align: right; font-variant-numeric: tabular-nums;">${formatCents(netProfit)}</td>
    </tr>
    <tr>
      <td style="font-family: 'Courier New', monospace; font-size: 10pt; color: #555;">Line 30</td>
      <td>Home office (Form 8829), preparer to compute</td>
      <td style="text-align: right; color: #71717A;">-</td>
    </tr>
    <tr style="background: ${cta}; color: #F5EDD6;">
      <td style="font-family: 'Courier New', monospace; font-size: 10pt;">Line 31</td>
      <td style="font-size: 12pt;"><strong>Net profit or (loss)</strong></td>
      <td style="text-align: right; font-size: 12pt; font-variant-numeric: tabular-nums;"><strong>${formatCents(netProfit)}</strong></td>
    </tr>
  </table>

  <div class="small" style="margin-top: 24pt;">
    <strong>Preparer checklist:</strong>
    <ul style="margin: 4pt 0 0 16pt; padding: 0;">
      <li>Confirm proprietor SSN + business start date (Line F/G).</li>
      <li>Verify the IRS business code (Schedule C instructions, page C-17).</li>
      <li>Complete Part III if cost-of-goods-sold is material.</li>
      <li>Complete Part IV if claiming car/truck expenses (or attach Form 4562 for §179).</li>
      <li>Itemize "Other expenses" (Line 27a / Part V) for any uncategorized rows.</li>
      <li>Run Form 8829 if home office deduction applies; enter result on Line 30.</li>
      <li>Confirm net profit flows to Schedule 1 (Form 1040) Line 3 and Schedule SE Line 2.</li>
    </ul>
  </div>

  <div class="grid-2">
    <div>
      <div class="signature-line">Preparer signature</div>
      <p class="small">${escapeHtml(input.preparer.full_name ?? "")}<br/>${escapeHtml(input.preparer.title ?? "")}</p>
    </div>
    <div>
      <div class="signature-line">PTIN</div>
      <p class="small">${escapeHtml(input.preparer.ptin ?? "")}</p>
    </div>
  </div>

  <p class="small" style="margin-top: 24pt;">
    Generated by Taxottic for ${escapeHtml(input.firm.name)} on ${new Intl.DateTimeFormat(
    "en-US",
    { dateStyle: "long", timeStyle: "short" },
  ).format(new Date())}. Draft only, not filed with the IRS. The
    preparer is solely responsible for the accuracy of the return.
  </p>
</body>
</html>`;

  const filename = `schedule-c-${slugify(input.company.name)}-${input.taxYear}.html`;
  return { html, filename };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
function formatCents(c: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(c / 100);
}
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
