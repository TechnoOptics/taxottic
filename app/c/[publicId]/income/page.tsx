import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { formatCents } from "@/lib/tax/forecast";
import { RecurrencePicker } from "@/components/RecurrencePicker";
import { addIncome, deleteIncome, updateIncome } from "./actions";
import { IncomeRow } from "@/components/IncomeRow";

const INCOME_SOURCES = [
  { value: "sales", label: "Product sales" },
  { value: "services", label: "Services / consulting" },
  { value: "wages_w2", label: "W-2 wages" },
  { value: "interest", label: "Interest" },
  { value: "dividends", label: "Dividends" },
  { value: "rental", label: "Rental income" },
  { value: "royalty", label: "Royalty / licensing" },
  { value: "other", label: "Other" },
];

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Params = Promise<{ publicId: string }>;

export default async function IncomePage({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);
  const taxYear = new Date().getUTCFullYear();
  const currentMonth = new Date().getUTCMonth() + 1;

  const { data: rows } = await supabase
    .from("monthly_income")
    .select(
      "id, month, amount_cents, source, recurrence, notes, created_at",
    )
    .eq("company_id", company.id)
    .eq("tax_year", taxYear)
    .order("month", { ascending: false })
    .order("created_at", { ascending: false });

  const total = (rows ?? []).reduce((a, r) => a + r.amount_cents, 0);
  // Recent unique notes for the vendor-autocomplete <datalist>. Server-
  // rendered: the browser wires up the keyboard picker natively when
  // an input has `list=`. Cap at 20 to keep the HTML small.
  const recentNotes = Array.from(
    new Set(
      (rows ?? [])
        .map((r) => (r.notes ?? "").trim())
        .filter((n) => n.length > 0),
    ),
  ).slice(0, 20);

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.public_id} <span className="text-gold-700">·</span>{" "}
          Tax year {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Income
        </h1>
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="income" />
        </div>

        <div className="card mt-6 p-6">
          <h2 className="display text-xl text-forest-900">Add an entry</h2>
          <form action={addIncome} className="mt-4 grid sm:grid-cols-2 gap-3">
            <input type="hidden" name="company_id" value={company.id} />
            <input type="hidden" name="tax_year" value={taxYear} />
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">Month</span>
              <select name="month" className="input" defaultValue={currentMonth}>
                {MONTH_LABELS.slice(0, currentMonth).map((m, i) => (
                  <option key={i} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">Source</span>
              <select name="source" className="input" defaultValue="sales">
                {INCOME_SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2">
              <RecurrencePicker />
            </div>
            <label className="grid gap-1.5 sm:col-span-2">
              <span className="text-sm font-medium text-forest-800">
                Amount (USD)
              </span>
              <input
                name="amount"
                type="text"
                inputMode="decimal"
                required
                placeholder="$0.00"
                className="input"
              />
            </label>
            <label className="grid gap-1.5 sm:col-span-2">
              <span className="text-sm font-medium text-forest-800">
                Notes (optional)
              </span>
              <input
                name="notes"
                type="text"
                className="input"
                placeholder="Invoice 1042, ABC Corp"
                list={recentNotes.length > 0 ? "income-vendors" : undefined}
                autoComplete="off"
              />
              {recentNotes.length > 0 ? (
                <datalist id="income-vendors">
                  {recentNotes.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              ) : null}
            </label>
            <div className="sm:col-span-2">
              <button className="btn-primary w-full sm:w-auto">Add income</button>
            </div>
          </form>
        </div>

        <div className="card mt-6 p-6">
          <div className="flex items-center justify-between">
            <h2 className="display text-xl text-forest-900">Year-to-date</h2>
            <div className="display text-2xl text-forest-900">
              {formatCents(total)}
            </div>
          </div>
          <ul className="mt-4 grid gap-2">
            {rows && rows.length > 0 ? (
              rows.map((r) => (
                <IncomeRow
                  key={r.id}
                  row={r}
                  companyId={company.id}
                  taxYear={taxYear}
                  currentMonth={currentMonth}
                  updateAction={updateIncome}
                  deleteAction={deleteIncome}
                />
              ))
            ) : (
              // Empty state with import + bank CTAs. Round-2 audit
              // Section 6: the prior dead-end empty state didn't tell
              // the user where to go next. Point at both real paths
              // for backfilling a year's worth of income at once.
              <li className="py-10 text-center">
                <div className="text-sm text-ink-muted">
                  No income entries yet for {taxYear}.
                </div>
                <p className="mt-3 text-xs text-ink-soft max-w-md mx-auto leading-relaxed">
                  Use the form above for a single row, or backfill the
                  whole year from your invoicing CSV or a connected
                  bank account.
                </p>
                <div className="mt-4 inline-flex flex-wrap items-center justify-center gap-2">
                  <Link
                    href={`/c/${publicId}/import`}
                    className="btn-ghost text-xs px-3 h-9"
                  >
                    Import a CSV →
                  </Link>
                  <Link
                    href={`/c/${publicId}/banks`}
                    className="btn-ghost text-xs px-3 h-9"
                  >
                    Connect a bank
                  </Link>
                </div>
              </li>
            )}
          </ul>
        </div>
      </section>
    </main>
  );
}

