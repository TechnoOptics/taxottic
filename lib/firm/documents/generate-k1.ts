// Schedule K-1 generator. Two flavors:
//
//   - Form 1065 K-1 (Partnership): distributive share of income,
//     deductions, credits, foreign transactions per partner.
//   - Form 1120-S K-1 (S-Corp): same shape but per shareholder.
//
// Both report each partner's / shareholder's pro-rata slice of the
// entity's results. The generator reads the company's books for
// the tax year, splits totals by ownership %, and produces one
// HTML draft per partner/shareholder.
//
// What's automated:
//   - Ordinary business income (Line 1 of either K-1)
//   - Net rental income, interest, dividends (Lines 2/5/6)
//   - §179 deduction (Line 12)
//   - Self-employment earnings — partnership only (Line 14a)
//
// What's left to the preparer:
//   - Capital account analysis (Item L on Partnership K-1)
//   - Partner/shareholder share of liabilities
//   - Special allocations
//   - Foreign transactions
//   - Multi-class S-Corp shareholder vote rights

import type { SupabaseClient } from "@supabase/supabase-js";

export type K1Variant = "partnership" | "s_corp";

export type K1Partner = {
  /** Name of the partner / shareholder (entity or person). */
  name: string;
  /** Tax-id placeholder; the preparer fills in the real value. */
  tin_placeholder?: string;
  /** Ownership percentage as a decimal 0-1 (0.25 = 25%). */
  ownership_pct: number;
  /** Address fields (kept loose to allow international partners). */
  address?: string | null;
  /** General vs limited partner flag (partnership only). */
  partner_type?: "general" | "limited";
};

export type K1Input = {
  variant: K1Variant;
  firm: { name: string; accent_color: string | null; logo_url: string | null };
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
  /** Aggregated entity-level numbers (in cents). */
  totals: {
    ordinary_business_income_cents: number;
    net_rental_real_estate_income_cents: number;
    other_rental_income_cents: number;
    interest_income_cents: number;
    ordinary_dividends_cents: number;
    qualified_dividends_cents: number;
    royalties_cents: number;
    section_179_deduction_cents: number;
    /** Partnership only: SE earnings (net earnings from self-employment). */
    se_earnings_cents: number;
  };
  partners: K1Partner[];
  preparer: { full_name: string | null; ptin: string | null };
};

const ENTITY_HEADER: Record<K1Variant, string> = {
  partnership:
    "Schedule K-1 (Form 1065) — Partner's Share of Income, Deductions, Credits, etc.",
  s_corp:
    "Schedule K-1 (Form 1120-S) — Shareholder's Share of Income, Deductions, Credits, etc.",
};

export async function loadK1Data(
  admin: SupabaseClient,
  companyId: string,
  taxYear: number,
): Promise<K1Input["totals"]> {
  const [{ data: income }, { data: expenses }] = await Promise.all([
    admin
      .from("monthly_income")
      .select("amount_cents, source")
      .eq("company_id", companyId)
      .eq("tax_year", taxYear),
    admin
      .from("monthly_expenses")
      .select(
        "amount_cents, category_code, category:deduction_categories(schedule_c_line)",
      )
      .eq("company_id", companyId)
      .eq("tax_year", taxYear),
  ]);

  // Income by source.
  let services = 0;
  let sales = 0;
  let rental = 0;
  let royalty = 0;
  let interest = 0;
  let dividends = 0;
  for (const r of income ?? []) {
    const cents = r.amount_cents ?? 0;
    switch (r.source) {
      case "services":
        services += cents;
        break;
      case "sales":
        sales += cents;
        break;
      case "rental":
        rental += cents;
        break;
      case "royalty":
        royalty += cents;
        break;
      case "interest":
        interest += cents;
        break;
      case "dividends":
        dividends += cents;
        break;
      default:
        services += cents;
    }
  }

  // Expense rollup — for K-1 we only need the totals that feed
  // ordinary business income (everything that hits Schedule C
  // Lines 8-26) and §179 (Line 13).
  let ordinaryExpense = 0;
  let section179 = 0;
  for (const e of expenses ?? []) {
    const line =
      (e as unknown as { category?: { schedule_c_line: string | null } }).category
        ?.schedule_c_line ?? null;
    const cents = e.amount_cents ?? 0;
    if (!line) continue;
    if (line === "Line 13") section179 += cents;
    if (line && line !== "Line 13") ordinaryExpense += cents;
  }

  const ordinaryBusinessIncome = services + sales - ordinaryExpense - section179;

  return {
    ordinary_business_income_cents: ordinaryBusinessIncome,
    net_rental_real_estate_income_cents: rental,
    other_rental_income_cents: 0,
    interest_income_cents: interest,
    ordinary_dividends_cents: dividends,
    qualified_dividends_cents: 0,
    royalties_cents: royalty,
    section_179_deduction_cents: section179,
    // Partnership: SE earnings = ordinary biz income × 0.9235 (the
    // 92.35% SE-base haircut). S-Corp: SE doesn't apply at the
    // entity level.
    se_earnings_cents: Math.max(0, Math.floor(ordinaryBusinessIncome * 0.9235)),
  };
}

