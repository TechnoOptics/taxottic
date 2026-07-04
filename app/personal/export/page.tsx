import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { forecast, formatCents, type ForecastResult } from "@/lib/tax/forecast";
import { buildPersonalForecastInput } from "@/lib/tax/personal-forecast-input";
import {
  PERSONAL_EXPENSE_CATEGORIES,
  personalCategory,
} from "@/lib/tax/personal-expense-categories";
import { PrintActionsClient } from "@/components/PrintActionsClient";
import { Wordmark } from "@/components/Wordmark";

type Search = Promise<{ year?: string }>;

const FILING_LABELS: Record<string, string> = {
  single: "Single",
  married_filing_jointly: "Married filing jointly",
  married_filing_separately: "Married filing separately",
  head_of_household: "Head of household",
  qualifying_widow: "Qualifying surviving spouse",
};

type ExpenseRow = {
  id: string;
  category: string;
  amount_cents: number;
  incurred_on: string;
  notes: string | null;
};

/**
 * Personal annual export (item 16): a print-to-PDF workpaper for individual
 * (W-2) filers, the individual-side counterpart to the company export at
 * /c/[publicId]/export. It carries the year-end forecast summary plus the
 * logged deductible-expense sheet, grouped by category, so the filer can hand
 * a clean annual record to a preparer. Numbers come from the same
 * buildPersonalForecastInput used by the live forecast, so page and sheet
 * always agree.
 */
