import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { CompanyLogo } from "@/components/CompanyLogo";
import { PageHeader } from "@/components/PageHeader";
import { DeductionScorecard } from "@/components/DeductionScorecard";
import { FindCpaCard } from "@/components/FindCpaCard";
import { ForecastDisclaimer } from "@/components/ForecastDisclaimer";
import { YearEndSuggestionsCard } from "@/components/YearEndSuggestionsCard";
import { SyncFreshness } from "@/components/SyncFreshness";
import { relativeTime, freshnessLevel } from "@/lib/format/relative-time";
import {
  AmtTile,
  CapitalGainsTile,
  EducationCreditTile,
  EitcTile,
  ForeignExclusionTile,
  RetirementRecommendationTile,
  RetirementSavingsTile,
  SaversCreditTile,
  StudentLoanInterestTile,
  W4NudgeTile,
} from "@/components/forecast/BenefitTiles";
import { buildYearEndSuggestions } from "@/lib/tax/year-end-suggestions";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { createServiceClient } from "@/lib/supabase/server";
import {
  formatCents,
  type EntityType,
} from "@/lib/tax/forecast";
import type { FilingStatus } from "@/lib/tax/constants-2025";
import {
  buildScorecard,
  eligibleDeductions,
} from "@/lib/deductions/eligibility";
import { deductibleAmountForCategory } from "@/lib/tax/net-business-income";
import { businessMileageDeductionCents } from "@/lib/mileage/deduction";
import {
  combineMonthly,
  expandRowToMonthly,
  totalOfMonthly,
  ytdOfMonthly,
} from "@/lib/tax/recurrence";
import {
  buildCompanyForecast,
  type IncomeRow,
  type ExpenseRow,
  type ForecastTaxProfile,
  type ForecastBusinessProfile,
} from "@/lib/tax/company-forecast";

type Params = Promise<{ publicId: string }>;

