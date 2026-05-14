import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { formatCents } from "@/lib/tax/forecast";
import { addExpense, deleteExpense } from "./actions";
import { AddExpenseForm } from "@/components/AddExpenseForm";
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
          <ul className="mt-4 grid gap-2">
            {rows && rows.length > 0 ? (
              rows.map((r) => {
                const cat = r.category as unknown as {
                  label: string;
                  is_meal: boolean;
                } | null;
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between rounded-lg border border-forest-100 bg-white/70 px-4 py-3 text-sm gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-forest-900">
                        {MONTH_LABELS[r.month - 1]} - {cat?.label ?? r.category_code}
                        {cat?.is_meal ? (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-gold-700">
                            50%
                          </span>
                        ) : null}
                        {r.recurrence && r.recurrence !== "one_off" ? (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-forest-700 bg-forest-100 rounded px-1.5 py-0.5">
                            {prettyCadence(r.recurrence)}
                          </span>
                        ) : null}
                      </div>
                      {r.notes ? (
                        <div className="text-xs text-ink-muted truncate">
                          {r.notes}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-forest-900 font-medium tabular-nums">
                      {/* Cents on per-row figures (audit Medium #1). */}
                      {formatCents(r.amount_cents, { showCents: true })}
                      {r.recurrence && r.recurrence !== "one_off" ? (
                        <span className="ml-1 text-[10px] text-ink-muted">
                          / {shortCadence(r.recurrence)}
                        </span>
                      ) : null}
                    </div>
                    <form action={deleteExpense}>
                      <input
                        type="hidden"
                        name="company_id"
                        value={company.id}
                      />
                      <input type="hidden" name="id" value={r.id} />
                      <button
                        type="submit"
                        className="text-xs text-ink-muted hover:text-red-700 px-2 py-1"
                      >
                        Remove
                      </button>
                    </form>
                  </li>
                );
              })
            ) : (
              // Round-2 audit Section 6 friction: the empty state was a
              // dead end. A user landing here for the first time saw "No
              // expenses entered yet" and had to find the Import tab on
              // their own. Surface the two real next-steps directly —
              // the manual form is already on this page, and the CSV
              // import lives one tab over. Both routes are first-class;
              // we just had to point at them.
              <li className="py-10 text-center">
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
              </li>
            )}
          </ul>
        </div>
      </section>
    </main>
  );
}

function prettyCadence(r: string): string {
  return (
    {
      weekly: "Weekly",
      monthly: "Monthly",
      quarterly: "Quarterly",
      annual: "Annual",
    }[r] ?? r
  );
}

function shortCadence(r: string): string {
  return (
    {
      weekly: "wk",
      monthly: "mo",
      quarterly: "qtr",
      annual: "yr",
    }[r] ?? r
  );
}
