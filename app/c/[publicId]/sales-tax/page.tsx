import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { formatCents } from "@/lib/tax/forecast";

type Params = Promise<{ publicId: string }>;
type Search = Promise<{ year?: string }>;

const QUARTER_LABEL = ["Q1", "Q2", "Q3", "Q4"];

/**
 * Sales-tax overview. Read-only for v1 - we sum what the user has
 * already declared on income / expense rows (sales_tax_collected_cents,
 * sales_tax_paid_cents) and surface the home-state base rate so the
 * user knows what they should be charging customers when no breakdown
 * is set yet. Per-period records (sales_tax_records table) are
 * surfaced when manually entered. Bank-feed-driven extraction lights
 * up in Phase B once Plaid is wired.
 */
export default async function SalesTaxPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { publicId } = await params;
  const { year } = await searchParams;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);
  const taxYear = year ? Number(year) : new Date().getUTCFullYear();

  // Pull state rates + this company's state + YTD income/expense
  // sales-tax columns + any existing records.
  const [
    { data: stateRate },
    { data: incomeRows },
    { data: expenseRows },
    { data: records },
  ] = await Promise.all([
    company.state_code
      ? supabase
          .from("sales_tax_state_rates")
          .select(
            "state_code, state_name, base_rate_pct, effective_avg_rate_pct",
          )
          .eq("state_code", company.state_code)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("monthly_income")
      .select(
        "month, amount_cents, sales_tax_collected_cents, sales_tax_state_code",
      )
      .eq("company_id", company.id)
      .eq("tax_year", taxYear),
    supabase
      .from("monthly_expenses")
      .select(
        "month, amount_cents, sales_tax_paid_cents, sales_tax_state_code",
      )
      .eq("company_id", company.id)
      .eq("tax_year", taxYear),
    supabase
      .from("sales_tax_records")
      .select(
        "id, period_kind, period_label, state_code, collected_cents, paid_on_purchases_cents, remitted_cents, remitted_at, filed_with_state, notes",
      )
      .eq("company_id", company.id)
      .eq("tax_year", taxYear)
      .order("period_label", { ascending: true }),
  ]);

  type IncomeRow = {
    month: number;
    amount_cents: number;
    sales_tax_collected_cents: number | null;
    sales_tax_state_code: string | null;
  };
  type ExpenseRow = {
    month: number;
    amount_cents: number;
    sales_tax_paid_cents: number | null;
    sales_tax_state_code: string | null;
  };
  const incomes = (incomeRows ?? []) as IncomeRow[];
  const expenses = (expenseRows ?? []) as ExpenseRow[];

  // YTD aggregates
  const ytdIncome = incomes.reduce((a, r) => a + r.amount_cents, 0);
  const ytdCollected = incomes.reduce(
    (a, r) => a + (r.sales_tax_collected_cents ?? 0),
    0,
  );
  const ytdPaid = expenses.reduce(
    (a, r) => a + (r.sales_tax_paid_cents ?? 0),
    0,
  );
  const collectedRows = incomes.filter(
    (r) => (r.sales_tax_collected_cents ?? 0) > 0,
  ).length;
  const paidRows = expenses.filter(
    (r) => (r.sales_tax_paid_cents ?? 0) > 0,
  ).length;

  // Per-quarter breakdown of collected sales tax (so the user can
  // see what they likely owe each quarter for filing).
  const byQuarter = [0, 0, 0, 0];
  for (const r of incomes) {
    const q = Math.min(3, Math.floor((r.month - 1) / 3));
    byQuarter[q] += r.sales_tax_collected_cents ?? 0;
  }

  // Calculated estimate: if the user hasn't entered breakdowns at
  // all, show the "if you sold $X at the state rate, you'd have
  // collected $Y" hypothetical so they have a starting point.
  const baseRatePct = stateRate?.base_rate_pct ?? null;
  const estimatedCollected =
    baseRatePct != null
      ? Math.round((ytdIncome * Number(baseRatePct)) / 100)
      : null;

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.public_id} <span className="text-gold-700">·</span>{" "}
          Sales tax · TY {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          {company.name}
        </h1>
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="sales-tax" />
        </div>

        {/* Home state */}
        <section className="mt-6 card p-6 sm:p-7">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
                Your home state
              </div>
              <h2 className="display mt-1 text-2xl text-forest-900">
                {stateRate?.state_name ?? company.state_code ?? "Not set"}
              </h2>
              {stateRate ? (
                <p className="mt-1 text-xs text-ink-muted">
                  Base state rate <strong>{stateRate.base_rate_pct}%</strong>
                  {stateRate.effective_avg_rate_pct != null ? (
                    <>
                      {" · "}avg with local{" "}
                      <strong>{stateRate.effective_avg_rate_pct}%</strong>
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="mt-1 text-xs text-ink-muted">
                  Set your state on the{" "}
                  <Link
                    href={`/c/${publicId}/profile`}
                    className="underline"
                  >
                    company profile
                  </Link>{" "}
                  to see your rate.
                </p>
              )}
            </div>
            {baseRatePct === 0 ? (
              <div className="text-xs text-ink-muted max-w-[16rem] text-right">
                Your state has no statewide sales tax. You may still owe
                local rates depending on where you sell.
              </div>
            ) : null}
          </div>
        </section>

        {/* YTD summary */}
        <section className="mt-6 grid sm:grid-cols-3 gap-3">
          <SummaryCard
            label="Sales tax COLLECTED (YTD)"
            value={formatCents(ytdCollected)}
            sub={
              collectedRows > 0
                ? `Across ${collectedRows} income entr${collectedRows === 1 ? "y" : "ies"}`
                : "No collected amounts entered yet"
            }
          />
          <SummaryCard
            label="Sales tax PAID (YTD)"
            value={formatCents(ytdPaid)}
            sub={
              paidRows > 0
                ? `Across ${paidRows} expense entr${paidRows === 1 ? "y" : "ies"}`
                : "No paid amounts entered yet"
            }
          />
          <SummaryCard
            label="Estimated due"
            value={formatCents(Math.max(0, ytdCollected))}
            tone="accent"
            sub="Sales tax collected from customers is held in trust for the state. Treat as a liability, not income."
          />
        </section>

        {/* Hypothetical: what would the home-state rate yield? */}
        {baseRatePct != null && baseRatePct > 0 && estimatedCollected != null ? (
          <section className="mt-6 card p-5">
            <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
              Reality check
            </div>
            <p className="mt-1 text-sm text-ink-soft leading-relaxed">
              YTD income on this company is{" "}
              <strong className="text-forest-900">
                {formatCents(ytdIncome)}
              </strong>
              . If every taxable sale was charged{" "}
              {stateRate?.state_name}'s base rate (
              {baseRatePct}%), you'd have collected{" "}
              <strong className="text-forest-900">
                {formatCents(estimatedCollected)}
              </strong>
              . Compare that to the{" "}
              <strong className="text-forest-900">
                {formatCents(ytdCollected)}
              </strong>{" "}
              you've actually marked as collected.
            </p>
            {ytdCollected === 0 ? (
              <p className="mt-2 text-xs text-ink-muted">
                If sales tax doesn't apply to your business (services in a
                state that doesn't tax services, or B2B exemptions), you can
                ignore this. Otherwise pop into{" "}
                <Link
                  href={`/c/${publicId}/income`}
                  className="underline"
                >
                  Income
                </Link>{" "}
                and back-fill the breakdown - fields are now there.
              </p>
            ) : null}
          </section>
        ) : null}

        {/* Quarter breakdown */}
        {ytdCollected > 0 ? (
          <section className="mt-6 card p-6">
            <h2 className="display text-xl text-forest-900">
              Collected by quarter
            </h2>
            <p className="text-xs text-ink-muted mt-1">
              Most states want a return + remittance every quarter. Take
              this as your starting estimate.
            </p>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {byQuarter.map((amt, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-cream/50 border border-forest-100 p-3"
                >
                  <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
                    {QUARTER_LABEL[i]} {taxYear}
                  </div>
                  <div className="display text-xl text-forest-900 mt-0.5 tabular-nums">
                    {formatCents(amt)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Existing records */}
        {records && records.length > 0 ? (
          <section className="mt-6">
            <h2 className="display text-xl text-forest-900">
              Filed periods
            </h2>
            <ul className="mt-3 grid gap-2">
              {records.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-forest-100 bg-white/70 px-4 py-3 text-sm flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-forest-900">
                      {r.period_label} · {r.state_code}
                    </div>
                    <div className="text-xs text-ink-muted">
                      Collected {formatCents(r.collected_cents)}
                      {" · "}Paid {formatCents(r.paid_on_purchases_cents)}
                      {" · "}Remitted {formatCents(r.remitted_cents)}
                      {r.remitted_at ? ` on ${r.remitted_at}` : ""}
                    </div>
                  </div>
                  <span
                    className={
                      "text-[10px] uppercase tracking-wide " +
                      (r.filed_with_state
                        ? "text-emerald-800"
                        : "text-gold-700")
                    }
                  >
                    {r.filed_with_state ? "Filed" : "Open"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="mt-12 text-[11px] leading-relaxed text-ink-muted max-w-2xl">
          Sales tax shown here uses the per-state base rate. Cities,
          counties, and special districts add their own. We surface the
          combined "average effective" rate as a sanity check; for
          actual filing, look up your specific jurisdiction. This is
          forecasting, not tax advice.
        </p>
      </section>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "accent";
}) {
  return (
    <div
      className={
        "rounded-xl p-4 " +
        (tone === "accent"
          ? "bg-forest-800 text-cream"
          : "bg-white border border-forest-100")
      }
    >
      <div
        className={
          "text-[10px] uppercase tracking-[0.2em] " +
          (tone === "accent" ? "text-gold-300" : "text-gold-700")
        }
      >
        {label}
      </div>
      <div
        className={
          "display text-2xl mt-1 tabular-nums " +
          (tone === "accent" ? "text-cream" : "text-forest-900")
        }
      >
        {value}
      </div>
      {sub ? (
        <div
          className={
            "text-[11px] mt-1 leading-relaxed " +
            (tone === "accent" ? "text-cream/75" : "text-ink-muted")
          }
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}
