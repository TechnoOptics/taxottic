import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { businessMileageDeductionCents } from "@/lib/mileage/deduction";
import { getTaxYearConstants } from "@/lib/tax/constants";

// "My deductions" — the canonical answer to "what have I actually
// claimed this year and how much have I saved?" Replaces the
// transient medal-overlay acknowledgment with a permanent home
// the user can revisit any time. Reads from the same source of
// truth the forecast pipeline already keys off:
//
//   business_profiles.has_home_office + sqft  → Form 8829 estimate
//   business_profiles.has_vehicle             → Schedule C car/truck line
//   mileage_trips (classification='business') → IRS standard rate
//   monthly_expenses (grouped by category)    → Schedule C lines
//
// Each section shows ONLY what the user has actually claimed (no
// suggestions, no "could you also..."). The headline is the
// running total — a single big number for "you've stacked $X in
// deductions this tax year."

export const dynamic = "force-dynamic";

type Params = Promise<{ publicId: string }>;

function fmtUsd(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
function fmtUsdCents(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default async function MyDeductionsPage({
  params,
}: {
  params: Params;
}) {
  const { publicId } = await params;
  const { user, company, supabase } = await loadCompanyByPublicId(publicId);
  const taxYear = new Date().getUTCFullYear();
  const constants = getTaxYearConstants(taxYear);

  // ── 1. Big-ticket structured deductions: home office + vehicle ──
  const { data: profile } = await supabase
    .from("business_profiles")
    .select(
      "has_home_office, home_office_sqft, home_total_sqft, has_vehicle, vehicle_method, vehicle_business_miles",
    )
    .eq("company_id", company.id)
    .eq("tax_year", taxYear)
    .maybeSingle();

  const homeOfficeApplied = Boolean(profile?.has_home_office);
  const homeSqft = (profile?.home_office_sqft as number | null) ?? null;
  const homeTotal = (profile?.home_total_sqft as number | null) ?? null;
  // IRS Form 8829 simplified method: $5/sq ft, capped at 300 sq ft → $1,500 max.
  // The actual-expenses method usually beats this once rent + utilities
  // flow in, but here we surface the FLOOR (the simplified figure) so
  // the user sees a guaranteed lower bound. The forecast pipeline can
  // refine with actual expenses downstream.
  const homeOfficeCents = homeOfficeApplied && homeSqft
    ? Math.min(homeSqft, 300) * 5 * 100
    : 0;

  const vehicleApplied = Boolean(profile?.has_vehicle);

  // ── 2. Vehicle / mileage from the tracker ──
  // Sum every classified-business trip's stored deduction_cents. The
  // sync stores the IRS-rate cents at classify time, so we don't
  // re-multiply here — that's the ground truth.
  const { data: businessTripsRaw } = await supabase
    .from("mileage_trips")
    .select("distance_miles, deduction_cents")
    .eq("company_id", company.id)
    .eq("classification", "business")
    .eq("tax_year", taxYear);
  const businessTrips = (businessTripsRaw ?? []) as Array<{
    distance_miles: number;
    deduction_cents: number;
  }>;
  const trackedMiles = businessTrips.reduce(
    (a, t) => a + Number(t.distance_miles || 0),
    0,
  );
  const trackedDeductionCents = businessTrips.reduce(
    (a, t) => a + Number(t.deduction_cents || 0),
    0,
  );
  // If they declared has_vehicle + manual business_miles BUT haven't
  // used the tracker, fall back to the manual figure × IRS rate.
  const manualMiles = vehicleApplied
    ? (profile?.vehicle_business_miles as number | null) ?? 0
    : 0;
  const manualMileageCents = vehicleApplied
    ? businessMileageDeductionCents(manualMiles, taxYear)
    : 0;
  const mileageCents = Math.max(trackedDeductionCents, manualMileageCents);
  const mileageMiles = Math.max(trackedMiles, manualMiles);

  // ── 3. Schedule C expenses: grouped by category ──
  // Bring in deduction_categories so we can show "Office expense"
  // instead of bare codes.
  const [{ data: expRows }, { data: catRows }] = await Promise.all([
    supabase
      .from("monthly_expenses")
      .select("category_code, amount_cents")
      .eq("company_id", company.id)
      .eq("tax_year", taxYear),
    supabase
      .from("deduction_categories")
      .select("code, label, schedule_c_line"),
  ]);

  type Cat = { code: string; label: string; schedule_c_line: string | null };
  const catById = new Map<string, Cat>(
    ((catRows ?? []) as Cat[]).map((c) => [c.code, c]),
  );
  const byCategory = new Map<string, number>();
  for (const r of (expRows ?? []) as Array<{
    category_code: string;
    amount_cents: number;
  }>) {
    byCategory.set(
      r.category_code,
      (byCategory.get(r.category_code) ?? 0) + Number(r.amount_cents || 0),
    );
  }
  const categoryTotals = Array.from(byCategory.entries())
    .map(([code, cents]) => ({
      code,
      label: catById.get(code)?.label ?? code,
      line: catById.get(code)?.schedule_c_line ?? null,
      cents,
    }))
    .sort((a, b) => b.cents - a.cents);

  const expensesCents = categoryTotals.reduce((a, c) => a + c.cents, 0);

  const grandTotalCents = homeOfficeCents + mileageCents + expensesCents;

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-4xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 py-6 sm:py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.public_id} <span className="text-gold-700">·</span> Tax year{" "}
          {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          My deductions
        </h1>
        <p className="mt-2 text-sm sm:text-base text-ink-soft max-w-2xl leading-relaxed">
          Everything you&apos;ve claimed this year, in one place. Each one
          shaves off taxable income — the total below is how much you&apos;ve
          taken off the table so far.
        </p>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="my-deductions" />
        </div>

        {/* ─── Headline total ─── */}
        <section className="mt-6 card p-6 sm:p-8 relative overflow-hidden">
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
            Stacked this year
          </div>
          <div className="display mt-2 text-4xl sm:text-5xl text-forest-900 tabular-nums">
            {fmtUsd(grandTotalCents)}
          </div>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-xl">
            Total deductions across Home Office, Vehicle / Mileage, and
            every Schedule C expense category. Your actual tax savings
            depend on your marginal rate — see the{" "}
            <Link
              href={`/c/${publicId}/forecast`}
              className="text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2"
            >
              Forecast
            </Link>{" "}
            for the dollars-back number.
          </p>
        </section>

        {/* ─── Major claims (big-ticket structured deductions) ─── */}
        <section className="mt-8">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700 font-medium">
            Major claims
          </div>
          <h2 className="display mt-1 text-xl text-forest-900">
            Big-ticket deductions
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {/* Home Office */}
            <article
              className={
                "card p-5 " +
                (homeOfficeApplied ? "" : "opacity-60 border-dashed")
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
                    Form 8829
                  </div>
                  <h3 className="display mt-1 text-lg text-forest-900">
                    Home office
                  </h3>
                  {homeOfficeApplied && homeSqft && homeTotal ? (
                    <p className="mt-1 text-xs text-ink-soft">
                      {homeSqft.toLocaleString()} sq ft of{" "}
                      {homeTotal.toLocaleString()} sq ft (
                      {Math.round((homeSqft / homeTotal) * 1000) / 10}% business
                      use)
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-ink-muted">Not claimed</p>
                  )}
                </div>
                {homeOfficeApplied ? (
                  <AppliedBadge />
                ) : (
                  <Link
                    href={`/c/${publicId}/deductions`}
                    className="text-xs text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2 shrink-0"
                  >
                    Apply →
                  </Link>
                )}
              </div>
              <div className="mt-4 flex items-end justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                    Estimated annual deduction
                  </div>
                  <div className="display text-2xl text-forest-900 tabular-nums">
                    {fmtUsd(homeOfficeCents)}
                  </div>
                  {homeOfficeApplied ? (
                    <div className="text-[11px] text-ink-muted mt-0.5">
                      Simplified method floor; actual-expenses usually beats it
                    </div>
                  ) : null}
                </div>
              </div>
            </article>

            {/* Vehicle / mileage */}
            <article
              className={
                "card p-5 " +
                (mileageCents > 0 ? "" : "opacity-60 border-dashed")
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
                    Schedule C · Line 9
                  </div>
                  <h3 className="display mt-1 text-lg text-forest-900">
                    Vehicle / mileage
                  </h3>
                  <p className="mt-1 text-xs text-ink-soft">
                    {mileageMiles > 0
                      ? `${mileageMiles.toLocaleString(undefined, { maximumFractionDigits: 1 })} business mi at ${constants.MILEAGE_RATE_PER_MILE_CENTS}¢/mi`
                      : "Not claimed"}
                  </p>
                </div>
                {mileageCents > 0 ? (
                  <AppliedBadge />
                ) : (
                  <Link
                    href={`/mileage`}
                    className="text-xs text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2 shrink-0"
                  >
                    Track →
                  </Link>
                )}
              </div>
              <div className="mt-4 flex items-end justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                    YTD deduction
                  </div>
                  <div className="display text-2xl text-forest-900 tabular-nums">
                    {fmtUsd(mileageCents)}
                  </div>
                  {mileageCents > 0 ? (
                    <Link
                      href="/mileage/business"
                      className="text-[11px] text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2 mt-0.5 inline-block"
                    >
                      See the breadcrumb map →
                    </Link>
                  ) : null}
                </div>
              </div>
            </article>
          </div>
        </section>

        {/* ─── Schedule C expense roll-up ─── */}
        <section className="mt-8">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700 font-medium">
            Schedule C expenses
          </div>
          <h2 className="display mt-1 text-xl text-forest-900">
            By category
            <span className="ml-2 text-sm text-ink-muted">
              {fmtUsdCents(expensesCents)}
            </span>
          </h2>
          {categoryTotals.length === 0 ? (
            <div className="card mt-3 p-6 text-center">
              <p className="text-sm text-ink-soft">
                No Schedule C expenses logged for {taxYear} yet.
              </p>
              <p className="mt-2 text-xs text-ink-muted max-w-md mx-auto leading-relaxed">
                Add them on{" "}
                <Link
                  href={`/c/${publicId}/expenses`}
                  className="text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2"
                >
                  Expenses
                </Link>{" "}
                or let{" "}
                <Link
                  href={`/c/${publicId}/banks`}
                  className="text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2"
                >
                  Bank transactions
                </Link>{" "}
                auto-apply them for you.
              </p>
            </div>
          ) : (
            <ul className="mt-3 grid gap-2">
              {categoryTotals.map((c) => (
                <li
                  key={c.code}
                  className="card p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-forest-900 font-medium truncate">
                      {c.label}
                    </div>
                    {c.line ? (
                      <div className="text-[11px] text-ink-muted mt-0.5">
                        Schedule C {c.line}
                      </div>
                    ) : null}
                  </div>
                  <div className="display text-base text-forest-900 tabular-nums shrink-0">
                    {fmtUsdCents(c.cents)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-8 text-xs text-ink-muted leading-relaxed">
          Want to claim something new?{" "}
          <Link
            href={`/c/${publicId}/deductions`}
            className="text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2"
          >
            Browse the deduction explorer
          </Link>
          .
        </p>
      </section>
    </main>
  );
}

function AppliedBadge() {
  return (
    <span className="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-1 font-medium">
      <svg
        className="size-3"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 011.4-1.4L9 11.6l6.3-6.3a1 1 0 011.4 0z"
          clipRule="evenodd"
        />
      </svg>
      Applied
    </span>
  );
}
