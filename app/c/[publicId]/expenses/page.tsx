import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { formatCents } from "@/lib/tax/forecast";
import { addExpense, deleteExpense } from "./actions";

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
        "id, month, amount_cents, category_code, notes, created_at, category:deduction_categories(label, is_meal)",
      )
      .eq("company_id", company.id)
      .eq("tax_year", taxYear)
      .order("month", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("deduction_categories")
      .select("code, label, description, scope, is_meal")
      .in("scope", ["business", "both"])
      .order("display_order"),
  ]);

  const total = (rows ?? []).reduce((a, r) => a + r.amount_cents, 0);

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          {company.public_id} - Tax year {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Expenses
        </h1>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="expenses" />
        </div>

        <div className="card mt-6 p-6">
          <h2 className="display text-xl text-forest-900">Add an expense</h2>
          <form action={addExpense} className="mt-4 grid sm:grid-cols-2 gap-3">
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
              <span className="text-sm font-medium text-forest-800">
                Category
              </span>
              <select
                name="category_code"
                required
                className="input"
                defaultValue=""
              >
                <option value="" disabled>
                  Select category
                </option>
                {(categories as CategoryRow[] | null)?.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                    {c.is_meal ? " (50% deductible)" : ""}
                  </option>
                ))}
              </select>
            </label>
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
                placeholder="Adobe Creative Cloud subscription"
              />
            </label>
            <div className="sm:col-span-2">
              <button className="btn-primary w-full sm:w-auto">
                Add expense
              </button>
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
                      </div>
                      {r.notes ? (
                        <div className="text-xs text-ink-muted truncate">
                          {r.notes}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-forest-900 font-medium tabular-nums">
                      {formatCents(r.amount_cents)}
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
              <li className="py-8 text-center text-sm text-ink-muted">
                No expenses entered yet for {taxYear}.
              </li>
            )}
          </ul>
        </div>
      </section>
    </main>
  );
}
