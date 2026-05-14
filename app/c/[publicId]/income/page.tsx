import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { formatCents } from "@/lib/tax/forecast";
import { RecurrencePicker } from "@/components/RecurrencePicker";
import { addIncome, deleteIncome } from "./actions";

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

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl mx-auto px-6 py-10">
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
              />
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
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border border-forest-100 bg-white/70 px-4 py-3 text-sm gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-forest-900">
                      {MONTH_LABELS[r.month - 1]} - {prettySource(r.source)}
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
                    {/* Show full cents on per-row figures so a user
                        looking at "$7,501" cannot wonder whether their
                        $7,500.50 entry was saved or rounded. The
                        page-top YTD total keeps whole-dollar formatting.
                        Audit Medium #1. */}
                    {formatCents(r.amount_cents, { showCents: true })}
                    {r.recurrence && r.recurrence !== "one_off" ? (
                      <span className="ml-1 text-[10px] text-ink-muted">
                        / {shortCadence(r.recurrence)}
                      </span>
                    ) : null}
                  </div>
                  <form action={deleteIncome}>
                    <input type="hidden" name="company_id" value={company.id} />
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      type="submit"
                      className="text-xs text-ink-muted hover:text-red-700 px-2 py-1"
                      aria-label="Delete entry"
                    >
                      Remove
                    </button>
                  </form>
                </li>
              ))
            ) : (
              <li className="py-8 text-center text-sm text-ink-muted">
                No income entries yet for {taxYear}.
              </li>
            )}
          </ul>
        </div>
      </section>
    </main>
  );
}

function prettySource(s: string): string {
  return (
    {
      sales: "Sales",
      services: "Services",
      wages_w2: "W-2",
      interest: "Interest",
      dividends: "Dividends",
      rental: "Rental",
      royalty: "Royalty",
      other: "Other",
    }[s] ?? s
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