export default async function PersonalExportPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const { admin, user } = await requireUserWithAdmin();
  const { year } = await searchParams;
  const taxYear = year ? Number(year) : new Date().getUTCFullYear();

  const [{ data: taxProfile }, { data: profile }, { data: expenseData }] =
    await Promise.all([
      admin
        .from("tax_profiles")
        .select("*")
        .eq("user_id", user.id)
        .eq("tax_year", taxYear)
        .maybeSingle(),
      admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
      admin
        .from("personal_expenses")
        .select("id, category, amount_cents, incurred_on, notes")
        .eq("user_id", user.id)
        .eq("tax_year", taxYear)
        .order("incurred_on", { ascending: false }),
    ]);

  if (!taxProfile) {
    redirect(`/onboarding/tax-profile?next=/personal/export`);
  }

  const expenses = (expenseData as ExpenseRow[] | null) ?? [];
  const input = buildPersonalForecastInput(taxProfile, expenses, taxYear);
  const result: ForecastResult = forecast(input);

  const filerName = profile?.full_name || user.email || "Individual filer";
  const filingLabel =
    FILING_LABELS[taxProfile.filing_status as string] ??
    taxProfile.filing_status;

  const householdWagesCents =
    input.ownerW2WagesCents + input.spouseW2WagesCents;
  const withheldCents =
    input.ownerW2WithheldCents + input.spouseW2WithheldCents;

  // Per-category deduction totals for the expense sheet.
  const totalsByCat = new Map<string, number>();
  for (const e of expenses) {
    totalsByCat.set(
      e.category,
      (totalsByCat.get(e.category) ?? 0) + e.amount_cents,
    );
  }
  const deductionsTotalCents = expenses.reduce((s, e) => s + e.amount_cents, 0);

  return (
    <main className="export-page bg-white text-forest-900 min-h-screen">
      <div className="mx-auto max-w-4xl px-5 sm:px-10 py-8 sm:py-12">
        {/* Toolbar, hidden on print */}
        <div className="no-print mb-8 flex items-center justify-between gap-3 flex-wrap">
          <Link
            href="/personal/forecast"
            className="text-sm text-ink-soft hover:text-forest-800"
          >
            &larr; Back to forecast
          </Link>
          <div className="flex items-center gap-2 flex-wrap">
            <PrintActionsClient />
            <Link
              href="/personal/expenses"
              className="btn-ghost text-sm h-10 px-4"
            >
              Edit deductions
            </Link>
          </div>
        </div>

        {/* Header */}
        <header className="border-b border-forest-100 pb-6 print:pb-4">
          <Wordmark size="md" />
          <div className="mt-4 text-[10px] uppercase tracking-[0.25em] text-gold-700">
            Personal year-end summary - Tax year {taxYear}
          </div>
          <h1
            className="display mt-1 text-3xl sm:text-4xl text-forest-900"
            style={{ fontFamily: "var(--font-fraunces)" }}
          >
            {filerName}
          </h1>
          <p className="mt-3 text-sm text-ink-soft max-w-2xl leading-relaxed">
            Everything Taxottic projected for your {taxYear} individual return,
            plus every deductible personal expense you logged. Hand this to your
            preparer so nothing gets missed.
          </p>
        </header>

        {/* Filer details */}
        <section className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <Field label="Filer" value={filerName} />
          <Field label="Filing status" value={String(filingLabel)} />
          <Field label="State" value={taxProfile.state_code ?? "-"} />
          <Field
            label="Dependents"
            value={String(taxProfile.dependents ?? 0)}
          />
          <Field
            label="Household W-2 wages"
            value={formatCents(householdWagesCents)}
          />
          <Field label="Tax withheld" value={formatCents(withheldCents)} />
        </section>

        {/* 01 Forecast summary */}
        <section className="mt-10">
          <SectionTitle n="01" title="Year-end forecast" />
          <table className="mt-3 w-full text-sm border-collapse">
            <tbody>
              <Row
                label="Taxable income"
                value={formatCents(result.taxableIncomeCents)}
              />
              <Row
                label="Federal income tax"
                value={formatCents(result.federalIncomeTaxCents)}
              />
              <Row
                label="State tax"
                value={formatCents(result.stateTaxCents)}
              />
              {result.childAndDependentCreditsCents > 0 ? (
                <Row
                  label="Family credits"
                  value={`- ${formatCents(result.childAndDependentCreditsCents)}`}
                />
              ) : null}
              <Row
                label="Total tax"
                value={formatCents(result.totalTaxCents)}
                strong
              />
              <Row
                label="Already paid (withholding + estimates)"
                value={formatCents(result.alreadyPaidCents)}
              />
              {result.refundCents > 0 ? (
                <Row
                  label="Projected refund"
                  value={formatCents(result.refundCents)}
                  strong
                />
              ) : (
                <Row
                  label="Projected balance due"
                  value={formatCents(result.stillOwedCents)}
                  strong
                />
              )}
              <Row
                label="Marginal rate"
                value={(result.marginalRate * 100).toFixed(1) + "%"}
              />
              <Row
                label="Effective rate"
                value={(result.overallEffectiveRate * 100).toFixed(1) + "%"}
              />
            </tbody>
          </table>
        </section>

        {/* 02 Deduction sheet */}
        <section className="mt-10">
          <SectionTitle
            n="02"
            title="Deductions logged"
            hint="Personal expenses you tracked this year, by category."
          />
          {expenses.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              No deductible expenses were logged for {taxYear}.
            </p>
          ) : (
            <>
              <table className="mt-3 w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
                    <th className="py-1.5 pr-3 font-medium">Category</th>
                    <th className="py-1.5 pr-3 font-medium">Date</th>
                    <th className="py-1.5 pr-3 font-medium">Notes</th>
                    <th className="py-1.5 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id} className="border-t border-forest-100">
                      <td className="py-1.5 pr-3">
                        {personalCategory(e.category)?.label ?? e.category}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {e.incurred_on}
                      </td>
                      <td className="py-1.5 pr-3 text-ink-soft">
                        {e.notes ?? "-"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatCents(e.amount_cents)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-forest-200 font-semibold">
                    <td className="py-2 pr-3" colSpan={3}>
                      Total deductions logged
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCents(deductionsTotalCents)}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Category subtotals */}
              <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-2 text-sm">
                {PERSONAL_EXPENSE_CATEGORIES.map((c) => {
                  const total = totalsByCat.get(c.code) ?? 0;
                  if (total === 0) return null;
                  return (
                    <div
                      key={c.code}
                      className="flex items-baseline justify-between gap-2"
                    >
                      <span className="text-ink-soft">{c.label}</span>
                      <span className="tabular-nums">{formatCents(total)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <p className="mt-10 border-t border-forest-100 pt-4 text-[11px] leading-relaxed text-ink-muted">
          Taxottic provides tax forecasting and educational guidance. This
          summary is a projection based on the information you entered and 2025
          federal rules. It is not a filed return or a substitute for advice
          from a licensed CPA or tax attorney.
        </p>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .export-page { font-size: 11px; }
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
    <div className="border-b border-forest-200 pb-2">
      <div className="flex items-baseline gap-3">
        <span className="text-[11px] font-semibold tabular-nums text-gold-700">
          {n}
        </span>
        <h2 className="display text-2xl text-forest-900">{title}</h2>
      </div>
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <tr className="border-t border-forest-100">
      <td className={"py-1.5 pr-3 " + (strong ? "font-semibold" : "")}>
        {label}
      </td>
      <td
        className={
          "py-1.5 text-right tabular-nums " + (strong ? "font-semibold" : "")
        }
      >
        {value}
      </td>
    </tr>
  );
}
