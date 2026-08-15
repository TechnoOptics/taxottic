// 1099-NEC and 1099-MISC generators.
//
// 1099-NEC (Nonemployee Compensation) is the most common: reports
// non-employee payments to a contractor at or above the section 6041
// reporting threshold for that tax year. That threshold is NOT a
// constant: OBBBA section 70433 raised it from $600 to $2,000 for
// payments after 2025-12-31, and it inflation-adjusts from 2027, so
// it is always read from getTaxYearConstants(taxYear). The payer
// (the company) issues one 1099-NEC per recipient to the recipient,
// the IRS, and the state.
//
// 1099-MISC (Miscellaneous Income) reports rents, royalties, prizes,
// medical/health payments, and a handful of less common items.
//
// What this generator DOES for v1:
//   - 1099-NEC: roll up `monthly_expenses.contract_labor` payments
//     by recipient (grouped on the `notes` field, which we treat as
//     the recipient identifier). The preparer reviews + corrects
//     the grouping before filing.
//   - 1099-MISC: roll up rent payments + royalties paid out.
//
// What's deferred:
//   - State copy + state-specific variant rules
//   - Form 1096 transmittal cover sheet
//   - Recipient TIN (SSN/EIN) collection, the preparer types
//     this on the form before filing

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getTaxYearConstants,
  LATEST_PUBLISHED_YEAR as LATEST_PUBLISHED_TAX_YEAR,
} from "@/lib/tax/constants";

export type Form1099Variant = "1099-NEC" | "1099-MISC";

export type Form1099Recipient = {
  /** Display name pulled from the expense notes / vendor list. */
  name: string;
  /** Total paid in cents during the tax year. */
  total_cents: number;
  /** Which Schedule C line we sourced from (signal for the
   *  preparer that we grouped these correctly). */
  source_category: string;
};

export type Form1099Input = {
  variant: Form1099Variant;
  firm: { name: string; accent_color: string | null; logo_url: string | null };
  payer: {
    /** The company issuing the 1099, i.e., who paid the recipient. */
    name: string;
    legal_name: string | null;
    ein: string | null;
    address_line_1: string | null;
    address_city: string | null;
    address_region: string | null;
    address_postal_code: string | null;
    phone: string | null;
  };
  taxYear: number;
  recipients: Form1099Recipient[];
  /** Box-by-box totals. For 1099-NEC, only Box 1 (Nonemployee
   *  compensation) is populated; the other boxes are blank. */
  preparer: { full_name: string | null; ptin: string | null };
};

/**
 * Aggregate contract-labor payments per recipient for 1099-NEC.
 * Recipient identification comes from the `notes` field (the
 * vendor name typed when the expense was logged). If multiple
 * spellings of the same vendor exist, the preparer fixes the
 * grouping post-generation.
 */
export async function loadNECRecipients(
  admin: SupabaseClient,
  companyId: string,
  taxYear: number,
): Promise<Form1099Recipient[]> {
  const { data } = await admin
    .from("monthly_expenses")
    .select("amount_cents, notes, category_code")
    .eq("company_id", companyId)
    .eq("tax_year", taxYear)
    .eq("category_code", "contract_labor");

  return rollupByRecipient(data ?? [], "Contract labor", taxYear);
}

/**
 * Aggregate rent + royalty payments for 1099-MISC.
 */
export async function loadMISCRecipients(
  admin: SupabaseClient,
  companyId: string,
  taxYear: number,
): Promise<{ rents: Form1099Recipient[]; royalties: Form1099Recipient[] }> {
  const [{ data: rents }, { data: royalties }] = await Promise.all([
    admin
      .from("monthly_expenses")
      .select("amount_cents, notes, category_code")
      .eq("company_id", companyId)
      .eq("tax_year", taxYear)
      .in("category_code", ["rent_property", "rent_equipment"]),
    admin
      .from("monthly_expenses")
      .select("amount_cents, notes, category_code")
      .eq("company_id", companyId)
      .eq("tax_year", taxYear)
      .eq("category_code", "royalties_paid"),
  ]);
  return {
    rents: rollupByRecipient(rents ?? [], "Rent", taxYear),
    royalties: rollupByRecipient(royalties ?? [], "Royalties", taxYear),
  };
}

