import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { formatCents } from "@/lib/tax/forecast";

// Force-dynamic so a freshly classified mileage trip (or new
// expense) shows up the next time the user lands here, instead of
// being served from a stale RSC cache. Every aggregation on this
// page is per-request and small (sums + counts), so the cost is
// negligible.
export const dynamic = "force-dynamic";

type Params = Promise<{ publicId: string }>;

/**
 * Money out hub. The biggest group, with four tools that together
 * account for most write-offs. Each section here is a self-contained
 * card with a key stat + a primary action + a "View all" link to
 * the full detail page. This collapses what used to be 4 separate
 * top tabs (Expenses, Mileage, Sales tax, Deductions) into one
 * scrollable surface.
 */
export default async function MoneyOutHub({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);
  const taxYear = new Date().getUTCFullYear();

  // Fan out the four section queries in parallel. Each is intentionally
  // small (sum/count only) so the hub is fast to render.
  const [expensesResp, mileageResp, salesTaxResp, profileResp] =
    await Promise.all([
      supabase
        .from("monthly_expenses")
        .select("amount_cents")
        .eq("company_id", company.id)
        .eq("tax_year", taxYear),
      // The column is `distance_miles`, not `miles`. The bad alias
      // made PostgREST return an error, mileageResp.data fell back
      // to null, and the "Miles driven" tile was hard-coded to 0
      // no matter how many business trips were classified. Same
      // typo bit the reducer below — fixed there too.
      supabase
        .from("mileage_trips")
        .select("distance_miles, deduction_cents")
        .eq("company_id", company.id)
        .eq("classification", "business")
        .eq("tax_year", taxYear),
      supabase
        .from("sales_tax_records")
        .select(
          "collected_cents, paid_on_purchases_cents, remitted_cents, remitted_at, filed_with_state",
        )
        .eq("company_id", company.id)
        .eq("tax_year", taxYear),
      supabase
        .from("business_profiles")
        .select("has_home_office, entity_type")
        .eq("company_id", company.id)
        .eq("tax_year", taxYear)
        .maybeSingle(),
    ]);

  const expenseTotal = (expensesResp.data ?? []).reduce(
    (a, r) => a + r.amount_cents,
    0,
  );
  const expenseCount = (expensesResp.data ?? []).length;
  const milesTotal = (mileageResp.data ?? []).reduce(
    (a, r) => a + Number(r.distance_miles ?? 0),
    0,
  );
  const mileageCount = (mileageResp.data ?? []).length;
  // Sales tax owed = collected on sales minus what's already been
  // remitted to the state. Anything left is what's still owed.
  const salesTaxOwed = (salesTaxResp.data ?? []).reduce(
    (a, r) =>
      a +
      Number(r.collected_cents ?? 0) -
      Number(r.remitted_cents ?? 0),
    0,
  );
  const salesTaxFilings = (salesTaxResp.data ?? []).length;
  const homeOfficeApplied = Boolean(profileResp.data?.has_home_office);

  const sections: SectionCardProps[] = [
    {
      title: "Expenses",
      subtitle: "Anything the business pays for.",
      stat:
        expenseCount === 0
          ? `No expenses yet for ${taxYear}.`
          : `${formatCents(expenseTotal)} across ${expenseCount} entries.`,
      primary: { label: "+ Add expense", href: `/c/${publicId}/expenses` },
      secondaryHref: `/c/${publicId}/expenses`,
    },
    {
      title: "Mileage",
      subtitle: "Drives for client meetings, supply runs, errands.",
      stat:
        mileageCount === 0
          ? "No drives logged this year."
          : `${milesTotal.toLocaleString()} mi across ${mileageCount} drives.`,
      primary: { label: "+ Log a drive", href: `/mileage` },
      secondaryHref: `/mileage`,
    },
    {
      title: "Sales tax",
      subtitle: "What you owe each state on collected sales tax.",
      stat:
        salesTaxFilings === 0
          ? "No filings tracked yet."
          : salesTaxOwed > 0
            ? `${formatCents(salesTaxOwed)} owed across open filings.`
            : `All ${salesTaxFilings} ${
                salesTaxFilings === 1 ? "filing" : "filings"
              } closed for ${taxYear}.`,
      primary: { label: "Track filing", href: `/c/${publicId}/sales-tax` },
      secondaryHref: `/c/${publicId}/sales-tax`,
    },
    {
      title: "Deductions",
      subtitle:
        "Explore every category you might qualify for; we surface them on the forecast.",
      stat: homeOfficeApplied
        ? "Home office applied. Browse the catalog for more."
        : "Home office not yet applied. The catalog has dozens more.",
      primary: { label: "Open checker", href: `/c/${publicId}/deductions` },
      secondaryHref: `/c/${publicId}/deductions`,
    },
  ];

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.name} <span className="text-gold-700">·</span>{" "}
          Tax year {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">Expenses</h1>
        <p className="mt-2 text-sm text-ink-soft max-w-xl">
          Everything that reduces your taxable income, in one place:
          expenses, mileage, sales tax, and the deduction catalog.
        </p>
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="money-out" />
        </div>

        {/* Year-to-date roll-up so the user sees the headline number
            without scrolling. Pure sum across expenses + sales tax;
            mileage is a separate non-dollar metric so we surface it
            in its own card below.
            (May 2026) Dropped `bg-gradient-to-br from-gold-50/60 to-cream`
            — every authenticated page renders in dark theme, and the
            cream gradient + cream-flipped text was rendering as
            "cream on cream" → unreadable. .card already has a proper
            dark surface; let it do its job. */}
        <div className="card mt-6 p-6">
          <p className="text-[11px] uppercase tracking-[0.28em] text-gold-700">
            {taxYear} totals
          </p>
          <div className="mt-2 grid sm:grid-cols-3 gap-4">
            <Metric label="Expenses" value={formatCents(expenseTotal)} />
            <Metric
              label="Miles driven"
              value={milesTotal.toLocaleString()}
              suffix="mi"
            />
            <Metric label="Sales tax owed" value={formatCents(salesTaxOwed)} />
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {sections.map((s) => (
            <SectionCard key={s.title} {...s} />
          ))}
        </div>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-[0.22em] text-ink-soft">
        {label}
      </p>
      <p className="display text-2xl text-forest-900 mt-0.5 tabular-nums">
        {value}
        {suffix ? (
          <span className="text-[12px] text-ink-soft ml-1 font-normal">
            {suffix}
          </span>
        ) : null}
      </p>
    </div>
  );
}

type SectionCardProps = {
  title: string;
  subtitle: string;
  stat: string;
  primary: { label: string; href: string };
  secondaryHref: string;
};

function SectionCard(s: SectionCardProps) {
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="display text-lg text-forest-900">{s.title}</h3>
          <p className="text-[12.5px] text-ink-soft mt-0.5">{s.subtitle}</p>
        </div>
        <Link
          href={s.secondaryHref}
          className="text-[12.5px] text-gold-700 hover:text-gold-800 font-medium whitespace-nowrap"
        >
          View all →
        </Link>
      </div>
      <p className="mt-3 text-[14px] text-forest-900">{s.stat}</p>
      <div className="mt-4">
        <Link
          href={s.primary.href}
          className="inline-flex items-center justify-center px-4 h-10 rounded-md bg-forest-900 text-cream text-sm font-medium hover:bg-forest-800 transition-colors"
        >
          {s.primary.label}
        </Link>
      </div>
    </div>
  );
}
