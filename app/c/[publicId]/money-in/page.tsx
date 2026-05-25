import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { formatCents } from "@/lib/tax/forecast";

type Params = Promise<{ publicId: string }>;

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SOURCE_LABELS: Record<string, string> = {
  sales: "Product sales",
  services: "Services",
  wages_w2: "W-2 wages",
  interest: "Interest",
  dividends: "Dividends",
  rental: "Rental",
  royalty: "Royalty",
  other: "Other",
};

/**
 * Money in hub. One of the 5 group tabs that replaced the legacy
 * 12-tab strip. Today there's only one money-in tool (income), so
 * this hub is a stat-rich summary that lets the user log a new
 * entry or jump into the full editor in one tap.
 */
export default async function MoneyInHub({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);
  const taxYear = new Date().getUTCFullYear();

  const { data: rows } = await supabase
    .from("monthly_income")
    .select("id, month, amount_cents, source, notes, created_at")
    .eq("company_id", company.id)
    .eq("tax_year", taxYear)
    .order("created_at", { ascending: false })
    .limit(5);

  const { data: yearTotal } = await supabase
    .from("monthly_income")
    .select("amount_cents")
    .eq("company_id", company.id)
    .eq("tax_year", taxYear);
  const total = (yearTotal ?? []).reduce((a, r) => a + r.amount_cents, 0);
  const entryCount = (yearTotal ?? []).length;

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl xl:max-w-5xl 2xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.public_id} <span className="text-gold-700">·</span>{" "}
          Tax year {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">Money in</h1>
        <p className="mt-2 text-sm text-ink-soft max-w-xl">
          Everything coming in this year. Log new entries or open the
          full editor for past months.
        </p>
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="money-in" />
        </div>

        {/* Year-to-date summary.
            (May 2026) Removed `bg-gradient-to-br from-gold-50/60 to-cream`
            — the cream gradient + dark-mode cream-flipped text was
            rendering as cream-on-cream. .card's dark surface handles
            this cleanly. Mirror change to money-out page. */}
        <div className="card mt-6 p-6">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-gold-700">
                {taxYear} total
              </p>
              <p className="display text-4xl text-forest-900 mt-1">
                {formatCents(total)}
              </p>
              <p className="text-[12px] text-ink-soft mt-1">
                {entryCount === 0
                  ? "No entries yet."
                  : `Across ${entryCount} ${
                      entryCount === 1 ? "entry" : "entries"
                    }.`}
              </p>
            </div>
            <Link
              href={`/c/${publicId}/income`}
              className="inline-flex items-center justify-center px-5 h-11 rounded-md bg-forest-900 text-cream text-sm font-medium hover:bg-forest-800 transition-colors"
            >
              + Add income
            </Link>
          </div>
        </div>

        {/* Recent entries */}
        <div className="card mt-6 p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="display text-xl text-forest-900">Recent entries</h2>
            <Link
              href={`/c/${publicId}/income`}
              className="text-[13px] text-gold-700 hover:text-gold-800 font-medium"
            >
              View all →
            </Link>
          </div>
          {(rows ?? []).length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              Nothing logged for {taxYear} yet. Tap{" "}
              <strong className="text-forest-900">Add income</strong> above to
              start.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-forest-100/40">
              {(rows ?? []).map((r) => (
                <li
                  key={r.id}
                  className="py-2.5 flex items-baseline justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] text-forest-900 font-medium truncate">
                      {SOURCE_LABELS[r.source] ?? r.source}
                      {r.notes ? (
                        <span className="text-ink-soft font-normal">
                          {" · "}
                          {r.notes}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11.5px] text-ink-soft mt-0.5">
                      {MONTH_LABELS[r.month - 1]}
                    </p>
                  </div>
                  <p className="font-mono text-[14px] text-forest-900 whitespace-nowrap">
                    {formatCents(r.amount_cents)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