/**
 * The reporting threshold is READ FROM THE TAX YEAR, never hardcoded.
 *
 * This filtered at a literal 60_000 cents ($600) while
 * INFO_REPORTING_THRESHOLD_CENTS for 2026 is 200_000 ($2,000): OBBBA
 * section 70433 raised the long-standing section 6041 threshold for
 * payments made after 2025-12-31. So a firm generating 2026 forms got a
 * 1099-NEC draft for every contractor paid $600 to $1,999, none of whom
 * require one.
 *
 * Threading the year through matters beyond this one change: the
 * threshold is inflation-adjusted from 2027, so a hardcoded number is
 * wrong again every year from here.
 */
function reportingThresholdCents(taxYear: number): number {
  return getTaxYearConstants(taxYear).INFO_REPORTING_THRESHOLD_CENTS;
}

function rollupByRecipient(
  rows: Array<{ amount_cents: number | null; notes: string | null }>,
  sourceCategory: string,
  taxYear: number,
): Form1099Recipient[] {
  const byName = new Map<string, number>();
  for (const r of rows) {
    const name = (r.notes ?? "").trim();
    if (!name) continue;
    byName.set(name, (byName.get(name) ?? 0) + (r.amount_cents ?? 0));
  }
  return Array.from(byName.entries())
    .map(([name, total_cents]) => ({
      name,
      total_cents,
      source_category: sourceCategory,
    }))
    .filter((r) => r.total_cents >= reportingThresholdCents(taxYear))
    .sort((a, b) => b.total_cents - a.total_cents);
}

