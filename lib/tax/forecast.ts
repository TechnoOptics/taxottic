/**
 * Forecast engine. Pure functions, no IO. Given inputs (profile + monthly
 * entries + business profile), returns a projected federal/state/SE tax
 * estimate plus a monthly save target.
 *
 * Everything is in cents (integer). All percentages are decimals (0.22 = 22%).
 *
 * IMPORTANT: this is forecasting, not tax advice. Disclaimers belong in the UI.
 */

import {
  ADDITIONAL_STD_DEDUCTION_2025,
  FEDERAL_BRACKETS_2025,
  QBI_2025,
  SE_TAX_2025,
  STANDARD_DEDUCTION_2025,
  stateRate,
  type FilingStatus,
} from "./constants-2025";

// ----------------------------------------------------------------------------
// Inputs
// ----------------------------------------------------------------------------

export type EntityType =
  | "sole_prop"
  | "single_llc"
  | "multi_llc"
  | "s_corp"
  | "c_corp"
  | "partnership"
  | "self_employed_1099";

export type ForecastInput = {
  taxYear: number;
  filingStatus: FilingStatus;
  stateCode: string | null;
  age: number | null;
  isBlind: boolean;
  itemize: boolean;
  dependents: number;
  spouseIncomeCents: number;
  estimatedPaymentsCents: number;

  entityType: EntityType;
  ytdIncomeCents: number;       // sum of monthly_income for current year
  ytdExpenseCents: number;      // sum of monthly_expenses for current year
  ytdMealsCents: number;        // subset of expenses tagged as meals (50% rule)
  ytdItemizedCents: number;     // personal itemized deductions if itemizing

  // Months of data we have. Used to project full-year amounts linearly when
  // the user hasn't entered a full year yet.
  monthsEntered: number;
};

// ----------------------------------------------------------------------------
// Output shape
// ----------------------------------------------------------------------------

export type ForecastResult = {
  // Projected to year-end based on the months-entered ratio
  projectedIncomeCents: number;
  projectedExpensesCents: number;
  projectedNetBusinessIncomeCents: number;

  // Federal pieces
  selfEmploymentTaxCents: number;
  qbiDeductionCents: number;
  taxableIncomeCents: number;
  federalIncomeTaxCents: number;

  // State (rough flat-rate estimate)
  stateTaxCents: number;

  // Total liability
  totalTaxCents: number;
  alreadyPaidCents: number;
  stillOwedCents: number;

  // What to set aside per remaining month to land at zero by April 15
  monthlySaveTargetCents: number;

  // Effective + marginal rates for display
  effectiveRate: number;
  marginalRate: number;

  // Useful flags / hints for the UI
  hints: string[];
};

// ----------------------------------------------------------------------------
// Forecast engine
// ----------------------------------------------------------------------------

const SE_ENTITY_TYPES: ReadonlySet<EntityType> = new Set([
  "sole_prop",
  "single_llc",
  "self_employed_1099",
  // multi-member LLCs and partnerships report SE tax via Schedule K-1; treat
  // the same for forecast purposes.
  "multi_llc",
  "partnership",
]);

