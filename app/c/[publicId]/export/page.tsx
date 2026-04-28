import Link from "next/link";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { formatCents } from "@/lib/tax/forecast";
import { PrintActionsClient } from "@/components/PrintActionsClient";

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
  const { supabase, company } = await loadCompanyByPublicId(publicId);

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

  // Aggregate expenses by category for the summary table
  const byCategory = new Map<
    string,
    { total: number; count: number; rows: typeof expenseRows }
  >();
  for (const e of expenseRows ?? []) {
    const bucket = byCategory.get(e.category_code) ?? {
      total: 0,
      count: 0,
      rows: [] as typeof expenseRows,
    };
    bucket.total += e.amount_cents;
    bucket.count += 1;
    bucket.rows!.push(e);
    byCategory.set(e.category_code, bucket);
  }
  const orderedCategories = [...byCategory.entries()].sort(
    (a, b) => b[1].total - a[1].total,
  );

  const totalIncome = (incomeRows ?? []).reduce(
    (a, r) => a + r.amount_cents,
    0,
  );
  const totalExpense = (expenseRows ?? []).reduce(
    (a, r) => a + r.amount_cents,
    0,
  );

  const businessDisplayName = bp?.legal_name || company.name;

  return (
    <main className="export-page bg-white text-forest-900 min-h-screen">
      <div className="max-w-4xl mx-auto px-6 sm:px-10 py-8 sm:py-12">
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
        </header>

        {/* Business details */}
        <section className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <Field label="Business" value={businessDisplayName} />
          <Field label="EIN" value={bp?.ein ?? "—"} />
          <Field
            label="Address"
            value={
              [bp?.address_line1, bp?.address_line2]
                .filter(Boolean)
                .join(" ") || "—"
            }
          />
          <Field
            label="City / State / ZIP"
            value={
              [bp?.city, company.state_code, bp?.zip]
                .filter(Boolean)
                .join(", ") || "—"
            }
          />
          <Field label="Phone" value={bp?.phone ?? "—"} />
          <Field label="Email" value={bp?.business_email ?? "—"} />
          <Field
            label="Entity type"
            value={prettyEntity(company.entity_type ?? "sole_prop")}
          />
          <Field label="Primary industry" value={bp?.primary_industry ?? "—"} />
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

        {/* Totals */}
        <section className="mt-10 grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Big label="Gross income" value={formatCents(totalIncome)} />
          <Big label="Total expenses" value={formatCents(totalExpense)} />
          <Big
            label="Net business income"
            value={formatCents(Math.max(0, totalIncome - totalExpense))}
          />
        </section>

        {/* Income detail */}
        <section className="mt-10">
          <h2 className="display text-2xl text-forest-900">Income</h2>
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
                      {formatCents(r.amount_cents)}
                    </td>
                  </tr>
                ))
              )}
              <tr className="font-medium">
                <td className="py-2 pr-3" colSpan={3}>
                  Total income
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatCents(totalIncome)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Expenses by category */}
        <section className="mt-10">
          <h2 className="display text-2xl text-forest-900">
            Expenses by category
          </h2>
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
                orderedCategories.map(([code, b]) => {
                  const meta = catMap.get(code);
                  return (
                    <tr
                      key={code}
                      className="border-b border-forest-50 break-inside-avoid"
                    >
                      <td className="py-1.5 pr-3 font-medium align-top">
                        {meta?.label ?? code}
                      </td>
                      <td className="py-1.5 pr-3 align-top text-ink-soft">
                        {meta?.schedule_c_line ?? "—"}
                      </td>
                      <td className="py-1.5 pr-3 align-top text-ink-soft">
                        {meta?.irc_section ?? "—"}
                      </td>
                      <td className="py-1.5 pr-3 align-top text-ink-soft">
                        {meta?.irs_pub ?? "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatCents(b.total)}
                      </td>
                    </tr>
                  );
                })
              )}
              <tr className="font-medium">
                <td className="py-2 pr-3" colSpan={4}>
                  Total expenses
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatCents(totalExpense)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Per-line detail (each transaction). Page-break friendly. */}
        <section className="mt-10 break-before-page">
          <h2 className="display text-2xl text-forest-900">
            Expense detail (every transaction)
          </h2>
          <p className="text-xs text-ink-muted mt-1">
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
                      {formatCents(r.amount_cents)}
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
            color: #0f2d24 !important;
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

function Big({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-forest-100 rounded-xl p-4">
      <div className="text-[11px] uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div className="mt-1 display text-2xl text-forest-900">{value}</div>
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