export function render1099HTML(
  input: Form1099Input,
  recipient: Form1099Recipient,
  /** Which 1099-MISC box to populate when variant === '1099-MISC'.
   *  Defaults to Box 1 (Rents). */
  miscBox: "rents" | "royalties" = "rents",
): { html: string; filename: string } {
  const cta = input.firm.accent_color || "#1d2843";
  const isNec = input.variant === "1099-NEC";

  // NEC has a single box; MISC has many.
  const necBox1 = isNec ? recipient.total_cents : 0;
  const miscRents = !isNec && miscBox === "rents" ? recipient.total_cents : 0;
  const miscRoyalties = !isNec && miscBox === "royalties" ? recipient.total_cents : 0;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${input.variant} draft, ${escapeHtml(recipient.name)} (${input.taxYear})</title>
<style>
  @page { margin: 0.75in; }
  body { font-family: Georgia, "Times New Roman", serif; color: #18181B; font-size: 11pt; line-height: 1.5; }
  h1 { font-size: 14pt; margin: 0 0 4pt; color: ${cta}; }
  .draft-badge { display: inline-block; padding: 2pt 8pt; background: #fef3c7; color: #92400e; border-radius: 4pt; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.1em; font-weight: bold; margin-bottom: 8pt; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12pt; }
  .meta { font-size: 10pt; color: #444; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18pt; margin-bottom: 12pt; }
  .box { border: 1pt solid #18181B; padding: 8pt; min-height: 36pt; }
  .box label { display: block; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.05em; color: #555; }
  .box value { display: block; margin-top: 2pt; font-weight: bold; font-size: 12pt; }
  .amount-box { text-align: right; font-variant-numeric: tabular-nums; }
  .small { font-size: 9pt; color: #71717A; line-height: 1.5; }
</style>
</head>
<body>
  <div class="header">
    <div>
      ${input.firm.logo_url ? `<img src="${escapeAttr(input.firm.logo_url)}" alt="" style="max-height: 36pt;" />` : ""}
      <div style="font-weight: bold; color: ${cta};">${escapeHtml(input.firm.name)}</div>
    </div>
    <div class="meta" style="text-align: right;">
      <div>Form ${input.variant}, Tax year ${input.taxYear}</div>
      <div>Generated ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date())}</div>
    </div>
  </div>

  <div class="draft-badge">Draft, for preparer review</div>
  <h1>${escapeHtml(input.variant)}, ${isNec ? "Nonemployee Compensation" : "Miscellaneous Information"}</h1>
  <p class="meta">Source: ${escapeHtml(recipient.source_category)} payments aggregated by recipient name.</p>

  <div class="grid-2">
    <div class="box">
      <label>Payer's name + address</label>
      <value>${escapeHtml(input.payer.legal_name ?? input.payer.name)}<br/>${escapeHtml(
        [
          input.payer.address_line_1,
          [
            input.payer.address_city,
            input.payer.address_region,
            input.payer.address_postal_code,
          ]
            .filter(Boolean)
            .join(" "),
        ]
          .filter(Boolean)
          .join(", "),
      )}${input.payer.phone ? `<br/>${escapeHtml(input.payer.phone)}` : ""}</value>
    </div>
    <div class="box">
      <label>Payer's TIN</label>
      <value style="font-family: 'Courier New', monospace;">${escapeHtml(input.payer.ein ?? "-")}</value>
    </div>
    <div class="box">
      <label>Recipient's name + address</label>
      <value>${escapeHtml(recipient.name)}<br/><span class="small">Preparer: confirm address before mailing the recipient copy.</span></value>
    </div>
    <div class="box">
      <label>Recipient's TIN (SSN / EIN)</label>
      <value style="font-family: 'Courier New', monospace;">▢▢▢, ▢▢, ▢▢▢▢ &nbsp;<span class="small">(preparer enters)</span></value>
    </div>
  </div>

  ${
    isNec
      ? `
  <table style="width: 100%; border-collapse: collapse; margin-top: 8pt;">
    <tr>
      <td class="box" style="width: 50%;">
        <label>Box 1. Nonemployee compensation</label>
        <value class="amount-box">${formatCents(necBox1)}</value>
      </td>
      <td class="box" style="width: 50%;">
        <label>Box 4. Federal income tax withheld</label>
        <value class="amount-box">$ 0.00 <span class="small">(preparer: if any backup withholding)</span></value>
      </td>
    </tr>
  </table>`
      : `
  <table style="width: 100%; border-collapse: collapse; margin-top: 8pt;">
    <tr>
      <td class="box" style="width: 50%;">
        <label>Box 1. Rents</label>
        <value class="amount-box">${formatCents(miscRents)}</value>
      </td>
      <td class="box" style="width: 50%;">
        <label>Box 2. Royalties</label>
        <value class="amount-box">${formatCents(miscRoyalties)}</value>
      </td>
    </tr>
    <tr>
      <td class="box">
        <label>Box 3. Other income</label>
        <value class="amount-box">-</value>
      </td>
      <td class="box">
        <label>Box 4. Federal income tax withheld</label>
        <value class="amount-box">-</value>
      </td>
    </tr>
  </table>`
  }

  <div class="small" style="margin-top: 24pt;">
    <strong>Preparer checklist:</strong>
    <ul style="margin: 4pt 0 0 16pt; padding: 0;">
      <li>Verify recipient TIN via Form W-9 on file (mandatory before filing).</li>
      <li>Confirm the ${formatWholeDollars(reportingThresholdCents(input.taxYear))} section 6041 reporting threshold is met for ${input.taxYear}.${
        getTaxYearConstants(input.taxYear).isFallback
          ? ` <strong>This is the ${LATEST_PUBLISHED_TAX_YEAR} figure carried forward: Taxottic does not yet have published ${input.taxYear} numbers, and this threshold inflation-adjusts annually. Verify against the IRS before filing.</strong>`
          : ""
      }</li>
      <li>Check whether recipient is exempt (corporations are exempt from 1099-NEC).</li>
      <li>Issue Copy B to recipient by January 31; Copy A to IRS via FIRE or paper Form 1096 by the same date.</li>
      <li>If state copy required (most states piggyback the IRS combined-federal-state-filing program), confirm participation.</li>
    </ul>
  </div>

  <p class="small" style="margin-top: 24pt;">
    Generated by Taxottic for ${escapeHtml(input.firm.name)}. Draft only -
    not filed with the IRS. The preparer is solely responsible for
    the accuracy of the return.
  </p>
</body>
</html>`;

  const filename = `${input.variant.toLowerCase()}-${slugify(recipient.name)}-${input.taxYear}.html`;
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
/** Thresholds are whole dollars, so "$2,000" reads better than "$2,000.00". */
function formatWholeDollars(c: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(c / 100);
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
