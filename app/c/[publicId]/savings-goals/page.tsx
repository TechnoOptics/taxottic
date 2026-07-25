import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { SavingsGoalCard } from "@/components/SavingsGoalCard";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveAutoMileageCents } from "@/lib/mileage/deduction";
import {
  ABOVE_THE_LINE_CODES,
  computeHomeOfficeSimplifiedCents,
  computeMileageDeductionCents,
  forecast,
  formatCents,
  type EntityType,
  type ForecastInput,
  type ForecastResult,
} from "@/lib/tax/forecast";
import {
  buildSavingsGoals,
  totalSavingsAcrossGoals,
  type GoalCategory,
  type SavingsGoal,
} from "@/lib/tax/savings-goals";
import type { FilingStatus } from "@/lib/tax/constants-2025";
import {
  combineMonthly,
  expandRowToMonthly,
  totalOfMonthly,
  type Recurrence,
} from "@/lib/tax/recurrence";
import { adoptSavingsGoal } from "./actions";

type Params = Promise<{ publicId: string }>;

const CATEGORY_ORDER: GoalCategory[] = [
  "compliance",
  "retirement",
  "health",
  "investment",
  "charitable",
  "education",
  "energy",
];

const CATEGORY_LABEL: Record<GoalCategory, string> = {
  retirement: "Retirement",
  health: "Health & medical",
  education: "Education",
  investment: "Investments",
  charitable: "Charitable giving",
  energy: "Energy & home",
  compliance: "Compliance",
};

const CATEGORY_INTRO: Record<GoalCategory, string> = {
  retirement:
    "Pre-tax retirement contributions reduce AGI dollar-for-dollar at your marginal rate. The fastest, most reliable way to absorb a tax bill.",
  health:
    "HSA + FSA accounts shelter medical spending from income tax (and FICA when through payroll). HSAs are the only triple-tax-advantaged vehicle in the U.S. tax code.",
  education:
    "529 plans grow tax-free for college costs; many states offer a state-tax deduction or credit on top.",
  investment:
    "Year-end portfolio moves to capture losses, defer gains, and bunch deductions across years.",
  charitable:
    "Strategies that turn your existing giving into a bigger deduction, bunching, donor-advised funds, appreciated stock.",
  energy:
    "Federal credits for energy-efficient home upgrades and EV purchases, direct dollar-for-dollar reductions, not deductions.",
  compliance:
    "Stay on the right side of the IRS, withholding, safe harbors, and underpayment-penalty avoidance.",
};