export default async function ForecastPage({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company, isManager } =
    await loadCompanyByPublicId(publicId);

  const taxYear = new Date().getUTCFullYear();

  // Pull tax profile, business profile, monthly entries.
  const [
    { data: taxProfile },
    { data: businessProfile },
    { data: incomeRows },
    { data: expenseRows },
  ] = await Promise.all([
    supabase
      .from("tax_profiles")
      .select("*")
      .eq("user_id", user.id)
      .eq("tax_year", taxYear)
      .maybeSingle(),
    supabase
      .from("business_profiles")
      .select("*")
      .eq("company_id", company.id)
      .eq("tax_year", taxYear)
      .maybeSingle(),
    supabase
      .from("monthly_income")
      .select("amount_cents, month, recurrence")
      .eq("company_id", company.id)
      .eq("tax_year", taxYear),
    supabase
      .from("monthly_expenses")
      .select("amount_cents, month, category_code, recurrence")
      .eq("company_id", company.id)
      .eq("tax_year", taxYear),
  ]);

  if (!taxProfile) {
    redirect(`/onboarding/tax-profile?next=/c/${publicId}/forecast`);
  }

  // Bank-sync freshness: the forecast numbers depend on synced transactions,
  // so surface how fresh that data is (and a one-tap re-sync) right here.
  const { data: bankConns } = await supabase
    .from("bank_connections")
    .select("last_synced_at")
    .eq("company_id", company.id)
    .is("deleted_at", null);
  const hasConnections = (bankConns?.length ?? 0) > 0;
  const lastSync =
    (bankConns ?? [])
      .map((c) => c.last_synced_at as string | null)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;
  const syncLabel = relativeTime(lastSync);
  const syncLevel = freshnessLevel(lastSync);

  const currentMonth = new Date().getUTCMonth() + 1;

  const incomes = (incomeRows ?? []) as IncomeRow[];
  const expenses = (expenseRows ?? []) as ExpenseRow[];

  // Tracked business-trip deduction (IRS-grade GPS log). Fetched here
  // so the shared forecast helper stays I/O-free + unit-testable.
  const admin = createServiceClient();
  const { data: bizTripRows } = await admin
    .from("mileage_trips")
    .select("deduction_cents, started_at")
    .eq("company_id", company.id)
    .eq("classification", "business")
    .eq("tax_year", taxYear);
  const trackedTrips = (bizTripRows ?? []) as unknown as {
    deduction_cents: number;
    started_at: string;
  }[];
  const trackedYtdMileageCents = trackedTrips.reduce(
    (a, t) => a + Number(t.deduction_cents ?? 0),
    0,
  );
  // Days since the most recent business drive — drives the "log your
  // miles" nudge's recency gate (hide it while they're actively
  // tracking; only resurface after a 7-day lapse). null = none logged.
  // ISO timestamps sort chronologically, so a string max gives the most
  // recent business trip without a Date.parse. new Date(...) matches the
  // page's existing time pattern (see taxYear/currentMonth above).
  const lastBizTripIso = trackedTrips.reduce<string | null>(
    (max, t) => (max == null || t.started_at > max ? t.started_at : max),
    null,
  );
  const daysSinceLastBusinessMile =
    lastBizTripIso == null
      ? null
      : Math.floor(
          (new Date().getTime() - new Date(lastBizTripIso).getTime()) /
            86_400_000,
        );

  // The entire YTD/projected assembly + the two forecast() runs now
  // live in lib/tax/company-forecast.ts so the watch glance computes
  // the IDENTICAL numbers (they can't drift). Behaviour-preserving
  // move — same inputs, same engine calls, same rounding.
  const {
    ytdResult,
    result,
    summary: input,
    monthsWithOneOff,
    oneOffPaceFactor,
    isRecurring,
    oneOffIncomes,
    oneOffExpenses,
    recurringIncomeMonthly,
    recurringExpenseMonthly,
    recurringBizExpenseMonthly,
    recurringMealsMonthly,
    recurringAboveTheLineMonthly,
    federalBrackets,
    deductionBreakdown,
  } = buildCompanyForecast({
    taxYear,
    currentMonth,
    company: {
      state_code: company.state_code ?? null,
      entity_type: company.entity_type ?? null,
    },
    taxProfile: taxProfile as unknown as ForecastTaxProfile,
    businessProfile:
      (businessProfile as unknown as ForecastBusinessProfile | null) ?? null,
    incomes,
    expenses,
    trackedYtdMileageCents,
    trackedTripCount: trackedTrips.length,
  });

  // Tiny pure closures the scorecard / year-end blocks below use.
  // Rebuilt from the helper's returned rows (no logic duplication —
  // identical predicates, same isRecurring).
  const sumOneOff = (
    rows: ExpenseRow[],
    pick: (r: ExpenseRow) => boolean,
  ): number =>
    rows
      .filter((r) => !isRecurring(r) && pick(r))
      .reduce((a, r) => a + r.amount_cents, 0);
  const monthlyForExpenses = (pick: (r: ExpenseRow) => boolean): number[] =>
    combineMonthly(
      expenses
        .filter((r) => isRecurring(r) && pick(r))
        .map((r) =>
          expandRowToMonthly({
            month: r.month,
            amount_cents: r.amount_cents,
            recurrence: r.recurrence,
          }),
        ),
    );

  // Per-month series for the chart now respects recurrence. One-off
  // rows land in their own month; recurring rows spread across the
  // months they actually occur.
  const incomeByMonth = combineMonthly([
    ...oneOffIncomes.map((r) =>
      expandRowToMonthly({
        month: r.month,
        amount_cents: r.amount_cents,
        recurrence: "one_off",
      }),
    ),
    recurringIncomeMonthly,
  ]);
  const expenseByMonth = combineMonthly([
    ...oneOffExpenses.map((r) =>
      expandRowToMonthly({
        month: r.month,
        amount_cents: r.amount_cents,
        recurrence: "one_off",
      }),
    ),
    recurringBizExpenseMonthly,
    recurringMealsMonthly,
    recurringAboveTheLineMonthly,
  ]);

  // Deduction scorecard: which eligible deductions has this business captured?
  const eligible = eligibleDeductions({
    entityType: (company.entity_type ?? "sole_prop") as EntityType,
    hasEmployees: businessProfile?.has_employees ?? false,
    hasVehicle: businessProfile?.has_vehicle ?? false,
    hasHomeOffice: businessProfile?.has_home_office ?? false,
  });
  // Captured-by-code uses the projected year-end amount (one-off pace
  // + recurring full year) so the deduction scorecard reflects what the
  // user is actually likely to capture for the year.
  //
  // The May 2026 audit's High #5: the scorecard was showing GROSS
  // captured dollars for meals — but the meals category is labelled
  // "Meals (50% deductible)" and elsewhere on the page we report the
  // post-50% number. Run every captured amount through
  // `deductibleAmountForCategory` so the scorecard tracks DEDUCTIBLE
  // dollars (matching the forecast's headline expense figure).
  const capturedByCode = new Map<string, number>();
  for (const r of expenses) {
    let gross: number;
    if (isRecurring(r)) {
      gross = totalOfMonthly(
        expandRowToMonthly({
          month: r.month,
          amount_cents: r.amount_cents,
          recurrence: r.recurrence,
        }),
      );
    } else {
      gross = Math.round(r.amount_cents * oneOffPaceFactor);
    }
    const deductible = deductibleAmountForCategory(r.category_code, gross);
    capturedByCode.set(
      r.category_code,
      (capturedByCode.get(r.category_code) ?? 0) + deductible,
    );
  }
  // Profile-level "yes, I'm claiming this" flags should also count
  // as captured on the scorecard, even when there's no
  // monthly_expenses row tied to the deduction. Otherwise the user
  // applies Home Office via the Quick Apply modal (or sets Vehicle
  // in Profile), business_profiles.has_home_office / has_vehicle
  // flips true, the forecast pipeline ALREADY includes the
  // deduction — but the scorecard tile stayed empty because
  // nothing landed in capturedByCode.
  //
  // Home Office: simplified-method floor ($5/sqft, cap 300 sqft →
  // max $1,500/yr). Same figure /my-deductions surfaces. Sentinel
  // of 1¢ only if sqft is genuinely 0/null AND has_home_office is
  // true — keep the binary "captured?" honest in the degenerate
  // case.
  if (businessProfile?.has_home_office) {
    const existing = capturedByCode.get("home_office") ?? 0;
    if (existing === 0) {
      const sqft = Math.min(
        (businessProfile.home_office_sqft as number | null) ?? 0,
        300,
      );
      capturedByCode.set("home_office", Math.max(sqft * 5 * 100, 1));
    }
  }
  // Vehicle / car_truck: the EARLIER version of this fix planted a
  // 1¢ sentinel any time has_vehicle was true. That ticked the
  // tile as captured even when the user had zero classified-
  // business mileage AND zero monthly_expenses on car_truck —
  // i.e., the deduction had genuinely captured $0. The user
  // rightly flagged this ("how can it be awarded when it has a
  // zero for car / truck expense?").
  //
  // Use the real value instead: roll up classified-business
  // mileage_trips → IRS-rate cents, plus the user's manual
  // vehicle_business_miles fallback if no tracker data exists.
  // The tile only ticks when this is > $0. If they're on the
  // actual-expenses method (vehicle_method='actual'), the manual-
  // miles fallback can't be the right number anyway, so don't
  // synthesize anything from has_vehicle alone.
  if (businessProfile?.has_vehicle) {
    const { data: tripRows } = await supabase
      .from("mileage_trips")
      .select("deduction_cents")
      .eq("company_id", company.id)
      .eq("classification", "business")
      .eq("tax_year", taxYear);
    const trackedCents = (tripRows ?? []).reduce(
      (a, r) => a + Number((r as { deduction_cents: number }).deduction_cents || 0),
      0,
    );
    const manualMiles =
      (businessProfile.vehicle_business_miles as number | null) ?? 0;
    const isStandard = businessProfile.vehicle_method !== "actual";
    const manualCents =
      isStandard && manualMiles > 0
        ? businessMileageDeductionCents(manualMiles, taxYear)
        : 0;
    const carTruckCents = Math.max(trackedCents, manualCents);
    if (carTruckCents > 0) {
      const existing = capturedByCode.get("car_truck") ?? 0;
      if (existing === 0) capturedByCode.set("car_truck", carTruckCents);
    }
  }

  const { data: categoryRows } = await supabase
    .from("deduction_categories")
    .select(
      "code, label, description, schedule_c_line, irs_pub, irc_section, pub_chapter, irs_url",
    )
    .in(
      "code",
      eligible.map((e) => e.code),
    );
  const categoryMeta = new Map<
    string,
    {
      label: string;
      description: string;
      schedule_c_line: string | null;
      irs_pub: string | null;
      irc_section: string | null;
      pub_chapter: string | null;
      irs_url: string | null;
    }
  >();
  for (const c of (categoryRows ?? []) as Array<{
    code: string;
    label: string;
    description: string;
    schedule_c_line: string | null;
    irs_pub: string | null;
    irc_section: string | null;
    pub_chapter: string | null;
    irs_url: string | null;
  }>) {
    categoryMeta.set(c.code, {
      label: c.label,
      description: c.description,
      schedule_c_line: c.schedule_c_line,
      irs_pub: c.irs_pub,
      irc_section: c.irc_section,
      pub_chapter: c.pub_chapter,
      irs_url: c.irs_url,
    });
  }
  const scorecard = buildScorecard({ eligible, capturedByCode, categoryMeta });

  // Year-end suggestions: built off the projected forecast + a few buckets
  // of YTD context (which above-the-line items has the user already logged?
  // What's their vehicle / home-office posture?).
  const ytdRetirementContributionsCents =
    sumOneOff(expenses, (r) => r.category_code === "retirement_self") +
    ytdOfMonthly(
      monthlyForExpenses((r) => r.category_code === "retirement_self"),
      currentMonth,
    );
  const ytdSelfEmployedHealthCents =
    sumOneOff(expenses, (r) => r.category_code === "self_employed_health") +
    ytdOfMonthly(
      monthlyForExpenses((r) => r.category_code === "self_employed_health"),
      currentMonth,
    );
  // Charitable giving logged this year (personal §170) — drives the
  // "give back / earn the Philanthropist medal" year-end suggestion.
  const { data: donationRows } = await supabase
    .from("charitable_donations")
    .select("amount_cents")
    .eq("user_id", user.id)
    .eq("tax_year", taxYear);
  const charitableGivenCents = (donationRows ?? []).reduce(
    (a, d) => a + Number((d as { amount_cents: number }).amount_cents || 0),
    0,
  );

  const suggestions = buildYearEndSuggestions({
    result,
    filingStatus: taxProfile.filing_status as FilingStatus,
    entityType: (company.entity_type ?? "sole_prop") as EntityType,
    publicId,
    ytdRetirementContributionsCents,
    ytdSelfEmployedHealthCents,
    hasVehicle: businessProfile?.has_vehicle ?? null,
    vehicleBusinessMiles: businessProfile?.vehicle_business_miles ?? null,
    vehicleMethod:
      (businessProfile?.vehicle_method as "standard" | "actual" | null) ??
      null,
    daysSinceLastBusinessMile,
    hasHomeOffice: businessProfile?.has_home_office ?? null,
    homeOfficeSqft: businessProfile?.home_office_sqft ?? null,
    itemize: taxProfile.itemize,
    ytdItemizedCents: taxProfile.itemized_total_cents ?? 0,
    charitableGivenCents,
    currentMonth,
    // Pass company creation date so suggestions can suppress
    // "missed Q1 estimate" and underpayment-shortfall framing for
    // quarters that ended before the company existed.
    companyCreatedAt: company.created_at ?? null,
  });

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-10">
        <PageHeader
          logo={
            <CompanyLogo
              src={company.logo_url}
              name={company.name}
              size={64}
            />
          }
          eyebrow={`Tax year ${taxYear}`}
          title={company.name}
        />

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="forecast" />
        </div>

        {/* Fixed top-right pill — out of flow so it never pushes content down. */}
        {hasConnections ? (
          <SyncFreshness
            publicId={publicId}
            label={syncLabel}
            level={syncLevel}
            canSync={hasConnections}
          />
        ) : null}

        {/* Two-column on lg+: the forecast narrative on the left, a sticky
            "year-end moves" + quick-actions panel on the right. Below lg it
            collapses to one column (the panel stacks at the end as a natural
            "what to do next"). */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8 lg:items-start">
          <div className="min-w-0">

        {/* Story hero: the human-language forecast.
            Banner copy is conditional on whether the user actually has
            data that paces (recurring rows). When everything logged is
            one-off and there's no recurring data, "if you keep up at
            this pace" is misleading — the math doesn't pace one-offs,
            it counts them once. Resolves the May 2026 audit's Critical
            #3 framing concern (the math behind each panel is correct;
            the labels just over-promised). */}
        {(() => {
          const hasRecurring =
            recurringIncomeMonthly.some((c) => c > 0) ||
            recurringExpenseMonthly.some((c) => c > 0);
          const headlineCopy = hasRecurring ? (
            <>
              If you keep up at this pace,{" "}
              <span className="text-forest-800 font-semibold">
                {company.name}
              </span>{" "}
              will owe about{" "}
              <span className="gold-shine">
                {formatCents(result.totalTaxCents)}
              </span>{" "}
              for the year.
            </>
          ) : (
            <>
              Based on what you&apos;ve logged so far,{" "}
              <span className="text-forest-800 font-semibold">
                {company.name}
              </span>{" "}
              will owe about{" "}
              <span className="gold-shine">
                {formatCents(result.totalTaxCents)}
              </span>{" "}
              for the year.
            </>
          );
          const subhead = hasRecurring
            ? `We project that to year-end and apply the IRS-published brackets for tax year ${taxYear} (Rev. Proc. 2025-32, including the One Big Beautiful Bill amendments).`
            : `Year-end estimate uses the figures you've logged once each (one-off entries aren't multiplied by a pace factor). Switch a row's cadence to monthly or quarterly on the income/expenses pages if you want it to repeat through year-end.`;
          return (
            <div className="card mt-8 p-6 sm:p-9">
              <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
                Tax year {taxYear} forecast
              </div>
              <h2 className="display mt-2 text-2xl sm:text-3xl text-forest-900 leading-tight">
                {headlineCopy}
              </h2>
              <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-2xl">
                Right now you have logged{" "}
                <strong className="text-forest-900">
                  {formatCents(ytdResult.ytdIncomeCents)}
                </strong>{" "}
                of income and{" "}
                <strong className="text-forest-900">
                  {formatCents(ytdResult.ytdDeductibleExpensesCents)}
                </strong>{" "}
                of deductible expenses across {input.monthsEntered} month
                {input.monthsEntered === 1 ? "" : "s"}. {subhead}
              </p>
              {/* Surface the active tax profile so the user doesn't
                  silently inherit an old default (audit Medium #4). */}
              <div className="mt-3 text-[11px] text-ink-muted leading-relaxed">
                Using your saved tax profile:{" "}
                <span className="text-forest-800 font-medium">
                  {prettyFilingStatus(taxProfile.filing_status as FilingStatus)}
                </span>
                , {taxProfile.dependents} dependent
                {taxProfile.dependents === 1 ? "" : "s"}
                {taxProfile.age != null ? `, age ${taxProfile.age}` : ""}.{" "}
                <Link
                  href={`/onboarding/tax-profile?next=/c/${publicId}/forecast`}
                  className="underline decoration-dotted hover:text-forest-900"
                >
                  Edit
                </Link>
              </div>
            </div>
          );
        })()}
        {/* S-Corp reasonable-compensation warning (Round-2 audit HIGH-3).
            §3121(d)(1) / Rev. Rul. 74-44: an S-Corp shareholder-employee
            who works in the business MUST take "reasonable" W-2 wages
            before any distribution. Taking $0 wages is the textbook
            audit trigger for the IRS to recharacterize distributions as
            wages and assess back FICA + penalties + interest. The
            forecast currently treats the whole pass-through as
            distribution, which is the most optimistic possible
            scenario; surface a warning so the user adds wages on the
            profile page before relying on the forecast. */}
        {(company.entity_type ?? "sole_prop") === "s_corp" &&
          (taxProfile.owner_w2_wages_cents ?? 0) === 0 && (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/80 p-5 sm:p-6 dark:border-amber-700/40 dark:bg-amber-900/20">
              <div className="flex items-start gap-3">
                <div
                  aria-hidden="true"
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-800/40 dark:text-amber-200"
                >
                  !
                </div>
                <div className="flex-1 text-sm leading-relaxed text-amber-900 dark:text-amber-100">
                  <div className="font-semibold">
                    This S-Corp forecast assumes $0 owner wages.
                  </div>
                  <p className="mt-1.5 text-amber-900/90 dark:text-amber-100/90">
                    The IRS requires S-Corp owner-employees to take{" "}
                    <em>reasonable compensation</em> as W-2 wages before
                    any distribution (Rev. Rul. 74-44). Taking $0 wages
                    is a textbook audit trigger and the forecast below
                    will look more favorable than what you can defend on
                    return. Add your annualized W-2 wages on the profile
                    page so the SE-tax-vs-FICA math reflects reality.
                  </p>
                  <Link
                    href={`/onboarding/tax-profile?next=/c/${publicId}/forecast`}
                    className="mt-3 inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700/50 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/60"
                  >
                    Add owner W-2 wages →
                  </Link>
                </div>
              </div>
            </div>
          )}
        <div className="hidden">
          {/* Anchor element so the JSX below (compare columns + tiles +
              breakdown) keeps its original location in the rendered
              tree. The headline above was wrapped in an IIFE to share
              the `hasRecurring` flag with the subhead text. */}
        </div>
        <div className="card mt-8 p-6 sm:p-9">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Year-end view
          </div>

          {/* YTD vs Projected side-by-side. The YTD column answers "if
              you closed the books today, here's where you stand"; the
              Projected column answers "if you keep up at this pace plus
              your recurring rates, here's the year-end picture." */}
          {/* Stack the YTD/Projected columns vertically on phones (foldables
              especially - at 280px width the side-by-side numbers are
              unreadable). Side-by-side returns at sm: (640px+). */}
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <CompareColumn
              kicker="So far this year"
              tone="muted"
              rows={[
                {
                  label: "Income",
                  value: formatCents(ytdResult.ytdIncomeCents),
                },
                {
                  label: "Deductible expenses",
                  value: formatCents(ytdResult.ytdDeductibleExpensesCents),
                },
                {
                  label: "Net business income",
                  value: formatCents(ytdResult.ytdNetBusinessIncomeCents),
                },
                {
                  label: "Taxable income",
                  value: formatCents(ytdResult.taxableIncomeCents),
                },
                {
                  label: "Taxes owed",
                  value: formatCents(ytdResult.totalTaxCents),
                  emphasised: true,
                },
              ]}
            />
            <CompareColumn
              kicker="Year-end estimate"
              tone="bright"
              rows={[
                {
                  label: "Income",
                  value: formatCents(result.projectedIncomeCents),
                },
                {
                  label: "Deductible expenses",
                  value: formatCents(result.projectedExpensesCents),
                },
                {
                  label: "Net business income",
                  value: formatCents(result.projectedNetBusinessIncomeCents),
                },
                {
                  label: "Taxable income",
                  value: formatCents(result.taxableIncomeCents),
                },
                {
                  label: "Taxes owed",
                  value: formatCents(result.totalTaxCents),
                  emphasised: true,
                },
              ]}
            />
          </div>

          {/* Save target. Same bidirectional treatment as the personal
              forecast: if W-2 withholding + estimates exceeded total
              tax, surface the refund instead of "$0 still owed". A
              business owner who's also a W-2 employee will frequently
              land here when withholding from the day job covers the
              SE tax for a side business. */}
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat
              label="Already paid"
              value={formatCents(result.alreadyPaidCents)}
            />
            {result.refundCents > 0 ? (
              <Stat
                label="Refund expected"
                value={formatCents(result.refundCents)}
                accent
              />
            ) : (
              <Stat
                label="Still owed"
                value={formatCents(result.stillOwedCents)}
                accent
              />
            )}
            <Stat
              label="Save per month to land at zero"
              value={formatCents(result.monthlySaveTargetCents)}
            />
          </div>
        </div>

        {/* Month by month — kept visible directly under the estimate as the
            clearest single overview. Everything more detailed is collapsed
            below to keep the center uncluttered. */}
        <div className="mt-6 card p-5 sm:p-7">
          <h2 className="display text-xl text-forest-900">Month by month</h2>
          <p className="text-xs text-ink-muted mt-1">
            Each bar shows what you logged that month; the table below is the
            same numbers as a ledger.
          </p>
          <MonthlyBars income={incomeByMonth} expenses={expenseByMonth} />
          <MonthlyTable
            incomeByMonth={incomeByMonth}
            expenseByMonth={expenseByMonth}
          />
        </div>

        {/* ---- Details, compressed into collapsible titled sections ---- */}

        {/* Benefits / recommendations strip. Each tile renders nothing
            when the relevant value is zero. */}
        <Collapsible
          title="Credits & benefits you qualify for"
          subtitle="Refundable credits, retirement savings, and withholding nudges tailored to your numbers."
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EitcTile result={result} />
            <EducationCreditTile result={result} />
            <RetirementSavingsTile result={result} />
            <RetirementRecommendationTile result={result} />
            <W4NudgeTile result={result} />
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <SaversCreditTile result={result} />
            <AmtTile result={result} />
            <CapitalGainsTile result={result} />
            <ForeignExclusionTile result={result} />
            <StudentLoanInterestTile result={result} />
          </div>
        </Collapsible>

        {/* Breakdown */}
        <Collapsible
          title="Tax breakdown"
          subtitle="Federal income tax, self-employment tax, and state — line by line."
        >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card title="Federal income tax">
            <BigNumber>{formatCents(result.federalIncomeTaxCents)}</BigNumber>
            <RowKV
              label="Taxable income"
              value={formatCents(result.taxableIncomeCents)}
            />
            {result.childAndDependentCreditsCents > 0 ? (
              <RowKV
                label="Child / dependent credits"
                value={`- ${formatCents(result.childAndDependentCreditsCents)}`}
              />
            ) : null}
            <RowKV label="Marginal rate" value={pct(result.marginalRate)} />
            {/* "Effective rate" under the FIT tile is FIT / taxable
                income — the audit's High #4 caught the UI rendering
                the combined total/gross figure here, which produced
                things like "Federal income tax $0, Effective rate 11%".
                Combined effective rate moved to its own row below
                with a clear label. */}
            <RowKV
              label="Effective rate (FIT / taxable)"
              value={pct(result.federalIncomeTaxEffectiveRate)}
            />
            <RowKV
              label="Overall (all tax / gross)"
              value={pct(result.effectiveRate)}
            />
          </Card>
          <Card title="Self-employment tax">
            <BigNumber>{formatCents(result.selfEmploymentTaxCents)}</BigNumber>
            <RowKV label="Entity type" value={prettyEntity(input.entityType)} />
            <RowKV
              label="Net business income (proj.)"
              value={formatCents(result.projectedNetBusinessIncomeCents)}
            />
            <RowKV
              label="QBI deduction"
              value={formatCents(result.qbiDeductionCents)}
            />
          </Card>
          <Card title="State">
            <BigNumber>{formatCents(result.stateTaxCents)}</BigNumber>
            <RowKV
              label="State"
              value={
                company.state_code ?? taxProfile.state_code ?? "Not set"
              }
            />
            <RowKV
              label="Method"
              value="Flat-rate estimate"
            />
            <p className="mt-3 text-xs text-ink-muted leading-relaxed">
              State estimate uses the company&apos;s state of operation
              {company.state_code && taxProfile.state_code && company.state_code !== taxProfile.state_code ? (
                <>
                  {" "}
                  ({company.state_code}, not your personal profile state{" "}
                  {taxProfile.state_code})
                </>
              ) : null}
              . Real bracketed math for all 50 states is on the roadmap.
            </p>
          </Card>
        </div>
        </Collapsible>


        {result.taxableIncomeCents > 0 && company.entity_type !== "c_corp" ? (
          <Collapsible
            title="Your federal tax brackets"
            subtitle={`How your projected taxable income fills the ${taxYear} brackets — only income in each band is taxed at that band's rate.`}
          >
            <BracketLadder
              brackets={federalBrackets}
              taxableIncomeCents={result.taxableIncomeCents}
            />
          </Collapsible>
        ) : null}

        {/* How we calculated this */}
        {result.assumptions.length > 0 ? (
          <Collapsible title="How we got these numbers">
            <ul className="grid gap-2">
              {result.assumptions.map((a, i) => (
                <li
                  key={i}
                  className="text-sm text-ink-soft leading-relaxed flex gap-2"
                >
                  <span className="text-gold-700 mt-1">✓</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </Collapsible>
        ) : null}

        {/* Tax-savings playbook teaser → links to /savings-goals */}
        <Link
          href={`/c/${publicId}/savings-goals`}
          className="block mt-6 card card-hover p-6 sm:p-7 border-gold-300/60"
        >
          {/* Layout: stack vertically on mobile so the body copy uses
              the full card width; switch to row at sm+ so the CTA
              link sits in the right gutter. The earlier
              flex-row-with-wrap default left the body in a very
              narrow column on phones because the link sibling held
              its full intrinsic width on the same row. */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
                Goals · Detailed how-to
              </div>
              <h2 className="display mt-1 text-xl text-forest-900">
                Open the tax-savings playbook
              </h2>
              <p className="mt-1 text-sm text-ink-soft leading-relaxed max-w-2xl">
                A personalized list of goals — 401(k) maxing, HSA, SEP-IRA,
                Solo 401(k), Backdoor Roth, 529 plans, charitable bunching, EV
                credits, energy upgrades — each with step-by-step instructions
                on exactly how to execute. None of these are new business
                expenses; they&apos;re strategies that absorb your tax bill.
              </p>
            </div>
            <span className="text-forest-700 font-medium shrink-0">
              View playbook &rarr;
            </span>
          </div>
        </Link>

        {/* Quarterly estimated payment schedule.
            A quarter that ended BEFORE this company was created should
            not surface as "Past — you missed $X." The business didn't
            exist; there's no catch-up to do. The May 2026 audit
            (Medium #2) caught a today-created company showing Q1 as
            "PAST $629" with a "Catch up on Q1" prompt; that was
            misleading at best and could prompt an unnecessary IRS
            payment at worst. Pre-formation quarters now render with a
            "Pre-formation" badge and a muted explanation. */}
        {result.quarterlyEstimates.some((q) => q.amountCents > 0) ? (
          <Collapsible
            kicker="Quarterly estimates"
            title="Pay-as-you-go schedule"
            subtitle="The IRS expects taxes throughout the year — what to send each quarter (W-2 withholding counts as paid evenly)."
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {result.quarterlyEstimates.map((q) => {
                const companyCreatedAt = company.created_at
                  ? new Date(company.created_at)
                  : null;
                const quarterDue = new Date(q.dueDate);
                const isPreFormation =
                  companyCreatedAt != null &&
                  q.isPast &&
                  companyCreatedAt > quarterDue;
                return (
                  <div
                    key={q.quarter}
                    className={
                      "rounded-xl border p-4 " +
                      (q.isPast
                        ? "bg-cream/50 border-forest-100 text-forest-900"
                        : "bg-white border-gold-300/60 text-forest-900")
                    }
                  >
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em]">
                      <span
                        className={q.isPast ? "text-ink-muted" : "text-gold-700"}
                      >
                        Q{q.quarter}
                      </span>
                      {isPreFormation ? (
                        <span className="text-ink-muted">Pre-formation</span>
                      ) : q.isPast ? (
                        <span className="text-ink-muted">Past</span>
                      ) : null}
                    </div>
                    <div className="display text-lg sm:text-xl mt-1 tabular-nums">
                      {formatCents(q.amountCents)}
                    </div>
                    <div className="text-[11px] text-ink-muted mt-1">
                      Due {formatQuarterlyDate(q.dueDate)}
                    </div>
                    {isPreFormation ? (
                      <div className="text-[10px] text-ink-muted mt-1 leading-snug">
                        Company was created after this quarter — no catch-up
                        needed.
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-ink-muted leading-relaxed">
              Pay online at{" "}
              <a
                href="https://www.irs.gov/payments"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-forest-700"
              >
                IRS Direct Pay
              </a>
              . Past-quarter amounts (other than pre-formation quarters)
              are what you should have paid by then — if you missed them,
              sending the catch-up before the next due date trims any
              underpayment penalty.
            </p>
          </Collapsible>
        ) : null}

        {/* Deduction scorecard */}
        <Collapsible
          title="Deduction scorecard"
          subtitle="Which deductions you've captured and what's still on the table."
        >
          <DeductionScorecard publicId={publicId} scorecard={scorecard} embedded />
        </Collapsible>

        {/* Hints */}
        {result.hints.length > 0 ? (
          <Collapsible title="Notes from Bella">
            <ul className="grid gap-2">
              {result.hints.map((h, i) => (
                <li
                  key={i}
                  className="text-sm text-ink-soft leading-relaxed flex gap-2"
                >
                  <span className="text-gold-700">{"•"}</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </Collapsible>
        ) : null}

        {/* Tax-prep confidence section: export PDF + find a CPA near you. */}
        <Collapsible
          title="Work with a CPA"
          subtitle="Hand off a clean year-end summary, or find a preparer near you."
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 xl:gap-6">
            <div>
              <p className="text-sm text-ink-soft leading-relaxed">
                Use every deduction you earned this year, then hand a clean
                year-end summary to your tax preparer with EIN, address, income,
                expenses by Schedule C line, and IRC citations included.
              </p>
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <Link
                  href={`/c/${publicId}/export?year=${taxYear}`}
                  className="btn-primary"
                >
                  Open year-end summary
                </Link>
                <Link
                  href={`/c/${publicId}/profile`}
                  className="text-sm text-forest-700 hover:text-forest-900"
                >
                  Add EIN + business address &rarr;
                </Link>
              </div>
            </div>

            <FindCpaCard
              zip={businessProfile?.zip ?? null}
              stateCode={company.state_code ?? taxProfile.state_code ?? null}
              city={businessProfile?.city ?? null}
            />
          </div>
        </Collapsible>

        <p className="mt-12 text-[11px] leading-relaxed text-ink-muted max-w-2xl">
          Taxottic provides tax forecasting and educational guidance. Numbers
          shown are estimates based on the IRS-published federal brackets for
          tax year {taxYear} (Rev. Proc. 2025-32, reflecting the One Big
          Beautiful Bill amendments) and a curated state rate; they are not a
          tax return. Talk with a licensed CPA for decisions that matter.
        </p>

        <div className="mt-6">
          <ForecastDisclaimer variant="card" />
        </div>
          </div>

          {/* Sticky action panel: the deduction pie chart, the personalized
              year-end moves, and the per-company quick actions, always at
              hand while you read the forecast on the left. On lg+ it aligns
              with the top of the forecast and locks in place (its own scroll
              if the content runs taller than the viewport). */}
          <aside
            className="mt-8 lg:mt-0 lg:sticky lg:max-h-[calc(100vh_-_var(--app-header-h,4rem)_-_3rem)] lg:overflow-y-auto space-y-4"
            style={{ top: "calc(var(--app-header-h, 4rem) + 1.5rem)" }}
          >
            {deductionBreakdown.length > 0 ? (
              <div className="card p-5">
                <h2 className="display text-base text-forest-900">
                  Where your write-offs come from
                </h2>
                <p className="text-xs text-ink-muted mt-1">
                  Projected full-year deductions by source.
                </p>
                <DeductionDonut slices={deductionBreakdown} />
              </div>
            ) : null}
            <YearEndSuggestionsCard suggestions={suggestions} />
            <div className="flex flex-wrap gap-3">
              <Link href={`/c/${publicId}/income`} className="btn-ghost">
                Add income
              </Link>
              <Link href={`/c/${publicId}/expenses`} className="btn-ghost">
                Add expense
              </Link>
              <Link href={`/c/${publicId}/profile`} className="btn-ghost">
                Edit business profile
              </Link>
              {isManager ? (
                <Link href={`/c/${publicId}/manage`} className="btn-ghost">
                  + Invite employee
                </Link>
              ) : null}
              <Link href={`/c/${publicId}/chat`} className="btn-ghost">
                Open team chat
              </Link>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function CompareColumn({
  kicker,
  tone,
  rows,
}: {
  kicker: string;
  tone: "muted" | "bright";
  rows: { label: string; value: string; emphasised?: boolean }[];
}) {
  return (
    <div
      className={
        "rounded-2xl p-4 sm:p-5 " +
        (tone === "bright"
          ? "bg-forest-800 text-cream"
          : "bg-cream/60 border border-forest-100 text-forest-900")
      }
    >
      <div
        className={
          "text-[10px] uppercase tracking-[0.2em] " +
          (tone === "bright" ? "text-gold-300" : "text-gold-700")
        }
      >
        {kicker}
      </div>
      <div className="mt-3 grid gap-2">
        {rows.map((r, i) => {
          // Visual hierarchy: any row marked emphasised (currently the
          // "Taxes owed" line) gets a top divider and a heavier numeric
          // weight so the eye lands there last.
          const prevEmphasised = i > 0 && rows[i - 1] && !rows[i - 1].emphasised;
          const dividerClass =
            r.emphasised && prevEmphasised
              ? tone === "bright"
                ? "border-t border-cream/15 pt-2 mt-1"
                : "border-t border-forest-100 pt-2 mt-1"
              : "";
          return (
            // flex-wrap + min-w-0 lets the value drop to its own line below
            // the label when the column is too narrow to fit both on one
            // line (matters on foldables / sub-360px viewports). The label
            // anchors top-left; the value anchors right when on the same
            // line, otherwise flows from the left under the label.
            <div
              key={r.label}
              className={
                "flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 " +
                dividerClass
              }
            >
              <span
                className={
                  "text-xs min-w-0 " +
                  (tone === "bright" ? "text-cream/75" : "text-ink-soft") +
                  (r.emphasised ? " font-medium" : "")
                }
              >
                {r.label}
              </span>
              <span
                className={
                  "display tabular-nums break-words min-w-0 " +
                  (r.emphasised
                    ? tone === "bright"
                      ? "text-lg sm:text-xl text-gold-300"
                      : "text-lg sm:text-xl text-forest-900"
                    : "text-base sm:text-lg")
                }
              >
                {r.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthlyTable({
  incomeByMonth,
  expenseByMonth,
}: {
  incomeByMonth: number[];
  expenseByMonth: number[];
}) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return (
    // Tighter cell padding + no min-width so the table fits inside any
    // viewport down to ~280px (foldables) without sideways scrolling. The
    // text-xs sm:text-sm step keeps the body legible on phones; numbers
    // stay tabular for vertical alignment.
    <div className="mt-5">
      <table className="w-full text-xs sm:text-sm border-collapse table-fixed">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-ink-muted">
            <th className="py-1.5 pr-1 sm:pr-2 font-medium w-10 sm:w-14">Month</th>
            <th className="py-1.5 px-1 sm:px-2 font-medium text-right">Income</th>
            <th className="py-1.5 px-1 sm:px-2 font-medium text-right">Expenses</th>
            <th className="py-1.5 pl-1 sm:pl-2 font-medium text-right">Net</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m, i) => {
            const inc = incomeByMonth[i] ?? 0;
            const exp = expenseByMonth[i] ?? 0;
            const net = inc - exp;
            const empty = inc === 0 && exp === 0;
            return (
              <tr
                key={m}
                className={
                  "border-b border-forest-50 last:border-0 " +
                  (empty ? "text-ink-muted" : "text-forest-900")
                }
              >
                <td className="py-1.5 pr-1 sm:pr-2 font-medium">{m}</td>
                <td className="py-1.5 px-1 sm:px-2 text-right tabular-nums break-all">
                  {empty ? "-" : formatCents(inc)}
                </td>
                <td className="py-1.5 px-1 sm:px-2 text-right tabular-nums break-all">
                  {empty ? "-" : formatCents(exp)}
                </td>
                <td
                  className={
                    "py-1.5 pl-1 sm:pl-2 text-right tabular-nums break-all " +
                    (net < 0 && !empty ? "text-red-700" : "")
                  }
                >
                  {empty ? "-" : formatCents(net)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "rounded-xl bg-forest-800 text-cream p-4"
          : "rounded-xl bg-white border border-forest-100 p-4"
      }
    >
      <div
        className={
          accent
            ? "text-[11px] uppercase tracking-[0.2em] text-gold-300"
            : "text-[11px] uppercase tracking-[0.2em] text-gold-700"
        }
      >
        {label}
      </div>
      <div
        className={
          accent
            ? "display text-2xl mt-1 text-cream"
            : "display text-2xl mt-1 text-forest-900"
        }
      >
        {value}
      </div>
    </div>
  );
}

// Collapsible titled section — native <details> (no client JS, works in this
// server component). Used to compress the secondary forecast sections so the
// center column stays uncluttered; the user expands what they want to see.
function Collapsible({
  title,
  subtitle,
  kicker,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  kicker?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="mt-4 card p-5 sm:p-6 group" open={defaultOpen}>
      <summary className="flex items-center justify-between gap-3 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          {kicker ? (
            <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
              {kicker}
            </div>
          ) : null}
          <h2 className="display text-lg text-forest-900">{title}</h2>
          {subtitle ? (
            <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>
          ) : null}
        </div>
        <span
          aria-hidden
          className="shrink-0 text-gold-700 transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-6">
      <h2 className="text-xs uppercase tracking-[0.2em] text-gold-700">
        {title}
      </h2>
      {children}
    </div>
  );
}

function BigNumber({ children }: { children: React.ReactNode }) {
  return (
    <div className="display text-3xl text-forest-900 mt-2">{children}</div>
  );
}

function RowKV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-1.5 border-b last:border-b-0 border-forest-50">
      <span className="text-ink-muted">{label}</span>
      <span className="text-forest-900 font-medium">{value}</span>
    </div>
  );
}

// Bar colours as explicit hex (not Tailwind bg-* classes): the forecast
// renders on the dark navy theme where the primary brand navy (#243150)
// was nearly the same as the card, making income bars invisible. Income
// uses the brand's LIGHTER blue (forest-400) — on-brand and legible on the
// dark card; expenses use brand gold.
const BAR_INCOME = "#5e6f9c"; // forest-400 (brand blue)
const BAR_EXPENSE = "#c4a25d"; // gold-500 (deeper — reads on white and dark)

function MonthlyBars({
  income,
  expenses,
}: {
  income: number[];
  expenses: number[];
}) {
  const months = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const peak = Math.max(...income, ...expenses, 1);
  return (
    <div className="mt-5 grid grid-cols-12 gap-1.5">
      {months.map((m, i) => {
        const inH = (income[i] / peak) * 100;
        const exH = (expenses[i] / peak) * 100;
        return (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="w-full h-32 flex items-end gap-0.5">
              <div
                className="flex-1 rounded-sm"
                style={{ height: `${inH}%`, background: BAR_INCOME }}
                title={`Income ${formatCents(income[i])}`}
              />
              <div
                className="flex-1 rounded-sm"
                style={{ height: `${exH}%`, background: BAR_EXPENSE }}
                title={`Expenses ${formatCents(expenses[i])}`}
              />
            </div>
            <span className="text-[10px] text-ink-muted">{m}</span>
          </div>
        );
      })}
      <div className="col-span-12 mt-2 flex gap-4 text-[11px] text-ink-muted justify-end">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ background: BAR_INCOME }}
          />
          Income
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ background: BAR_EXPENSE }}
          />
          Deductible expenses
        </span>
      </div>
    </div>
  );
}

// Compact money for chart axes / labels: $1.2k, $34k, $1.1M.
function compactCents(cents: number): string {
  const d = Math.abs(cents) / 100;
  const sign = cents < 0 ? "-" : "";
  if (d >= 1_000_000) return `${sign}$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000) return `${sign}$${Math.round(d / 1_000)}k`;
  return `${sign}$${Math.round(d)}`;
}

// ---------------------------------------------------------------------------
// Deduction pie — SVG ring of where the write-offs come from + a legend.
// Lives in the (narrow, ~20rem) sidebar, so it stacks: ring on top, legend
// below. Raw SVG fills aren't touched by the dark-theme remap, so every
// colour is a LIGHT tone that reads on the dark card. DISTINCT HUES (not
// shades of the same two colours) so adjacent slices never look alike.
// ---------------------------------------------------------------------------
const DONUT_COLORS = [
  "#c4a25d", // gold (deeper — reads on white + dark)
  "#3f95ad", // teal
  "#d1728d", // rose
  "#5fae72", // green
  "#8f6fd4", // lavender
  "#d1893f", // orange
];

function DeductionDonut({
  slices,
}: {
  slices: { key: string; label: string; cents: number }[];
}) {
  const total = slices.reduce((a, s) => a + s.cents, 0);
  if (total <= 0) return null;
  const R = 60;
  const C = 2 * Math.PI * R;
  const fracs = slices.map((s) => s.cents / total);
  const arcs = slices.map((s, i) => {
    const frac = fracs[i];
    const startFrac = fracs.slice(0, i).reduce((a, b) => a + b, 0);
    return {
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      dash: frac * C,
      gap: C - frac * C,
      offset: -startFrac * C,
    };
  });

  return (
    <div className="mt-4 flex flex-col items-center gap-4">
      <svg viewBox="0 0 160 160" className="w-32 h-32 shrink-0 -rotate-90">
        {arcs.map((a, i) => (
          <circle
            key={i}
            cx="80"
            cy="80"
            r={R}
            fill="none"
            stroke={a.color}
            strokeWidth="22"
            strokeDasharray={`${a.dash} ${a.gap}`}
            strokeDashoffset={a.offset}
          />
        ))}
        <text
          x="80"
          y="80"
          textAnchor="middle"
          dominantBaseline="central"
          transform="rotate(90 80 80)"
          className="text-forest-900"
          fill="currentColor"
          style={{ fontSize: 16, fontWeight: 700 }}
        >
          {compactCents(total)}
        </text>
      </svg>
      <ul className="grid gap-1.5 w-full">
        {slices.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
            />
            <span className="text-ink-soft flex-1 truncate">{s.label}</span>
            <span className="tabular-nums text-ink-muted">
              {((s.cents / total) * 100).toFixed(0)}%
            </span>
            <span className="tabular-nums text-forest-800 w-16 text-right">
              {formatCents(s.cents)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bracket ladder — how taxable income fills the federal ordinary brackets.
// ---------------------------------------------------------------------------
function BracketLadder({
  brackets,
  taxableIncomeCents,
}: {
  brackets: { rate: number; upTo: number | null }[];
  taxableIncomeCents: number;
}) {
  // Each bracket's lower bound is the previous bracket's upper bound (the
  // `upTo` values are cumulative). Precompute so nothing is reassigned
  // during render.
  const lowers = brackets.map((_, i) =>
    i === 0 ? 0 : (brackets[i - 1].upTo ?? 0),
  );
  const rows = brackets.map((b, i) => {
    const lower = lowers[i];
    const upper = b.upTo; // cents or null
    const width = upper == null ? null : upper - lower;
    const filled = Math.max(
      0,
      Math.min(taxableIncomeCents, upper ?? Infinity) - lower,
    );
    const fillPct = width == null ? (filled > 0 ? 100 : 0) : (filled / width) * 100;
    const isMarginal =
      taxableIncomeCents > lower && (upper == null || taxableIncomeCents <= upper);
    return {
      rate: b.rate,
      upper,
      rangeLabel:
        upper == null
          ? `${compactCents(lower)}+`
          : `${compactCents(lower)} – ${compactCents(upper)}`,
      fillPct: Math.max(0, Math.min(100, fillPct)),
      isMarginal,
      taxedHere: filled,
    };
  });
  const marginalRow = rows.find((r) => r.isMarginal);
  const marginalNote =
    marginalRow && marginalRow.upper != null
      ? `${formatCents(marginalRow.upper - taxableIncomeCents)} of income left before the ${pct(
          nextRate(brackets, marginalRow.rate),
        )} bracket.`
      : null;

  return (
    <div className="mt-5 grid gap-1.5">
      {rows.map((r, i) => (
        <div
          key={i}
          className={`grid grid-cols-[3rem_1fr_5rem] items-center gap-2 rounded px-1.5 py-1 ${
            r.isMarginal ? "bg-gold-100/70 ring-1 ring-gold-300" : ""
          }`}
        >
          <span
            className={`text-xs font-semibold tabular-nums ${
              r.isMarginal ? "text-gold-800" : "text-ink-soft"
            }`}
          >
            {pct(r.rate)}
          </span>
          <div className="relative h-4 rounded bg-forest-100">
            <div
              className={`absolute top-0 left-0 h-4 rounded ${
                r.isMarginal ? "bg-gold-500" : "bg-forest-600"
              }`}
              style={{ width: `${r.fillPct}%` }}
            />
            <span className="absolute inset-0 flex items-center pl-2 text-[10px] text-ink-muted">
              {r.rangeLabel}
            </span>
          </div>
          <span className="text-[11px] text-right tabular-nums text-ink-muted">
            {r.taxedHere > 0 ? compactCents(r.taxedHere) : "—"}
          </span>
        </div>
      ))}
      {marginalNote ? (
        <p className="text-xs text-gold-800 mt-2">{marginalNote}</p>
      ) : null}
    </div>
  );
}

function nextRate(
  brackets: { rate: number }[],
  current: number,
): number {
  const idx = brackets.findIndex((b) => b.rate === current);
  return brackets[idx + 1]?.rate ?? current;
}

function pct(rate: number): string {
  return (rate * 100).toFixed(1) + "%";
}

function formatQuarterlyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function prettyEntity(t: EntityType): string {
  return (
    {
      sole_prop: "Sole Proprietor",
      single_llc: "Single-Member LLC",
      multi_llc: "Multi-Member LLC",
      s_corp: "S-Corp",
      c_corp: "C-Corp",
      partnership: "Partnership",
      self_employed_1099: "1099 / Self-Employed",
    }[t] ?? t
  );
}

function prettyFilingStatus(s: FilingStatus): string {
  return (
    {
      single: "Single",
      married_filing_jointly: "Married filing jointly",
      married_filing_separately: "Married filing separately",
      head_of_household: "Head of household",
      qualifying_widow: "Qualifying widow(er)",
    }[s] ?? s
  );
}
