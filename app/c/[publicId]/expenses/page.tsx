import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { formatCents } from "@/lib/tax/forecast";
import { addExpense, deleteExpense, updateExpense } from "./actions";
import { AddExpenseForm } from "@/components/AddExpenseForm";
import { ExpenseRow } from "@/components/ExpenseRow";
import { ReceiptUploader } from "@/components/ReceiptUploader";

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Params = Promise<{ publicId: string }>;

type CategoryRow = {
  code: string;
  label: string;
  description: string;
  scope: "business" | "personal" | "both";
  is_meal: boolean;
  is_typically_recurring: boolean;
};

export default async function ExpensesPage({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);
  const taxYear = new Date().getUTCFullYear();
  const currentMonth = new Date().getUTCMonth() + 1;

  const [{ data: rows }, { data: categories }] = await Promise.all([
    supabase
      .from("monthly_expenses")
      .select(
        "id, month, amount_cents, category_code, recurrence, notes, created_at, category:deduction_categories(label, is_meal)",
      )
      .eq("company_id", company.id)
      .eq("tax_year", taxYear)
      .order("month", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("deduction_categories")
      .select(
        "code, label, description, scope, is_meal, is_typically_recurring",
      )
      .in("scope", ["business", "both"])
      .order("display_order"),
  ]);

  const total = (rows ?? []).reduce((a, r) => a + r.amount_cents, 0);

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.public_id} <span className="text-gold-700">·</span>{" "}
          Tax year {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Expenses
        </h1>
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="expenses" />
        </div>

        <div className="card mt-6 p-6">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
                Receipts
              </div>
              <h2 className="display mt-1 text-xl text-forest-900">
                Snap a receipt, save in seconds
              </h2>
            </div>
          </div>
          <div className="mt-3">
            <ReceiptUploader
              companyId={company.id}
              taxYear={taxYear}
              currentMonth={currentMonth}
              categories={(categories as CategoryRow[] | null) ?? []}
              action={addExpense}
            />
          </div>
        </div>

        <div className="card mt-6 p-6">
          <h2 className="display text-xl text-forest-900">Add an expense</h2>
          {/* Recent-vendor autocomplete + "Repeat last" shortcut.
              Round-2 audit Section 6 friction: power-users entering 30
              transactions per session were slowed by zero
              autocomplete on the Notes field. Browsers handle the
              picker natively when the input has `list=`, so passing
              the unique recent notes (capped at 20 to keep the HTML
              small) gives a free suggestion experience with no
              extra JS. */}
          <AddExpenseForm
            companyId={company.id}
            taxYear={taxYear}
            currentMonth={currentMonth}
            categories={(categories as CategoryRow[] | null) ?? []}
            action={addExpense}
            recentVendors={Array.from(
              new Set(
                (rows ?? [])
                  .map((r) => (r.notes ?? "").trim())
                  .filter((n) => n.length > 0),
              ),
            ).slice(0, 20)}
            lastExpense={
              rows && rows.length > 0
                ? {
                    categoryCode: rows[0].category_code,
                    amountCents: rows[0].amount_cents,
                    recurrence: rows[0].recurrence,
                    notes: rows[0].notes ?? "",
                  }
                : null
            }
          />
        </div>

        <div className="card mt-6 p-6">
          <div className="flex items-center justify-between">
            <h2 className="display text-xl text-forest-900">Year-to-date</h2>
            <div className="display text-2xl text-forest-900">
              {formatCents(total)}
            </div>
          </div>
          {/*
            Group by month. The list used to be flat 12 months × N rows
            deep — overwhelming for an active business. Each month
            becomes a <details> with month name, tx count, and the
            monthly total in the <summary>. Current month is open by
            default; the others fold away. <details> is native HTML
            so this stays a server component (no client JS shipped).
          */}
          {rows && rows.length > 0 ? (
            <ul className="mt-4 grid gap-2">
              {(() => {
                // Sort already guarantees month DESC; just bucket.
                const buckets = new Map<number, typeof rows>();
                for (const r of rows) {
                  const arr = buckets.get(r.month) ?? [];
                  arr.push(r);
                  buckets.set(r.month, arr);
                }
                return Array.from(buckets.entries()).map(
                  ([month, monthRows]) => {
                    const monthTotal = monthRows.reduce(
                      (a, r) => a + r.amount_cents,
                      0,
                    );
                    const isCurrent = month === currentMonth;
                    return (
                      <li key={month}>
                        <details
                          open={isCurrent}
                          className="group rounded-xl border border-forest-100 bg-white overflow-hidden"
                        >
                          <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none hover:bg-cream/40 list-none">
                            <div className="flex items-center gap-2 min-w-0">
                              <svg
                                className="size-4 text-forest-700 transition-transform group-open:rotate-90 shrink-0"
                                viewBox="0 0 20 20"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                aria-hidden="true"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M7 5l6 5-6 5"
                                />
                              </svg>
                              <span className="display text-base text-forest-900 truncate">
                                {MONTH_LABELS[month - 1]}
                                {isCurrent ? (
                                  <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-gold-700 font-medium">
                                    This month
                                  </span>
                                ) : null}
                              </span>
                              <span className="text-xs text-ink-muted">
                                · {monthRows.length}{" "}
                                {monthRows.length === 1 ? "expense" : "expenses"}
                              </span>
                            </div>
                            <div className="display text-base text-forest-900 shrink-0">
                              {formatCents(monthTotal)}
                            </div>
                          </summary>
                          <ul className="px-3 sm:px-4 pb-3 grid gap-2 border-t border-forest-100">
                            {monthRows.map((r) => {
                              const cat = r.category as unknown as {
                                label: string;
                                is_meal: boolean;
                              } | null;
                              return (
                                <ExpenseRow
                                  key={r.id}
                                  row={{
                                    id: r.id,
                                    month: r.month,
                                    amount_cents: r.amount_cents,
                                    category_code: r.category_code,
                                    recurrence: r.recurrence,
                                    notes: r.notes,
                                    category: cat,
                                  }}
                                  companyId={company.id}
                                  taxYear={taxYear}
                                  currentMonth={currentMonth}
                                  categories={
                                    (categories as CategoryRow[] | null) ?? []
                                  }
                                  updateAction={updateExpense}
                                  deleteAction={deleteExpense}
                                />
                              );
                            })}
                          </ul>
                        </details>
                      </li>
                    );
                  },
                );
              })()}
            </ul>
          ) : (
            // Round-2 audit Section 6 friction: the empty state was a
            // dead end. A user landing here for the first time saw "No
            // expenses entered yet" and had to find the Import tab on
            // their own. Surface the two real next-steps directly —
            // the manual form is already on this page, and the CSV
            // import lives one tab over. Both routes are first-class;
            // we just had to point at them.
            <div className="mt-4 py-10 text-center">
              <div className="text-sm text-ink-muted">
                No expenses entered yet for {taxYear}.
              </div>
              <p className="mt-3 text-xs text-ink-soft max-w-md mx-auto leading-relaxed">
                Add one with the form above to see your forecast
                tighten, or paste a year of expenses in one shot
                from your bank or accountant&apos;s CSV.
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
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