export function forecast(input: ForecastInput): ForecastResult {
  const hints: string[] = [];
  const months = Math.max(1, Math.min(12, input.monthsEntered));

  // 1. Project full-year income / expenses.
  const projectionFactor = 12 / months;
  const projectedIncome = round(input.ytdIncomeCents * projectionFactor);

  // Expenses: meals are subject to 50% deductibility, so split them out.
  const ytdNonMealExpenses = Math.max(
    0,
    input.ytdExpenseCents - input.ytdMealsCents,
  );
  const ytdDeductibleMeals = Math.round(input.ytdMealsCents * 0.5);
  const ytdDeductibleExpenses = ytdNonMealExpenses + ytdDeductibleMeals;
  const projectedExpenses = round(ytdDeductibleExpenses * projectionFactor);

  const netBiz = Math.max(0, projectedIncome - projectedExpenses);

  // 2. Self-employment tax (only if entity type is pass-through to Schedule C/SE).
  let seTax = 0;
  if (SE_ENTITY_TYPES.has(input.entityType)) {
    seTax = computeSelfEmploymentTax(netBiz, input.filingStatus);
  }

  // 3. The self-employed get to deduct half of SE tax above-the-line.
  const halfSeTaxDeduction = Math.round(seTax / 2);

  // 4. Build AGI: net business income + spouse income, minus half-SE-tax.
  const agi = Math.max(
    0,
    netBiz + input.spouseIncomeCents - halfSeTaxDeduction,
  );

  // 5. Standard or itemized deduction.
  const stdDeduction = computeStandardDeduction(input);
  const deduction = input.itemize
    ? Math.max(stdDeduction, input.ytdItemizedCents)
    : stdDeduction;
  if (input.itemize && input.ytdItemizedCents < stdDeduction) {
    hints.push(
      "Your itemized total is below the standard deduction. Switching to standard would lower taxable income.",
    );
  }

  // 6. QBI deduction (only for pass-throughs and only below threshold).
  let qbi = 0;
  const qbiThreshold = QBI_2025.thresholdBelow[input.filingStatus];
  if (
    SE_ENTITY_TYPES.has(input.entityType) &&
    input.entityType !== "c_corp" &&
    netBiz > 0
  ) {
    if (agi <= qbiThreshold) {
      qbi = Math.round(netBiz * QBI_2025.rate);
    } else {
      hints.push(
        "Your AGI is above the QBI safe-harbor threshold. The actual §199A deduction depends on W-2 wages and qualified property and may need a CPA.",
      );
    }
  }

  // 7. Taxable income.
  const taxableIncome = Math.max(0, agi - deduction - qbi);

  // 8. Federal income tax via brackets.
  const fedTax = computeFederalIncomeTax(taxableIncome, input.filingStatus);

  // 9. State tax (rough flat-rate estimate).
  const stRate = stateRate(input.stateCode);
  const stTax = Math.round(taxableIncome * stRate);
  if (input.stateCode && stRate === 0) {
    // Could be a no-tax state OR one we have not modeled.
  }

  // 10. Total + remaining-to-save math.
  const totalTax = fedTax + seTax + stTax;
  const remaining = Math.max(0, totalTax - input.estimatedPaymentsCents);

  // Monthly save target: split the remaining tax across the months left in
  // the calendar year, plus through the April 15 filing deadline.
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1; // 1-12
  const monthsRemaining =
    input.taxYear > now.getUTCFullYear()
      ? 12
      : Math.max(1, 12 - currentMonth + 4); // remaining of this year + Jan-Apr
  const monthlySaveTarget = Math.round(remaining / monthsRemaining);

  // 11. Marginal + effective rates for display.
  const marginal = marginalFederalRate(taxableIncome, input.filingStatus);
  const effective =
    projectedIncome > 0 ? totalTax / projectedIncome : 0;

  // Hints based on context
  if (months < 3) {
    hints.push(
      "Only " +
        months +
        " months of data entered. Projections are early estimates and will tighten as you add more.",
    );
  }
  if (input.entityType === "s_corp") {
    hints.push(
      "S-Corp owner-employees pay payroll tax on reasonable wages instead of SE tax. Make sure your W-2 wages from the S-Corp are tracked separately.",
    );
  }
  if (input.entityType === "c_corp") {
    hints.push(
      "C-Corps pay a flat 21% federal tax at the entity level. This forecast applies that flat rate; personal taxes on dividends/wages are separate.",
    );
  }

  return {
    projectedIncomeCents: projectedIncome,
    projectedExpensesCents: projectedExpenses,
    projectedNetBusinessIncomeCents: netBiz,
    selfEmploymentTaxCents: seTax,
    qbiDeductionCents: qbi,
    taxableIncomeCents: taxableIncome,
    federalIncomeTaxCents: fedTax,
    stateTaxCents: stTax,
    totalTaxCents: totalTax,
    alreadyPaidCents: input.estimatedPaymentsCents,
    stillOwedCents: remaining,
    monthlySaveTargetCents: monthlySaveTarget,
    effectiveRate: effective,
    marginalRate: marginal,
    hints,
  };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function computeStandardDeduction(input: ForecastInput): number {
  let base = STANDARD_DEDUCTION_2025[input.filingStatus];
  const isMarried =
    input.filingStatus === "married_filing_jointly" ||
    input.filingStatus === "married_filing_separately" ||
    input.filingStatus === "qualifying_widow";
  const additional = isMarried
    ? ADDITIONAL_STD_DEDUCTION_2025.married
    : ADDITIONAL_STD_DEDUCTION_2025.single;
  if (input.age !== null && input.age >= 65) base += additional;
  if (input.isBlind) base += additional;
  return base;
}

function computeFederalIncomeTax(
  taxableIncomeCents: number,
  filingStatus: FilingStatus,
): number {
  const brackets = FEDERAL_BRACKETS_2025[filingStatus];
  let remaining = taxableIncomeCents;
  let lowerBound = 0;
  let tax = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Number.MAX_SAFE_INTEGER;
    const slice = Math.max(0, Math.min(remaining, upper - lowerBound));
    tax += Math.round(slice * b.rate);
    remaining -= slice;
    lowerBound = upper;
    if (remaining <= 0) break;
  }
  return tax;
}

function marginalFederalRate(
  taxableIncomeCents: number,
  filingStatus: FilingStatus,
): number {
  const brackets = FEDERAL_BRACKETS_2025[filingStatus];
  for (const b of brackets) {
    if (b.upTo === null || taxableIncomeCents < b.upTo) return b.rate;
  }
  return brackets[brackets.length - 1].rate;
}

function computeSelfEmploymentTax(
  netBizCents: number,
  filingStatus: FilingStatus,
): number {
  const seEarnings = Math.round(netBizCents * SE_TAX_2025.netEarningsFactor);
  if (seEarnings <= 0) return 0;

  const ssCap = SE_TAX_2025.socialSecurityWageBase;
  const ssBase = Math.min(seEarnings, ssCap);
  const ssTax = Math.round(ssBase * SE_TAX_2025.socialSecurityRate);

  const medicareTax = Math.round(seEarnings * SE_TAX_2025.medicareRate);

  let additional = 0;
  const threshold =
    SE_TAX_2025.additionalMedicareThreshold[filingStatus] ?? 0;
  if (seEarnings > threshold) {
    additional = Math.round(
      (seEarnings - threshold) * SE_TAX_2025.additionalMedicareRate,
    );
  }

  return ssTax + medicareTax + additional;
}

function round(n: number): number {
  return Math.round(n);
}

// ----------------------------------------------------------------------------
// Currency formatting helpers (UI side)
// ----------------------------------------------------------------------------

export function formatCents(
  cents: number,
  options: { showCents?: boolean } = {},
): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: options.showCents ? 2 : 0,
    maximumFractionDigits: options.showCents ? 2 : 0,
  }).format(dollars);
}

export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