export function renderK1HTML(input: K1Input, partner: K1Partner): {
  html: string;
  filename: string;
} {
  const cta = input.firm.accent_color || "#0F2D24";
  const pct = partner.ownership_pct;
  const share = (cents: number) => Math.round(cents * pct);
  const isPartnership = input.variant === "partnership";

  // Partner / shareholder share lines.
  const ordinaryBI = share(input.totals.ordinary_business_income_cents);
  const rentalRE = share(input.totals.net_rental_real_estate_income_cents);
  const interest = share(input.totals.interest_income_cents);
  const dividends = share(input.totals.ordinary_dividends_cents);
  const royalties = share(input.totals.royalties_cents);
  const section179 = share(input.totals.section_179_deduction_cents);
  const seEarnings = isPartnership
    ? share(input.totals.se_earnings_cents)
    : 0;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>K-1 draft — ${escapeHtml(partner.name)} (${escapeHtml(input.company.name)} ${input.taxYear})</title>
<style>
  @page { margin: 0.75in; }
  body { font-family: Georgia, "Times New Roman", serif; color: #18181B; font-size: 11pt; line-height: 1.5; }
  h1 { font-size: 14pt; margin: 0 0 4pt; color: ${cta}; }
  h2 { font-size: 11pt; margin: 18pt 0 6pt; color: ${cta}; border-bottom: 1pt solid ${cta}; padding-bottom: 3pt; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12pt; }
  td { padding: 4pt 8pt; border-bottom: 1px solid #E5E5E5; vertical-align: top; }
  .line { font-family: 'Courier New', monospace; font-size: 10pt; color: #555; width: 12%; }
  .label { width: 60%; }
  .amount { text-align: right; font-variant-numeric: tabular-nums; }
  .draft-badge { display: inline-block; padding: 2pt 8pt; background: #fef3c7; color: #92400e; border-radius: 4pt; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.1em; font-weight: bold; margin-bottom: 8pt; }
  .meta { font-size: 10pt; color: #444; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12pt; }
  .small { font-size: 9pt; color: #71717A; line-height: 1.5; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24pt; margin-bottom: 12pt; }
  .info-grid > div { padding: 8pt; border: 1pt solid #E5E5E5; border-radius: 4pt; }
  .info-grid label { display: block; font-size: 9pt; color: #71717A; text-transform: uppercase; letter-spacing: 0.1em; }
  .info-grid value { display: block; margin-top: 2pt; font-weight: bold; }
</style>
</head>
<body>
  <div class="header">
    <div>
      ${input.firm.logo_url ? `<img src="${escapeAttr(input.firm.logo_url)}" alt="" style="max-height: 36pt;" />` : ""}
      <div style="font-weight: bold; color: ${cta};">${escapeHtml(input.firm.name)}</div>
    </div>
    <div class="meta" style="text-align: right;">
      <div>${isPartnership ? "Form 1065" : "Form 1120-S"} — Tax year ${input.taxYear}</div>
      <div>Generated ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date())}</div>
    </div>
  </div>

  <div class="draft-badge">Draft — for preparer review</div>

  <h1>${ENTITY_HEADER[input.variant]}</h1>
  <p class="meta">${pct === 1 ? "100% allocation" : `${(pct * 100).toFixed(2)}% allocation`} of entity-level results.</p>

  <h2>Part I — Information About the ${isPartnership ? "Partnership" : "Corporation"}</h2>
  <div class="info-grid">
    <div>
      <label>A. ${isPartnership ? "Partnership" : "Corporation"} EIN</label>
      <value>${escapeHtml(input.company.ein ?? "—")}</value>
    </div>
    <div>
      <label>B. Name, address</label>
      <value>${escapeHtml(input.company.legal_name ?? input.company.name)}<br/>${escapeHtml(
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
          .join(", "),
      )}</value>
    </div>
  </div>

  <h2>Part II — Information About the ${isPartnership ? "Partner" : "Shareholder"}</h2>
  <div class="info-grid">
    <div>
      <label>E. ${isPartnership ? "Partner" : "Shareholder"} name</label>
      <value>${escapeHtml(partner.name)}</value>
    </div>
    <div>
      <label>F. Tax ID</label>
      <value style="font-family: 'Courier New', monospace;">${escapeHtml(partner.tin_placeholder ?? "▢▢▢ – ▢▢ – ▢▢▢▢")}</value>
    </div>
    ${partner.address ? `<div><label>G. Address</label><value>${escapeHtml(partner.address)}</value></div>` : ""}
    ${
      isPartnership
        ? `<div><label>H. Type</label><value>${partner.partner_type === "limited" ? "Limited" : "General"} partner</value></div>`
        : ""
    }
    <div>
      <label>J. ${isPartnership ? "Profit / loss / capital share" : "Stock ownership"}</label>
      <value>${(pct * 100).toFixed(4)}%</value>
    </div>
  </div>

  <h2>Part III — ${isPartnership ? "Partner's" : "Shareholder's"} Share of Current-Year Income, Deductions, Credits, and Other Items</h2>
  <table>
    <tr>
      <td class="line">Line 1</td>
      <td class="label">Ordinary business income (loss)</td>
      <td class="amount">${formatCents(ordinaryBI)}</td>
    </tr>
    <tr>
      <td class="line">Line 2</td>
      <td class="label">Net rental real estate income (loss)</td>
      <td class="amount">${rentalRE !== 0 ? formatCents(rentalRE) : "—"}</td>
    </tr>
    <tr>
      <td class="line">Line 5</td>
      <td class="label">Interest income</td>
      <td class="amount">${interest !== 0 ? formatCents(interest) : "—"}</td>
    </tr>
    <tr>
      <td class="line">Line 6a</td>
      <td class="label">Ordinary dividends</td>
      <td class="amount">${dividends !== 0 ? formatCents(dividends) : "—"}</td>
    </tr>
    <tr>
      <td class="line">Line 7</td>
      <td class="label">Royalties</td>
      <td class="amount">${royalties !== 0 ? formatCents(royalties) : "—"}</td>
    </tr>
    <tr>
      <td class="line">Line 12</td>
      <td class="label">Section 179 deduction</td>
      <td class="amount">${section179 !== 0 ? formatCents(section179) : "—"}</td>
    </tr>
    ${
      isPartnership
        ? `<tr>
            <td class="line">Line 14a</td>
            <td class="label">Net earnings from self-employment</td>
            <td class="amount">${seEarnings !== 0 ? formatCents(seEarnings) : "—"}</td>
          </tr>`
        : ""
    }
  </table>

  <div class="small" style="margin-top: 24pt;">
    <strong>Preparer checklist:</strong>
    <ul style="margin: 4pt 0 0 16pt; padding: 0;">
      <li>Confirm ${isPartnership ? "partner" : "shareholder"} tax ID and address.</li>
      ${
        isPartnership
          ? `<li>Complete Item L: Partner's capital account analysis (beginning, contributions, distributions, ending).</li>
             <li>Complete Item K: share of liabilities (recourse, nonrecourse, qualified nonrecourse).</li>`
          : `<li>Verify the shareholder is a US-resident individual (S-Corp eligibility).</li>
             <li>Confirm a single class of stock (S-Corp eligibility).</li>`
      }
      <li>Add Box 16/17 entries for foreign transactions if applicable.</li>
      <li>If a special allocation applies, override the pro-rata split before filing.</li>
      <li>Run Schedule K-3 separately for foreign-tax / international items.</li>
    </ul>
  </div>

  <p class="small" style="margin-top: 24pt;">
    Generated by Taxottic for ${escapeHtml(input.firm.name)}. Draft only —
    not filed with the IRS. The preparer is solely responsible for the
    accuracy of the return.
  </p>
</body>
</html>`;

  const filename = `k1-${slugify(partner.name)}-${slugify(input.company.name)}-${input.taxYear}.html`;
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
