import Link from "next/link";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { requireBusinessManager } from "@/lib/tax/require-business-manager";
import { formatCents, ABOVE_THE_LINE_CODES } from "@/lib/tax/forecast";
import {
  computeNetBusinessIncome,
  expensesByCategory,
  MEALS_CATEGORY_CODE,
} from "@/lib/tax/net-business-income";
import { PrintActionsClient } from "@/components/PrintActionsClient";
import { CompanyLogo } from "@/components/CompanyLogo";
import { decryptField } from "@/lib/crypto/field-encryption";

type Params = Promise<{ publicId: string }>;
type Search = Promise<{ year?: string }>;

export default async function ExportPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { publicId } = await params;
  const { year } = await searchParams;
  const { supabase, company, role } = await loadCompanyByPublicId(publicId);
  requireBusinessManager(role, publicId);

  const taxYear = year ? Number(year) : new Date().getUTCFullYear();

  const [
    { data: bp },
    { data: incomeRows },
    { data: expenseRows },
    { data: categoryRows },
  ] = await Promise.all([
    supabase
      .from("business_profiles")
      .select(
        "ein, legal_name, address_line1, address_line2, city, zip, phone, business_email, primary_industry, has_employees, has_vehicle, has_home_office, vehicle_method, vehicle_business_miles, home_office_sqft, home_total_sqft",
      )
      .eq("company_id", company.id)
      .eq("tax_year", taxYear)
      .maybeSingle(),
    supabase
      .from("monthly_income")
      .select("month, amount_cents, source, notes")
      .eq("company_id", company.id)
      .eq("tax_year", taxYear)
      .order("month")
      .order("created_at"),
    supabase
      .from("monthly_expenses")
      .select("month, amount_cents, category_code, notes")
      .eq("company_id", company.id)
      .eq("tax_year", taxYear)
      .order("month")
      .order("created_at"),
    supabase
      .from("deduction_categories")
      .select("code, label, schedule_c_line, irc_section, irs_pub"),
  ]);

  const catMap = new Map<
    string,
    {
      label: string;
      schedule_c_line: string | null;
      irc_section: string | null;
      irs_pub: string | null;
    }
  >();
  for (const c of (categoryRows ?? []) as Array<{
    code: string;
    label: string;
    schedule_c_line: string | null;
    irc_section: string | null;
    irs_pub: string | null;
  }>) {
    catMap.set(c.code, {
      label: c.label,
      schedule_c_line: c.schedule_c_line,
      irc_section: c.irc_section,
      irs_pub: c.irs_pub,
    });
  }

  // Build the per-category rollup via the single source of truth
  // (`lib/tax/net-business-income.ts`). This is the same helper the
  // forecast page calls, guaranteeing that "Net business income" on
  // this export matches the headline number on /c/{id}/forecast, and
  // that Schedule C Line 24b carries the post-50% meals figure (not
  // the gross). Resolves the May 2026 audit's Critical #1 + Critical
  // #2 + High #5.
  const categoryTotals = expensesByCategory(expenseRows ?? []);
  // Sort by deductible amount (what actually goes on Schedule C),
  // descending. Above-the-line categories drop to the bottom (their
  // deductibleCents is 0 by definition, they're Schedule 1
  // adjustments, not Schedule C expenses).
  const orderedCategories = [...categoryTotals].sort(
    (a, b) => b.deductibleCents - a.deductibleCents,
  );

  const totalIncome = (incomeRows ?? []).reduce(
    (a, r) => a + r.amount_cents,
    0,
  );
  const nbi = computeNetBusinessIncome({
    incomeCents: totalIncome,
    byCategory: categoryTotals,
  });
  // "Total expenses" in the page-level summary uses the deductible
  // figure, not the gross, that's the line that has to reconcile with
  // Net Business Income. The expense-detail section below still shows
  // the gross per-row figure (footnoted) so users can audit their own
  // entries against bank/receipts.
  const totalExpense = nbi.deductibleExpensesCents;
  const totalGrossExpense = nbi.grossExpensesCents;

  const businessDisplayName = bp?.legal_name || company.name;

  return (
    <main className="export-page bg-white text-forest-900 min-h-screen">
      {/* Centered document, this page renders standalone (no app rail), so it
          reads like a proper letter-width workpaper a CPA can print, not a
          full-bleed app screen. */}
      <div className="mx-auto max-w-4xl px-5 sm:px-10 py-8 sm:py-12">
        {/* Top toolbar - hidden on print */}
        <div className="no-print mb-8 flex items-center justify-between gap-3 flex-wrap">
          <Link
            href={`/c/${publicId}/forecast`}
            className="text-sm text-ink-soft hover:text-forest-800"
          >
            &larr; Back to forecast
          </Link>
          <div className="flex items-center gap-2 flex-wrap">
            <PrintButton />
            <Link
              href={`/c/${publicId}/profile`}
              className="btn-ghost text-sm h-10 px-4"
            >
              Edit business details
            </Link>
          </div>
        </div>

        {/* Hero / brand-and-philosophy block (visible on print too, abbreviated) */}
        <header className="border-b border-forest-100 pb-6 print:pb-4">
          <div className="flex items-start gap-5">
            <CompanyLogo
              src={company.logo_url}
              name={businessDisplayName}
              size={72}
              print
            />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-[0.25em] text-gold-700">
                Year-end summary - Tax year {taxYear}
              </div>
              <h1
                className="display mt-1 text-3xl sm:text-4xl text-forest-900"
                style={{ fontFamily: "var(--font-fraunces)" }}
              >
                {businessDisplayName}
              </h1>
              <p className="mt-3 text-sm text-ink-soft max-w-2xl leading-relaxed">
                Walk into your CPA confident, not anxious. Your business comes
                first - the tax code allows it. This summary captures every income
                entry and deductible expense logged for {taxYear} so your preparer
                can do their job without guessing.
              </p>
            </div>
          </div>
        </header>

        {/* Business details */}
        <section className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <Field label="Business" value={businessDisplayName} />
          <Field label="EIN" value={decryptField(bp?.ein) ?? "-"} />
          <Field
            label="Address"
            value={
              [bp?.address_line1, bp?.address_line2]
                .filter(Boolean)
                .join(" ") || "-"
            }
          />
          <Field
            label="City / State / ZIP"
            value={
              [bp?.city, company.state_code, bp?.zip]
                .filter(Boolean)
                .join(", ") || "-"
            }
          />
          <Field label="Phone" value={bp?.phone ?? "-"} />
          <Field label="Email" value={bp?.business_email ?? "-"} />
          <Field
            label="Entity type"
            value={prettyEntity(company.entity_type ?? "sole_prop")}
          />
          <Field label="Primary industry" value={bp?.primary_industry ?? "-"} />
          <Field
            label="Has W-2 employees"
            value={bp?.has_employees ? "Yes" : "No"}
          />
          <Field
            label="Vehicle for business"
            value={
              bp?.has_vehicle
                ? `Yes (${bp?.vehicle_method ?? "method not set"}${
                    bp?.vehicle_business_miles
                      ? `, ${bp.vehicle_business_miles} business miles`
                      : ""
                  })`
                : "No"
            }
          />
          <Field
            label="Home office"
            value={
              bp?.has_home_office
                ? `Yes (${bp?.home_office_sqft ?? "?"} of ${bp?.home_total_sqft ?? "?"} sq ft)`
                : "No"
            }
          />
        </section>

        {/* Schedule C reconciliation, the tax-ready headline. Maps the
            logged totals straight onto the Schedule C (Form 1040) lines a
            preparer transcribes, so the handoff is transcribe-not-interpret.
            "Total expenses" is the *deductible* figure (meals halved per IRC
            §274(n)); the footnote surfaces the gross gap when it differs. */}
        <section className="mt-10">
          <div className="text-[10px] uppercase tracking-[0.25em] text-gold-700">
            Schedule C (Form 1040) · reconciliation
          </div>
          <div className="mt-3 overflow-hidden rounded-2xl border border-forest-200">
            <ReconRow
              line="Line 1"
              label="Gross receipts or sales"
              value={formatCents(totalIncome)}
            />
            <ReconRow
              line="Line 28"
              label="Total expenses"
              value={formatCents(totalExpense)}
              note={
                totalGrossExpense !== totalExpense
                  ? `Logged ${formatCents(totalGrossExpense)} gross · ${formatCents(
                      totalGrossExpense - totalExpense,
                    )} of meals non-deductible per IRC §274(n)`
                  : undefined
              }
            />
            <ReconRow
              line="Line 31"
              label={
                nbi.netBusinessIncomeCents < 0
                  ? "Net loss"
                  : "Net profit"
              }
              value={formatCents(nbi.netBusinessIncomeCents)}
              emphasis
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
            Net profit also carries to Schedule 1, Line 3 and Schedule SE
            (self-employment tax). Figures are the owner-entered totals for{" "}
            {taxYear}; your preparer confirms final placement.
          </p>
        </section>

        {/* Income detail */}
        <section className="mt-10">
          <SectionTitle n="01" title="Income" />
          <table className="mt-3 w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-forest-100 text-left text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="py-2 pr-3">Month</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">Notes</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(incomeRows ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-3 text-ink-muted">
                    No income entries.
                  </td>
                </tr>
              ) : (
                (incomeRows ?? []).map((r, i) => (
                  <tr
                    key={i}
                    className="border-b border-forest-50 break-inside-avoid"
                  >
                    <td className="py-1.5 pr-3 align-top">
                      {monthLabel(r.month)}
                    </td>
                    <td className="py-1.5 pr-3 align-top">
                      {prettySource(r.source)}
                    </td>
                    <td className="py-1.5 pr-3 align-top text-ink-soft">
                      {r.notes ?? ""}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {/* Cents on individual rows, audit Medium #1.
                          A user looking at "$7,501" cannot tell if their
                          $7,500.50 entry was saved or rounded. Per-line
                          gets full precision; the page-top rollup keeps
                          whole-dollar formatting. */}
                      {formatCents(r.amount_cents, { showCents: true })}
                    </td>
                  </tr>
                ))
              )}
              <tr className="font-semibold border-t-2 border-forest-200 bg-cream/40">
                <td className="py-2.5 pr-3" colSpan={3}>
                  Total income
                </td>
                <td className="py-2.5 text-right tabular-nums">
                  {formatCents(totalIncome, { showCents: true })}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Expenses by category */}
        <section className="mt-10">
          <SectionTitle n="02" title="Expenses by category" />
          <table className="mt-3 w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-forest-100 text-left text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3">Schedule C</th>
                <th className="py-2 pr-3">IRC</th>
                <th className="py-2 pr-3">Pub</th>
                <th className="py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {orderedCategories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-3 text-ink-muted">
                    No expenses logged.
                  </td>
                </tr>
              ) : (
                orderedCategories.map((b) => {
                  const meta = catMap.get(b.code);
                  const isMeals = b.code === MEALS_CATEGORY_CODE;
                  const isAboveTheLine = ABOVE_THE_LINE_CODES.has(b.code);
                  return (
                    <tr
                      key={b.code}
                      className="border-b border-forest-50 break-inside-avoid"
                    >
                      <td className="py-1.5 pr-3 font-medium align-top">
                        {meta?.label ?? b.code}
                        {isMeals ? (
                          <div className="text-[10px] text-ink-muted font-normal mt-0.5">
                            Logged {formatCents(b.grossCents)} gross · 50%
                            deductible per IRC §274(n)
                          </div>
                        ) : null}
                        {isAboveTheLine ? (
                          <div className="text-[10px] text-ink-muted font-normal mt-0.5">
                            Above-the-line (Schedule 1), not Schedule C.
                            Tracked but excluded from this total.
                          </div>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3 align-top text-ink-soft">
                        {meta?.schedule_c_line ?? "-"}
                      </td>
                      <td className="py-1.5 pr-3 align-top text-ink-soft">
                        {meta?.irc_section ?? "-"}
                      </td>
                      <td className="py-1.5 pr-3 align-top text-ink-soft">
                        {meta?.irs_pub ?? "-"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {isAboveTheLine
                          ? formatCents(b.grossCents, { showCents: true })
                          : formatCents(b.deductibleCents, {
                              showCents: true,
                            })}
                      </td>
                    </tr>
                  );
                })
              )}
              <tr className="font-semibold border-t-2 border-forest-200 bg-cream/40">
                <td className="py-2.5 pr-3" colSpan={4}>
                  Total deductible expenses
                </td>
                <td className="py-2.5 text-right tabular-nums">
                  {formatCents(totalExpense, { showCents: true })}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Per-line detail (each transaction). Page-break friendly. */}
        <section className="mt-10 break-before-page">
          <SectionTitle n="03" title="Expense detail" hint="Every transaction" />
          <p className="text-xs text-ink-muted mt-2">
            Sorted by month. Notes carry over from the original entry.
          </p>
          <table className="mt-3 w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-forest-100 text-left text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="py-2 pr-3">Month</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3">Notes</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(expenseRows ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-3 text-ink-muted">
                    No expenses logged.
                  </td>
                </tr>
              ) : (
                (expenseRows ?? []).map((r, i) => (
                  <tr
                    key={i}
                    className="border-b border-forest-50 break-inside-avoid"
                  >
                    <td className="py-1.5 pr-3 align-top">
                      {monthLabel(r.month)}
                    </td>
                    <td className="py-1.5 pr-3 align-top">
                      {catMap.get(r.category_code)?.label ?? r.category_code}
                    </td>
                    <td className="py-1.5 pr-3 align-top text-ink-soft">
                      {r.notes ?? ""}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {/* Gross figure, what the user actually spent.
                          The 50% meals haircut is applied at the
                          category-rollup level (above) and visible in
                          the "Logged X / 50% deductible" footnote. */}
                      {formatCents(r.amount_cents, { showCents: true })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <footer className="mt-12 pt-6 border-t border-forest-100 text-[11px] leading-relaxed text-ink-muted">
          <p>
            Prepared by Taxottic from data the business owner entered. This
            summary is informational and is not a tax return. Citations
            reference the Internal Revenue Code (IRC) and IRS Publications;
            confirm specifics with your CPA.
          </p>
          <p className="mt-1.5">
            taxottic.com - generated{" "}
            {new Date().toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </footer>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          /* Tighter spacing for paper */
          .export-page { font-size: 11px; }
          /* Ensure dark text */
          .export-page, .export-page * {
            color: #1d2843 !important;
            background: white !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

// Numbered section header, gives the workpaper a clean, scannable "01 / 02
// / 03" spine and a consistent baseline rule under each title.
function SectionTitle({
  n,
  title,
  hint,
}: {
  n: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline gap-3 border-b border-forest-200 pb-2">
      <span className="text-[11px] font-semibold tabular-nums text-gold-700">
        {n}
      </span>
      <h2 className="display text-2xl text-forest-900">{title}</h2>
      {hint ? (
        <span className="ml-auto text-[11px] uppercase tracking-wide text-ink-muted">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

// A single Schedule C reconciliation line: form line ref, label, right-aligned
// amount, optional footnote. The emphasised row (net profit/loss) gets a warm
// cream band + heavier numerals so the eye lands on the bottom line.
function ReconRow({
  line,
  label,
  value,
  note,
  emphasis = false,
}: {
  line: string;
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        "flex items-baseline gap-3 px-4 py-3 border-b border-forest-100 last:border-b-0 " +
        (emphasis ? "bg-cream/60" : "")
      }
    >
      <span className="w-16 shrink-0 text-[11px] font-medium tabular-nums text-gold-700">
        {line}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={
            emphasis
              ? "text-sm font-semibold text-forest-900"
              : "text-sm text-forest-900"
          }
        >
          {label}
        </div>
        {note ? (
          <div className="mt-0.5 text-[10px] leading-snug text-ink-muted">
            {note}
          </div>
        ) : null}
      </div>
      <div
        className={
          "shrink-0 text-right tabular-nums " +
          (emphasis
            ? "display text-xl text-forest-900"
            : "text-base text-forest-900")
        }
      >
        {value}
      </div>
    </div>
  );
}

function PrintButton() {
  return <PrintActionsClient />;
}

function monthLabel(m: number): string {
  return [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][m - 1] ?? String(m);
}

function prettySource(s: string): string {
  return (
    {
      sales: "Sales",
      services: "Services",
      wages_w2: "W-2 wages",
      interest: "Interest",
      dividends: "Dividends",
      rental: "Rental",
      royalty: "Royalty",
      other: "Other",
    }[s] ?? s
  );
}

function prettyEntity(t: string): string {
  return (
    {
      sole_prop: "Sole Proprietor",
      single_llc: "Single-Member LLC",
      multi_llc: "Multi-Member LLC",
      s_corp: "S-Corp",
      c_corp: "C-Corp",
      partnership: "Partnership",
      self_employed_1099: "1099 / Self-Employed",
    }[t] ?? t
  );
}
