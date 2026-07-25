// Shared company-forecast assembly.
//
// This is a behaviour-preserving extraction of the assembly that used
// to live inline in app/c/[publicId]/forecast/page.tsx. BOTH the
// forecast page and the watch snapshot endpoint call this, so the two
// can never diverge. No I/O here, callers fetch the rows (so this
// stays pure + unit-testable); the logic is moved verbatim.

import {
  ABOVE_THE_LINE_CODES,
  computeHomeOfficeSimplifiedCents,
  computeMileageDeductionCents,
  forecast,
  type EntityType,
  type ForecastInput,
  type ForecastResult,
} from "@/lib/tax/forecast";
import type { FilingStatus } from "@/lib/tax/constants-2025";
import { getTaxYearConstants, type Bracket } from "@/lib/tax/constants";
import { resolveAutoMileageCents } from "@/lib/mileage/deduction";
import {
  combineMonthly,
  expandRowToMonthly,
  totalOfMonthly,
  ytdOfMonthly,
  type Recurrence,
} from "@/lib/tax/recurrence";

export type IncomeRow = {
  amount_cents: number;
  month: number;
  recurrence: Recurrence | null;
  // Last month (1-12) a recurring row's projection applies to. null =
  // project through December. Lets a cancelled/ended recurring charge
  // stop inflating the forecast, see lib/tax/recurrence.ts.
  recurrence_end_month?: number | null;
};
export type ExpenseRow = IncomeRow & { category_code: string };

// Only the fields the assembly reads. All optional/nullable exactly
// matching the page's `?? default` usage so behaviour is identical.
export type ForecastTaxProfile = {
  filing_status: string;
  state_code: string;
  age: number;
  is_blind: boolean;
  itemize: boolean;
  dependents: number;
  dependents_under_17?: number | null;
  spouse_income_cents?: number | null;
  estimated_payments_cents?: number | null;
  owner_w2_wages_cents?: number | null;
  owner_w2_withheld_cents?: number | null;
  owner_w2_ss_wages_cents?: number | null;
  spouse_w2_wages_cents?: number | null;
  spouse_w2_withheld_cents?: number | null;
  spouse_w2_ss_wages_cents?: number | null;
  itemized_total_cents?: number | null;
  solo_401k_contribution_cents?: number | null;
  sep_ira_contribution_cents?: number | null;
  traditional_ira_contribution_cents?: number | null;
  roth_ira_contribution_cents?: number | null;
  hsa_contribution_cents?: number | null;
  se_health_insurance_cents?: number | null;
  long_term_capital_gains_cents?: number | null;
  qualified_dividends_cents?: number | null;
  foreign_earned_income_cents?: number | null;
  student_loan_interest_cents?: number | null;
  qualified_education_expenses_cents?: number | null;
  claim_aotc?: boolean | null;
  itemized_salt_cents?: number | null;
  itemized_mortgage_interest_cents?: number | null;
  itemized_charity_cents?: number | null;
  itemized_medical_cents?: number | null;
  section_179_expense_cents?: number | null;
  residential_energy_credit_cents?: number | null;
  ev_credit_cents?: number | null;
  ptc_advance_payments_cents?: number | null;
};
export type ForecastBusinessProfile = {
  has_vehicle?: boolean | null;
  vehicle_method?: string | null;
  vehicle_business_miles?: number | null;
  has_home_office?: boolean | null;
  home_office_sqft?: number | null;
};
export type ForecastCompany = {
  state_code: string | null;
  entity_type: string | null;
};

export type CompanyForecastArgs = {
  taxYear: number;
  currentMonth: number; // 1-12 (UTC month + 1)
  company: ForecastCompany;
  taxProfile: ForecastTaxProfile;
  businessProfile: ForecastBusinessProfile | null;
  incomes: IncomeRow[];
  expenses: ExpenseRow[];
  // Caller sums these from mileage_trips (keeps this module I/O-free).
  trackedYtdMileageCents: number;
  trackedTripCount: number;
  /** Tax scope for the engine. Default "business" suppresses
   *  individual-return credits (CTC/ODC, EITC, Saver's, education),
   *  which is right for a company's own Schedule C view. Pass
   *  "personal" for a TRUE COMBINED 1040 (sole-prop / disregarded
   *  entity flowing onto the owner's return), where those credits DO
   *  apply — the dashboard's "incl. business" line was dropping every
   *  one of them (audit #23). */
  scope?: "business" | "personal";
};

