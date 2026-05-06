import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { CompanyLogo } from "@/components/CompanyLogo";
import { DeductionScorecard } from "@/components/DeductionScorecard";
import { FindCpaCard } from "@/components/FindCpaCard";
import { YearEndSuggestionsCard } from "@/components/YearEndSuggestionsCard";
import { buildYearEndSuggestions } from "@/lib/tax/year-end-suggestions";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
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
import type { FilingStatus } from "@/lib/tax/constants-2025";
import {
  buildScorecard,
  eligibleDeductions,
} from "@/lib/deductions/eligibility";
import {
  combineMonthly,
  expandRowToMonthly,
  totalOfMonthly,
  ytdOfMonthly,
  type Recurrence,
} from "@/lib/tax/recurrence";

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

  const currentMonth = new Date().getUTCMonth() + 1;

  // Split rows by recurrence. One-off rows are samples that we still
  // pace-project for the year-end view; recurring rows are deterministic
  // rates that we expand to a per-month series so the YTD vs projected
  // numbers are honest for users who have, say, $1000/mo rent.
  type IncomeRow = {
    amount_cents: number;
    month: number;
    recurrence: Recurrence | null;
  };
  type ExpenseRow = IncomeRow & { category_code: string };

  const incomes = (incomeRows ?? []) as IncomeRow[];
  const expenses = (expenseRows ?? []) as ExpenseRow[];

  const isRecurring = (r: { recurrence: Recurrence | null }) =>
    (r.recurrence ?? "one_off") !== "one_off";

  // ---------- Pace projection for one-off rows ----------
  // The user's expected behavior: "I logged income for the months that
  // happened so far; project that to year-end." Recurring rows opt out
  // of pace projection (they have an explicit cadence).
  const oneOffIncomes = incomes.filter((r) => !isRecurring(r));
  const oneOffExpenses = expenses.filter((r) => !isRecurring(r));
  const monthsWithOneOff = uniqueMonths([
    ...oneOffIncomes.map((r) => r.month),
    ...oneOffExpenses.map((r) => r.month),
  ]);
  const oneOffPaceFactor = monthsWithOneOff > 0 ? 12 / monthsWithOneOff : 1;

  // ---------- Recurring rows expanded ----------
  const recurringIncomeMonthly = combineMonthly(
    incomes.filter(isRecurring).map((r) =>
      expandRowToMonthly({
        month: r.month,
        amount_cents: r.amount_cents,
        recurrence: r.recurrence,
      }),
    ),
  );
  const recurringExpenseMonthly = combineMonthly(
    expenses.filter(isRecurring).map((r) =>
      expandRowToMonthly({
        month: r.month,
        amount_cents: r.amount_cents,
        recurrence: r.recurrence,
      }),
    ),
  );

  // Bucket helper: sum amounts for a predicate from one-off rows.
  const sumOneOff = (
    rows: ExpenseRow[],
    pick: (r: ExpenseRow) => boolean,
  ): number =>
    rows
      .filter((r) => !isRecurring(r) && pick(r))
      .reduce((a, r) => a + r.amount_cents, 0);

  // Bucket recurring expenses by category type. We need per-bucket
  // monthly arrays so we can take YTD or full-year for each.
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

  const recurringMealsMonthly = monthlyForExpenses(
    (r) => r.category_code === "meals",
  );
  const recurringAboveTheLineMonthly = monthlyForExpenses((r) =>
    ABOVE_THE_LINE_CODES.has(r.category_code),
  );
  const recurringBizExpenseMonthly = monthlyForExpenses(
    (r) =>
      r.category_code !== "meals" &&
      !ABOVE_THE_LINE_CODES.has(r.category_code),
  );

  // ---------- "As-of-today" totals (close books today) ----------
  const ytdIncomeRealised =
    oneOffIncomes.reduce((a, r) => a + r.amount_cents, 0) +
    ytdOfMonthly(recurringIncomeMonthly, currentMonth);
  const ytdMealsRealised =
    sumOneOff(expenses, (r) => r.category_code === "meals") +
    ytdOfMonthly(recurringMealsMonthly, currentMonth);
  const ytdAboveTheLineRealised =
    sumOneOff(expenses, (r) => ABOVE_THE_LINE_CODES.has(r.category_code)) +
    ytdOfMonthly(recurringAboveTheLineMonthly, currentMonth);
  const ytdBizExpensesRealised =
    sumOneOff(
      expenses,
      (r) =>
        r.category_code !== "meals" &&
        !ABOVE_THE_LINE_CODES.has(r.category_code),
    ) + ytdOfMonthly(recurringBizExpenseMonthly, currentMonth);

  // ---------- Year-end projected totals ----------
  // A "one-off" is by user definition a single event - we count it
  // once, full stop. We DO NOT pace-project one-offs (a $500 expense
  // logged in March was previously becoming $500 × 12/3 = $2000
  // year-end, which surprised everyone). Recurring rows still get
  // their deterministic per-cadence expansion via expandRowToMonthly.
  // The oneOffPaceFactor is now only used by the auto-mileage
  // pro-rate below where we genuinely need to extrapolate from
  // limited odometer data.
  const projIncome =
    oneOffIncomes.reduce((a, r) => a + r.amount_cents, 0) +
    totalOfMonthly(recurringIncomeMonthly);
  const projMeals =
    sumOneOff(expenses, (r) => r.category_code === "meals") +
    totalOfMonthly(recurringMealsMonthly);
  const projAboveTheLine =
    sumOneOff(expenses, (r) => ABOVE_THE_LINE_CODES.has(r.category_code)) +
    totalOfMonthly(recurringAboveTheLineMonthly);
  const projBizExpenses =
    sumOneOff(
      expenses,
      (r) =>
        r.category_code !== "meals" &&
        !ABOVE_THE_LINE_CODES.has(r.category_code),
    ) + totalOfMonthly(recurringBizExpenseMonthly);

  // Auto-deductions from business profile. Mileage pace-projects from
  // YTD miles using one-off-style logic; for the YTD view we don't
  // project, we use the real YTD value.
  const autoMileageProjected = businessProfile?.has_vehicle &&
    businessProfile?.vehicle_method === "standard"
    ? computeMileageDeductionCents({
        ytdMiles: businessProfile.vehicle_business_miles ?? 0,
        monthsEntered: Math.max(1, monthsWithOneOff),
      })
    : 0;
  const autoMileageYtd = businessProfile?.has_vehicle &&
    businessProfile?.vehicle_method === "standard"
    ? Math.round(autoMileageProjected * (currentMonth / 12))
    : 0;
  const autoHomeOfficeFull = computeHomeOfficeSimplifiedCents({
    hasHomeOffice: businessProfile?.has_home_office ?? false,
    homeOfficeSqft: businessProfile?.home_office_sqft ?? null,
  });
  // Home office simplified is a year-cap deduction; for the YTD view we
  // pro-rate it to the share of year that has elapsed.
  const autoHomeOfficeYtd = Math.round(
    autoHomeOfficeFull * (currentMonth / 12),
  );

  // The engine is also our tax calculator. By passing monthsEntered=12
  // we tell it "don't pace-project anything; the numbers I'm giving you
  // ARE the year-end numbers". We then run it twice: once with the YTD
  // figures (close books today) and once with the projected figures.
  const sharedInput: Omit<
    ForecastInput,
    | "ytdIncomeCents"
    | "ytdBusinessExpensesCents"
    | "ytdMealsCents"
    | "ytdAboveTheLineCents"
    | "autoMileageCents"
    | "autoHomeOfficeCents"
    | "monthsEntered"
  > = {
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
    ytdItemizedCents: taxProfile.itemized_total_cents ?? 0,
  };

  // YTD scenario: "if you closed your books today, what's the bill?"
  const ytdResult: ForecastResult = forecast({
    ...sharedInput,
    ytdIncomeCents: Math.round(ytdIncomeRealised),
    ytdBusinessExpensesCents: Math.round(ytdBizExpensesRealised),
    ytdMealsCents: Math.round(ytdMealsRealised),
    ytdAboveTheLineCents: Math.round(ytdAboveTheLineRealised),
    autoMileageCents: autoMileageYtd,
    autoHomeOfficeCents: autoHomeOfficeYtd,
    monthsEntered: 12,
  });

  // Projected scenario: "if you keep up at this pace + recurring rates."
  const result: ForecastResult = forecast({
    ...sharedInput,
    ytdIncomeCents: Math.round(projIncome),
    ytdBusinessExpensesCents: Math.round(projBizExpenses),
    ytdMealsCents: Math.round(projMeals),
    ytdAboveTheLineCents: Math.round(projAboveTheLine),
    autoMileageCents: autoMileageProjected,
    autoHomeOfficeCents: autoHomeOfficeFull,
    monthsEntered: 12,
  });

  // Build a "summary input" that the existing UI references for things
  // like the entity type display and the months-of-data hint string.
  const input = {
    monthsEntered: Math.max(
      1,
      monthsWithOneOff > 0
        ? monthsWithOneOff
        : Math.min(currentMonth, 12),
    ),
    entityType: (company.entity_type ?? "sole_prop") as EntityType,
  };

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
  const capturedByCode = new Map<string, number>();
  for (const r of expenses) {
    if (isRecurring(r)) {
      const yearTotal = totalOfMonthly(
        expandRowToMonthly({
          month: r.month,
          amount_cents: r.amount_cents,
          recurrence: r.recurrence,
        }),
      );
      capturedByCode.set(
        r.category_code,
        (capturedByCode.get(r.category_code) ?? 0) + yearTotal,
      );
    } else {
      capturedByCode.set(
        r.category_code,
        (capturedByCode.get(r.category_code) ?? 0) +
          Math.round(r.amount_cents * oneOffPaceFactor),
      );
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
    hasHomeOffice: businessProfile?.has_home_office ?? null,
    homeOfficeSqft: businessProfile?.home_office_sqft ?? null,
    itemize: taxProfile.itemize,
    ytdItemizedCents: taxProfile.itemized_total_cents ?? 0,
    currentMonth,
  });

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <CompanyLogo
              src={company.logo_url}
              name={company.name}
              size={64}
            />
            <div>
              <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
                {company.public_id} <span className="text-gold-500">·</span>{" "}
                Tax year {taxYear}
              </div>
              <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
                {company.name}
              </h1>
              {/* Tapered gold flourish: a refined alternative to a hard rule. */}
              <div
                aria-hidden="true"
                className="gold-flourish mt-3"
              >
                <span />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="forecast" />
        </div>

        {/* Story hero: the human-language forecast. */}
        <div className="card mt-8 p-6 sm:p-9">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Tax year {taxYear} forecast
          </div>
          <h2 className="display mt-2 text-2xl sm:text-3xl text-forest-900 leading-tight">
            If you keep up at this pace,{" "}
            <span className="text-forest-800 font-semibold">
              {company.name}
            </span>{" "}
            will owe about{" "}
            <span className="gold-shine">
              {formatCents(result.totalTaxCents)}
            </span>{" "}
            for the year.
          </h2>
          <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-2xl">
            Right now you have logged{" "}
            <strong className="text-forest-900">
              {formatCents(result.ytdIncomeCents)}
            </strong>{" "}
            of income and{" "}
            <strong className="text-forest-900">
              {formatCents(result.ytdDeductibleExpensesCents)}
            </strong>{" "}
            of deductible expenses across {input.monthsEntered} month
            {input.monthsEntered === 1 ? "" : "s"}. We project that to year-
            end and apply 2025 tax rules.
          </p>

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
              kicker="Projected to year-end"
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

          {/* Save target */}
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat
              label="Already paid"
              value={formatCents(result.alreadyPaidCents)}
            />
            <Stat
              label="Still owed"
              value={formatCents(result.stillOwedCents)}
              accent
            />
            <Stat
              label="Save per month to land at zero"
              value={formatCents(result.monthlySaveTargetCents)}
            />
          </div>
        </div>

        {/* Breakdown */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
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
            <RowKV label="Effective rate" value={pct(result.effectiveRate)} />
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
            <RowKV label="State" value={taxProfile.state_code ?? "Not set"} />
            <RowKV
              label="Method"
              value="Flat-rate estimate"
            />
            <p className="mt-3 text-xs text-ink-muted leading-relaxed">
              State estimate uses a curated flat rate. Real bracketed math for
              all 50 states is on the roadmap.
            </p>
          </Card>
        </div>

        {/* Monthly chart + per-month grid */}
        <div className="mt-6 card p-7">
          <h2 className="display text-xl text-forest-900">
            Month by month
          </h2>
          <p className="text-xs text-ink-muted mt-1">
            Each bar shows what you logged that month. The table below shows
            the same numbers as a side-by-side ledger.
          </p>
          <MonthlyBars income={incomeByMonth} expenses={expenseByMonth} />
          <MonthlyTable
            incomeByMonth={incomeByMonth}
            expenseByMonth={expenseByMonth}
          />
        </div>

        {/* How we calculated this */}
        {result.assumptions.length > 0 ? (
          <div className="mt-6 card p-6 border-gold-300/60">
            <h2 className="display text-base text-forest-900">
              How we got these numbers
            </h2>
            <ul className="mt-3 grid gap-2">
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
          </div>
        ) : null}

        {/* Year-end suggestions: personalized moves the user can still make. */}
        <YearEndSuggestionsCard suggestions={suggestions} />

        {/* Tax-savings playbook teaser → links to /savings-goals */}
        <Link
          href={`/c/${publicId}/savings-goals`}
          className="block mt-6 card card-hover p-6 sm:p-7 border-gold-300/60"
        >
          <div className="flex items-start gap-3 flex-wrap">
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
            <span className="text-forest-700 font-medium">
              View playbook &rarr;
            </span>
          </div>
        </Link>

        {/* Quarterly estimated payment schedule */}
        {result.quarterlyEstimates.some((q) => q.amountCents > 0) ? (
          <div className="mt-6 card p-6 sm:p-7">
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              Quarterly estimates
            </div>
            <h2 className="display mt-1 text-xl text-forest-900">
              Pay-as-you-go schedule
            </h2>
            <p className="mt-1 text-sm text-ink-soft leading-relaxed max-w-xl">
              The IRS expects taxes throughout the year, not just on April 15.
              W-2 withholding counts as if it were paid evenly across all
              four quarters; the table below shows what to send for each one.
            </p>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {result.quarterlyEstimates.map((q) => (
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
                    <span className={q.isPast ? "text-ink-muted" : "text-gold-700"}>
                      Q{q.quarter}
                    </span>
                    {q.isPast ? (
                      <span className="text-ink-muted">Past</span>
                    ) : null}
                  </div>
                  <div className="display text-lg sm:text-xl mt-1 tabular-nums">
                    {formatCents(q.amountCents)}
                  </div>
                  <div className="text-[11px] text-ink-muted mt-1">
                    Due {formatQuarterlyDate(q.dueDate)}
                  </div>
                </div>
              ))}
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
              . Past-quarter amounts are what you should have paid by then —
              if you missed them, sending the catch-up before the next due
              date trims any underpayment penalty.
            </p>
          </div>
        ) : null}

        {/* Deduction scorecard */}
        <DeductionScorecard publicId={publicId} scorecard={scorecard} />

        {/* Hints */}
        {result.hints.length > 0 ? (
          <div className="mt-6 card p-6 border-gold-300/60">
            <h2 className="display text-base text-forest-900">Notes from Bella</h2>
            <ul className="mt-3 grid gap-2">
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
          </div>
        ) : null}

        {/* Tax-prep confidence section: export PDF + find a CPA near you */}
        <section className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-6 sm:p-7">
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              Year-end export
            </div>
            <h2 className="display mt-1 text-xl text-forest-900">
              Walk into your CPA confident, not anxious.
            </h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              The law lets your business come first. Use every deduction you
              earned this year, then hand a clean year-end summary to your tax
              preparer with EIN, address, income, expenses by Schedule C line,
              and IRC citations included.
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
            stateCode={taxProfile.state_code ?? company.state_code ?? null}
            city={businessProfile?.city ?? null}
          />
        </section>

        {/* Quick actions */}
        <div className="mt-6 flex flex-wrap gap-3">
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

        <p className="mt-12 text-[11px] leading-relaxed text-ink-muted max-w-2xl">
          Taxottic provides tax forecasting and educational guidance. Numbers
          shown are estimates based on the 2025 federal brackets and a curated
          state rate; they are not a tax return. Talk with a licensed CPA for
          decisions that matter.
        </p>
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
                className="flex-1 bg-forest-700 rounded-sm"
                style={{ height: `${inH}%` }}
                title={`Income ${formatCents(income[i])}`}
              />
              <div
                className="flex-1 bg-gold-400 rounded-sm"
                style={{ height: `${exH}%` }}
                title={`Expenses ${formatCents(expenses[i])}`}
              />
            </div>
            <span className="text-[10px] text-ink-muted">{m}</span>
          </div>
        );
      })}
      <div className="col-span-12 mt-2 flex gap-4 text-[11px] text-ink-muted justify-end">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 bg-forest-700 rounded-sm" />
          Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 bg-gold-400 rounded-sm" />
          Deductible expenses
        </span>
      </div>
    </div>
  );
}

function uniqueMonths(months: number[]): number {
  return new Set(months).size;
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
