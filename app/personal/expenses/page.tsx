import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUser } from "@/lib/auth";
import { formatCents } from "@/lib/tax/forecast";
import { PersonalExpenseForm } from "@/components/PersonalExpenseForm";
import {
  PERSONAL_EXPENSE_CATEGORIES,
  personalCategory,
} from "@/lib/tax/personal-expense-categories";
import { addPersonalExpense, deletePersonalExpense } from "./actions";

type Row = {
  id: string;
  category: string;
  amount_cents: number;
  incurred_on: string;
  notes: string | null;
};

/**
 * Personal expense tracker (item 14). An individual filer logs deductible
 * personal items through the year; the per-category totals feed the personal
 * forecast (lib/tax/personal-expense-categories.ts maps each category to a
 * forecast input). Strictly individual-side, business expenses live on the
 * company side.
 */
export default async function PersonalExpensesPage() {
  const { supabase, user } = await requireUser();
  const now = new Date();
  const taxYear = now.getUTCFullYear();
  const today = now.toISOString().slice(0, 10);

  const { data } = await supabase
    .from("personal_expenses")
    .select("id, category, amount_cents, incurred_on, notes")
    .eq("tax_year", taxYear)
    .order("incurred_on", { ascending: false });
  const rows = (data as Row[] | null) ?? [];

  // Per-category totals for the current year.
  const totalsByCat = new Map<string, number>();
  for (const r of rows) {
    totalsByCat.set(r.category, (totalsByCat.get(r.category) ?? 0) + r.amount_cents);
  }
  const annualTotal = rows.reduce((s, r) => s + r.amount_cents, 0);

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Personal · Tax year {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
          Track your deductions
        </h1>
        <p className="mt-2 text-sm text-ink-soft max-w-xl leading-relaxed">
          Log deductible personal expenses as they happen. Each category flows
          into your{" "}
          <Link
            href="/personal/forecast"
            className="text-gold-700 hover:text-gold-800 underline underline-offset-2"
          >
            year-end forecast
          </Link>
          , so your refund or balance stays current all year.
        </p>

        <div className="card mt-7 p-6 sm:p-8">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="display text-xl text-forest-900">Add an expense</h2>
            <span className="text-sm text-ink-soft">
              {taxYear} total logged:{" "}
              <span className="tabular-nums font-medium text-forest-900">
                {formatCents(annualTotal)}
              </span>
            </span>
          </div>
          <PersonalExpenseForm action={addPersonalExpense} defaultDate={today} />
        </div>

        {/* Per-category roll-up: what each deduction bucket totals so far. */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PERSONAL_EXPENSE_CATEGORIES.map((c) => {
            const total = totalsByCat.get(c.code) ?? 0;
            return (
              <div key={c.code} className="card p-4">
                <div className="text-sm font-medium text-forest-900">
                  {c.label}
                </div>
                <div className="mt-1 text-2xl tabular-nums text-forest-900">
                  {formatCents(total)}
                </div>
                <div className="mt-1 text-[11px] text-ink-muted leading-snug">
                  {c.hint}
                </div>
              </div>
            );
          })}
        </div>

        <div className="card mt-6 p-6 sm:p-8">
          <h2 className="display text-xl text-forest-900">
            Logged this year
          </h2>
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              Nothing logged yet. Add your first deductible expense above.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-forest-100">
              {rows.map((r) => {
                const cat = personalCategory(r.category);
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-forest-900">
                        {cat?.label ?? r.category}
                        <span className="ml-2 tabular-nums text-forest-700">
                          {formatCents(r.amount_cents)}
                        </span>
                      </div>
                      <div className="text-[11px] text-ink-muted">
                        {r.incurred_on}
                        {r.notes ? ` · ${r.notes}` : ""}
                      </div>
                    </div>
                    <form action={deletePersonalExpense}>
                      <input type="hidden" name="id" value={r.id} />
                      <button
                        type="submit"
                        className="text-xs text-ink-muted hover:text-red-700"
                        aria-label="Delete expense"
                      >
                        Remove
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