export type CompanyForecast = {
  ytdResult: ForecastResult;
  result: ForecastResult;
  summary: { monthsEntered: number; entityType: EntityType };
  monthsWithOneOff: number;
  oneOffPaceFactor: number;
  isRecurring: (r: { recurrence: Recurrence | null }) => boolean;
  oneOffIncomes: IncomeRow[];
  oneOffExpenses: ExpenseRow[];
  expenses: ExpenseRow[];
  recurringIncomeMonthly: number[];
  recurringExpenseMonthly: number[];
  recurringBizExpenseMonthly: number[];
  recurringMealsMonthly: number[];
  recurringAboveTheLineMonthly: number[];
  /** Federal ordinary-income brackets for this filing status + year, so
   *  the UI can render the marginal-bracket ladder. Cumulative `upTo` in
   *  cents (last bracket has upTo: null). */
  federalBrackets: Bracket[];
  /** Projected full-year deduction sources, largest-first, for the
   *  "where your write-offs come from" pie chart. Zero buckets omitted. */
  deductionBreakdown: DeductionSlice[];
};

export type DeductionSlice = {
  key: string;
  label: string;
  cents: number;
};

function uniqueMonths(months: number[]): number {
  return new Set(months).size;
}

export function buildCompanyForecast(
  args: CompanyForecastArgs,
): CompanyForecast {
  const {
    taxYear,
    currentMonth,
    company,
    taxProfile,
    businessProfile,
    incomes,
    expenses,
    trackedYtdMileageCents,
    trackedTripCount,
    scope,
  } = args;

  const isRecurring = (r: { recurrence: Recurrence | null }) =>
    (r.recurrence ?? "one_off") !== "one_off";

  // ---------- Pace projection for one-off rows ----------
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
        recurrence_end_month: r.recurrence_end_month,
      }),
    ),
  );
  const recurringExpenseMonthly = combineMonthly(
    expenses.filter(isRecurring).map((r) =>
      expandRowToMonthly({
        month: r.month,
        amount_cents: r.amount_cents,
        recurrence: r.recurrence,
        recurrence_end_month: r.recurrence_end_month,
      }),
    ),
  );

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
            recurrence_end_month: r.recurrence_end_month,
          }),
        ),
    );

  // Vehicle-method election, needed BEFORE the expense sums: under the
  // standard-mileage method the per-mile rate already includes gas,
  // repairs, insurance and depreciation, so car_truck expense rows must
  // NOT also count as deductible business expenses — the bank feed
  // auto-categorizes gas stations into car_truck, so without this the
  // same vehicle was deducted twice (audit critical #4). Under an
  // explicit actual-expense election the reverse holds: car_truck rows
  // count and the mileage engine contributes zero.
  //
  // Standard mileage is the DEFAULT method, so treat a null/unset
  // vehicle_method as standard; only an explicit "actual" election
  // opts out (matches resolveAutoMileageCents).
  const onStandardVehicle =
    !!businessProfile?.has_vehicle &&
    businessProfile?.vehicle_method !== "actual";
  const carTruckExcluded = (r: { category_code: string }) =>
    onStandardVehicle && r.category_code === "car_truck";

  const recurringMealsMonthly = monthlyForExpenses(
    (r) => r.category_code === "meals",
  );
  const recurringAboveTheLineMonthly = monthlyForExpenses((r) =>
    ABOVE_THE_LINE_CODES.has(r.category_code),
  );
  const recurringBizExpenseMonthly = monthlyForExpenses(
    (r) =>
      r.category_code !== "meals" &&
      !ABOVE_THE_LINE_CODES.has(r.category_code) &&
      !carTruckExcluded(r),
  );

  // ---------- "As-of-today" totals ----------
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
        !ABOVE_THE_LINE_CODES.has(r.category_code) &&
        !carTruckExcluded(r),
    ) + ytdOfMonthly(recurringBizExpenseMonthly, currentMonth);

  // ---------- Year-end projected totals ----------
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
        !ABOVE_THE_LINE_CODES.has(r.category_code) &&
        !carTruckExcluded(r),
    ) + totalOfMonthly(recurringBizExpenseMonthly);

  // Auto-deductions from business profile.
  //
  const manualMileageProjected = onStandardVehicle
    ? computeMileageDeductionCents({
        ytdMiles: businessProfile?.vehicle_business_miles ?? 0,
        // Elapsed CALENDAR months (audit critical #7): the divisor used
        // to be months-with-one-off-ledger-entries, which is unrelated
        // to how long the miles took to accrue — an all-recurring
        // bookkeeping setup gave divisor 1 and multiplied real YTD
        // mileage by 12. Same basis as home office and manualYtdCents.
        monthsEntered: Math.max(1, currentMonth),
        taxYear,
      })
    : 0;

  const { ytdCents: autoMileageYtd, projectedCents: autoMileageProjected } =
    resolveAutoMileageCents({
      onStandardVehicle,
      onActualMethod: businessProfile?.vehicle_method === "actual",
      trackedYtdCents: trackedYtdMileageCents,
      trackedTripCount,
      manualProjectedCents: manualMileageProjected,
      manualYtdCents: Math.round(manualMileageProjected * (currentMonth / 12)),
      trackedProjectionMonths: Math.max(1, currentMonth),
    });
  const autoHomeOfficeFull = computeHomeOfficeSimplifiedCents({
    hasHomeOffice: businessProfile?.has_home_office ?? false,
    homeOfficeSqft: businessProfile?.home_office_sqft ?? null,
  });
  const autoHomeOfficeYtd = Math.round(
    autoHomeOfficeFull * (currentMonth / 12),
  );

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
    // Default business scope suppresses individual-return credits (child
    // tax credit, EITC, Saver's, education); a combined 1040 view passes
    // "personal" so they apply (see the scope arg).
    scope: scope ?? "business",
    filingStatus: taxProfile.filing_status as FilingStatus,
    stateCode: company.state_code ?? taxProfile.state_code,
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
    retirementSolo401kCents: taxProfile.solo_401k_contribution_cents ?? 0,
    retirementSepIraCents: taxProfile.sep_ira_contribution_cents ?? 0,
    retirementTraditionalIraCents:
      taxProfile.traditional_ira_contribution_cents ?? 0,
    retirementRothIraCents: taxProfile.roth_ira_contribution_cents ?? 0,
    retirementHsaCents: taxProfile.hsa_contribution_cents ?? 0,
    selfEmployedHealthInsuranceCents:
      taxProfile.se_health_insurance_cents ?? 0,
    longTermCapitalGainsCents: taxProfile.long_term_capital_gains_cents ?? 0,
    qualifiedDividendsCents: taxProfile.qualified_dividends_cents ?? 0,
    foreignEarnedIncomeCents: taxProfile.foreign_earned_income_cents ?? 0,
    studentLoanInterestCents: taxProfile.student_loan_interest_cents ?? 0,
    qualifiedEducationExpensesCents:
      taxProfile.qualified_education_expenses_cents ?? 0,
    claimAotc: taxProfile.claim_aotc ?? false,
    itemizedSaltCents: taxProfile.itemized_salt_cents ?? undefined,
    itemizedMortgageInterestCents:
      taxProfile.itemized_mortgage_interest_cents ?? undefined,
    itemizedCharityCents: taxProfile.itemized_charity_cents ?? undefined,
    itemizedMedicalCents: taxProfile.itemized_medical_cents ?? undefined,
    section179ExpenseCents: taxProfile.section_179_expense_cents ?? 0,
    residentialEnergyCreditCents:
      taxProfile.residential_energy_credit_cents ?? 0,
    evCreditCents: taxProfile.ev_credit_cents ?? 0,
    ptcAdvancePaymentsCents: taxProfile.ptc_advance_payments_cents ?? 0,
  };

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

  const summary = {
    monthsEntered: Math.max(
      1,
      monthsWithOneOff > 0 ? monthsWithOneOff : Math.min(currentMonth, 12),
    ),
    entityType: (company.entity_type ?? "sole_prop") as EntityType,
  };

  // Federal ordinary-income brackets for the marginal-bracket ladder.
  const k = getTaxYearConstants(taxYear);
  const filingStatus = taxProfile.filing_status as FilingStatus;
  const federalBrackets =
    k.FEDERAL_BRACKETS[filingStatus] ?? k.FEDERAL_BRACKETS.single;

  // Where the year-end write-offs come from (pie chart). Non-overlapping
  // projected deduction sources: business expenses already EXCLUDE meals +
  // above-the-line (see the filters above), and mileage / home office are
  // auto-deductions tracked separately, so the buckets don't double-count.
  const deductionBreakdown: DeductionSlice[] = [
    { key: "expenses", label: "Business expenses", cents: Math.round(projBizExpenses) },
    { key: "mileage", label: "Vehicle / mileage", cents: autoMileageProjected },
    { key: "home_office", label: "Home office", cents: autoHomeOfficeFull },
    { key: "meals", label: "Meals (50%)", cents: Math.round(projMeals * 0.5) },
    {
      key: "retirement",
      label: "Retirement & health",
      cents: result.retirementContributionTotalCents,
    },
    { key: "qbi", label: "QBI deduction (20%)", cents: result.qbiDeductionCents },
  ]
    .filter((s) => s.cents > 0)
    .sort((a, b) => b.cents - a.cents);

  return {
    federalBrackets,
    deductionBreakdown,
    ytdResult,
    result,
    summary,
    monthsWithOneOff,
    oneOffPaceFactor,
    isRecurring,
    oneOffIncomes,
    oneOffExpenses,
    expenses,
    recurringIncomeMonthly,
    recurringExpenseMonthly,
    recurringBizExpenseMonthly,
    recurringMealsMonthly,
    recurringAboveTheLineMonthly,
  };
}