export default async function SavingsGoalsPage({
  params,
}: {
  params: Params;
}) {
  const { publicId } = await params;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);
  const taxYear = new Date().getUTCFullYear();
  const currentMonth = new Date().getUTCMonth() + 1;

  // Run the forecast, same shape as the forecast page so the goal
  // engine sees real numbers (marginal rate, AGI, SE income, etc.).
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
    redirect(`/onboarding/tax-profile?next=/c/${publicId}/savings-goals`);
  }

  type IncomeRow = { amount_cents: number; month: number; recurrence: Recurrence | null };
  type ExpenseRow = IncomeRow & { category_code: string };
  const incomes = (incomeRows ?? []) as IncomeRow[];
  const expenses = (expenseRows ?? []) as ExpenseRow[];

  const isRecurring = (r: { recurrence: Recurrence | null }) =>
    (r.recurrence ?? "one_off") !== "one_off";
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

  const projIncome =
    incomes.filter((r) => !isRecurring(r)).reduce((a, r) => a + r.amount_cents, 0) +
    totalOfMonthly(
      combineMonthly(
        incomes.filter(isRecurring).map((r) =>
          expandRowToMonthly({
            month: r.month,
            amount_cents: r.amount_cents,
            recurrence: r.recurrence,
          }),
        ),
      ),
    );
  const projMeals =
    sumOneOff(expenses, (r) => r.category_code === "meals") +
    totalOfMonthly(monthlyForExpenses((r) => r.category_code === "meals"));
  const projAboveTheLine =
    sumOneOff(expenses, (r) => ABOVE_THE_LINE_CODES.has(r.category_code)) +
    totalOfMonthly(
      monthlyForExpenses((r) => ABOVE_THE_LINE_CODES.has(r.category_code)),
    );
  const projBizExpenses =
    sumOneOff(
      expenses,
      (r) =>
        r.category_code !== "meals" &&
        !ABOVE_THE_LINE_CODES.has(r.category_code),
    ) +
    totalOfMonthly(
      monthlyForExpenses(
        (r) =>
          r.category_code !== "meals" &&
          !ABOVE_THE_LINE_CODES.has(r.category_code),
      ),
    );
  // The forward-looking savings target only needs the year-end
  // figure. resolveAutoMileageCents lets the GPS tracker's classified-
  // business trips (an IRS-grade log) override the manual estimate,
  // gated by the standard-vs-actual-expense election, see that helper.
  // Null/unset method defaults to standard; only an explicit "actual"
  // election opts out (matches company-forecast + the forecast page).
  const onStandardVehicle =
    !!businessProfile?.has_vehicle &&
    businessProfile?.vehicle_method !== "actual";
  const manualMileageProjected = onStandardVehicle
    ? computeMileageDeductionCents({
        ytdMiles: businessProfile?.vehicle_business_miles ?? 0,
        monthsEntered: Math.max(1, currentMonth),
        // Price at the FORECAST's year, not the server's current year
        // (audit #33): a prior-year view silently used today's rate.
        taxYear,
      })
    : 0;
  const admin = createServiceClient();
  const { data: bizTripRows } = await admin
    .from("mileage_trips")
    .select("deduction_cents")
    .eq("company_id", company.id)
    .eq("classification", "business")
    .eq("tax_year", taxYear);
  const trackedTrips = (bizTripRows ?? []) as unknown as {
    deduction_cents: number;
  }[];
  const trackedYtdMileageCents = trackedTrips.reduce(
    (a, t) => a + Number(t.deduction_cents ?? 0),
    0,
  );
  const { projectedCents: autoMileageProjected } = resolveAutoMileageCents({
    onStandardVehicle,
    onActualMethod: businessProfile?.vehicle_method === "actual",
    trackedYtdCents: trackedYtdMileageCents,
    trackedTripCount: trackedTrips.length,
    manualProjectedCents: manualMileageProjected,
    manualYtdCents: 0,
    trackedProjectionMonths: currentMonth,
  });
  const autoHomeOfficeFull = computeHomeOfficeSimplifiedCents({
    hasHomeOffice: businessProfile?.has_home_office ?? false,
    homeOfficeSqft: businessProfile?.home_office_sqft ?? null,
  });

  const forecastInput: ForecastInput = {
    taxYear,
    filingStatus: taxProfile.filing_status as FilingStatus,
    stateCode: taxProfile.state_code,
    age: taxProfile.age,
    isBlind: taxProfile.is_blind,
    itemize: taxProfile.itemize,
    dependents: taxProfile.dependents,
    dependentsUnder17: taxProfile.dependents_under_17 ?? 0,
    spouseIncomeCents: taxProfile.spouse_income_cents ?? 0,
    estimatedPaymentsCents: taxProfile.estimated_payments_cents ?? 0,
    ownerW2WagesCents: taxProfile.owner_w2_wages_cents ?? 0,
    ownerW2WithheldCents: taxProfile.owner_w2_withheld_cents ?? 0,
    ownerW2SsWagesCents: taxProfile.owner_w2_ss_wages_cents ?? 0,
    spouseW2WagesCents: taxProfile.spouse_w2_wages_cents ?? 0,
    spouseW2WithheldCents: taxProfile.spouse_w2_withheld_cents ?? 0,
    spouseW2SsWagesCents: taxProfile.spouse_w2_ss_wages_cents ?? 0,
    entityType: (company.entity_type ?? "sole_prop") as EntityType,
    ytdIncomeCents: Math.round(projIncome),
    ytdBusinessExpensesCents: Math.round(projBizExpenses),
    ytdMealsCents: Math.round(projMeals),
    ytdAboveTheLineCents: Math.round(projAboveTheLine),
    ytdItemizedCents: taxProfile.itemized_total_cents ?? 0,
    autoMileageCents: autoMileageProjected,
    autoHomeOfficeCents: autoHomeOfficeFull,
    monthsEntered: 12,
  };
  const result: ForecastResult = forecast(forecastInput);

  const ytdRetirementContributionsCents =
    sumOneOff(expenses, (r) => r.category_code === "retirement_self") +
    totalOfMonthly(
      monthlyForExpenses((r) => r.category_code === "retirement_self"),
    );
  const ytdHsaContributionsCents =
    sumOneOff(expenses, (r) => r.category_code === "hsa_contribution") +
    totalOfMonthly(
      monthlyForExpenses((r) => r.category_code === "hsa_contribution"),
    );

  const goals = buildSavingsGoals({
    result,
    filingStatus: taxProfile.filing_status as FilingStatus,
    age: taxProfile.age,
    state: taxProfile.state_code,
    ownerW2WagesCents: taxProfile.owner_w2_wages_cents ?? 0,
    spouseW2WagesCents: taxProfile.spouse_w2_wages_cents ?? 0,
    netSeIncomeCents: result.projectedNetBusinessIncomeCents,
    ytdRetirementContributionsCents,
    ytdHsaContributionsCents,
    ytdItemizedCents: taxProfile.itemized_total_cents ?? 0,
    itemize: taxProfile.itemize,
    dependents: taxProfile.dependents,
    dependentsUnder17: taxProfile.dependents_under_17 ?? 0,
    publicId,
  });

  // Pull adopted goals: full rows so this page can render the company's
  // own goals ledger (business goals live HERE and on /goals under the
  // company's section — never mixed into personal surfaces), plus the
  // title set for marking recommendation cards "Adopted".
  const { data: adopted } = await supabase
    .from("goals")
    .select("id, title, target_cents, saved_cents, status, deadline")
    .eq("user_id", user.id)
    .eq("company_id", company.id)
    .eq("tax_year", taxYear)
    .order("created_at", { ascending: false });
  type AdoptedRow = {
    id: string;
    title: string;
    target_cents: number;
    saved_cents: number;
    status: string;
    deadline: string | null;
  };
  const adoptedRows = ((adopted ?? []) as AdoptedRow[]).filter(
    (g) => g.status === "active",
  );
  const adoptedTitles = new Set(
    ((adopted ?? []) as AdoptedRow[]).map((g) => g.title),
  );

  // Group by category for rendering.
  const byCategory = new Map<GoalCategory, SavingsGoal[]>();
  for (const g of goals) {
    const arr = byCategory.get(g.category) ?? [];
    arr.push(g);
    byCategory.set(g.category, arr);
  }

  const totalSavings = totalSavingsAcrossGoals(goals);

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.name} <span className="text-gold-700">·</span> Tax year{" "}
          {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
          Tax-savings playbook
        </h1>
        <p className="mt-2 text-sm text-ink-soft max-w-2xl leading-relaxed">
          Personalized goals based on your filing status, income, and tax
          profile, none of these are new business expenses. They&apos;re
          retirement contributions, health accounts, 529 plans, charitable
          strategies, and federal credits that can absorb your projected tax
          bill of{" "}
          <strong className="text-forest-900">
            {formatCents(result.totalTaxCents)}
          </strong>
          .
        </p>

        <div className="card mt-6 p-6 sm:p-7">
          <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
            Total savings if you adopt every applicable goal
          </div>
          <div className="display text-3xl sm:text-4xl text-forest-900 mt-1 tabular-nums">
            up to {formatCents(totalSavings)}
          </div>
          <p className="mt-2 text-xs text-ink-muted leading-relaxed max-w-xl">
            Calculated at your projected marginal rate of{" "}
            {(result.marginalRate * 100).toFixed(1)}%. Some goals overlap (you
            can&apos;t do both SEP-IRA and Solo 401(k)), so the practical
            ceiling is lower, pick the largest in each category.
          </p>
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <Link
              href={`/c/${publicId}/forecast`}
              className="text-sm text-forest-700 hover:text-forest-900"
            >
              ← Back to forecast
            </Link>
            <Link
              href="/goals"
              className="text-sm text-forest-700 hover:text-forest-900"
            >
              See adopted goals →
            </Link>
          </div>
        </div>

        {/* This company's adopted goals — the business goals ledger. Kept
            here (and under this company's section on /goals) so business
            goals never mix into the personal surfaces. */}
        {adoptedRows.length > 0 ? (
          <section className="card mt-6 p-6 sm:p-7">
            <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
              {company.name}
            </div>
            <h2 className="display text-xl text-forest-900 mt-1">
              Adopted goals
            </h2>
            <ul className="mt-4 grid gap-3">
              {adoptedRows.map((g) => {
                const pct =
                  g.target_cents > 0
                    ? Math.min(
                        100,
                        Math.round((g.saved_cents / g.target_cents) * 100),
                      )
                    : 0;
                return (
                  <li
                    key={g.id}
                    className="rounded-lg border border-forest-100 bg-white px-4 py-3"
                  >
                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <span className="text-sm font-medium text-forest-900 min-w-0 truncate">
                        {g.title}
                      </span>
                      <span className="text-xs text-ink-muted tabular-nums shrink-0">
                        {formatCents(g.saved_cents)} /{" "}
                        {formatCents(g.target_cents)} · {pct}%
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-forest-50 overflow-hidden">
                      <div
                        className="h-full bg-gold-400"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-ink-muted">
              Log progress on{" "}
              <Link href="/goals" className="underline decoration-dotted">
                the goals page
              </Link>
              , under {company.name}.
            </p>
          </section>
        ) : null}

        {goals.length === 0 ? (
          <div className="card mt-6 p-8 text-center">
            <p className="text-sm text-ink-soft">
              You&apos;re too early in the year for personalized goals. Come
              back once you&apos;ve logged some income / expenses or set your
              W-2 details on the tax profile.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid gap-8">
            {CATEGORY_ORDER.map((cat) => {
              const items = byCategory.get(cat);
              if (!items || items.length === 0) return null;
              return (
                <section key={cat}>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <h2 className="display text-xl text-forest-900">
                      {CATEGORY_LABEL[cat]}
                    </h2>
                    <span className="text-xs text-ink-muted">
                      {items.length} goal{items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted leading-relaxed max-w-2xl">
                    {CATEGORY_INTRO[cat]}
                  </p>
                  <ul className="mt-3 grid gap-2.5">
                    {items.map((goal) => (
                      <SavingsGoalCard
                        key={goal.id}
                        goal={goal}
                        companyId={company.id}
                        taxYear={taxYear}
                        alreadyAdopted={adoptedTitles.has(goal.title)}
                        adoptAction={adoptSavingsGoal}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        <div className="mt-10">
          <CompanyNav publicId={publicId} active="forecast" />
        </div>

        <p className="mt-12 text-[11px] leading-relaxed text-ink-muted max-w-2xl">
          Educational guidance based on 2025 federal tax law (IRC + IRS
          publications cited in each goal). Numbers are estimates at your
          marginal rate; many goals interact with each other (e.g. SEP-IRA
          and Solo 401(k) are alternatives, not stackable). Confirm with a
          licensed CPA or financial advisor before executing.
        </p>
      </section>
    </main>
  );
}
