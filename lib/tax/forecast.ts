/**
 * Forecast engine. Pure functions, no IO. Given inputs (profile + monthly
 * entries + business profile), returns a projected federal/state/SE tax
 * estimate plus a monthly save target.
 *
 * Everything is in cents (integer). All percentages are decimals (0.22 = 22%).
 *
 * IMPORTANT: this is forecasting, not tax advice. Disclaimers belong in the UI.
 *
 * Math notes (audited 2026-04-28):
 * - Linear pace projection: full-year = ytd × (12 / monthsEntered). The UI
 *   surfaces ytd numbers separately so the user can see what is real vs.
 *   projected.
 * - Meals are 50% deductible per IRC §274(n).
 * - Standard mileage rate 2025 is $0.70/mile per IRS Notice 2025-3; auto-
 *   applied as a Schedule C expense when the business profile sets the
 *   standard-mileage method and reports business miles.
 * - Home office simplified method: $5 × min(sqft, 300) per IRS Pub 587;
 *   auto-applied when has_home_office and home_office_sqft are set and the
 *   user has not opted into actual-expense tracking.
 * - Self-employed health insurance, SE retirement contributions, and HSA
 *   contributions are above-the-line deductions on Schedule 1 (IRC §162(l)
 *   for SE health; §401(c) / §408(k) for retirement; §223 for HSA). They
 *   are NOT business expenses, so they reduce AGI but DO NOT reduce SE
 *   tax basis. The engine accepts them as a separate bucket.
 * - Half of SE tax is deducted above-the-line (IRC §164(f)).
 * - QBI: 20% of net business income for pass-throughs below the §199A
 *   threshold ($197,300 single / $394,600 MFJ in 2025). Above the
 *   threshold the calculation depends on W-2 wages, qualified property,
 *   and SSTB classification, so we surface a hint to consult a CPA.
 * - C-Corps are taxed at a flat 21% federal rate at the entity level
 *   (IRC §11). We apply that flat rate to net business income instead of
 *   running personal brackets.
 */

import {
  ADDITIONAL_STD_DEDUCTION_2025,
  FEDERAL_BRACKETS_2025,
  MILEAGE_RATE_2025_PER_MILE_CENTS,
  QBI_2025,
  SE_TAX_2025,
  STANDARD_DEDUCTION_2025,
  stateRate,
  type FilingStatus,
} from "./constants-2025";

export type EntityType =
  | "sole_prop"
  | "single_llc"
  | "multi_llc"
  | "s_corp"
  | "c_corp"
  | "partnership"
  | "self_employed_1099";

// Codes that are above-the-line adjustments, NOT Schedule C expenses.
export const ABOVE_THE_LINE_CODES: ReadonlySet<string> = new Set([
  "self_employed_health",
  "retirement_self",
  "hsa_contribution",
]);

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
  ytdIncomeCents: number;
  // Schedule C-style business expenses (excluding meals, which is its own
  // bucket and gets the 50% rule applied by the engine, and excluding
  // above-the-line items).
  ytdBusinessExpensesCents: number;
  ytdMealsCents: number;
  // Above-the-line items pulled out: SE health, SE retirement, HSA.
  ytdAboveTheLineCents: number;
  ytdItemizedCents: number;

  // Optional auto-computed business deductions when the profile makes
  // them obvious. These get added on top of ytdBusinessExpensesCents.
  // Caller passes 0 if not applicable.
  autoMileageCents: number;        // miles × IRS rate (annualized externally)
  autoHomeOfficeCents: number;     // simplified or actual, annualized externally

  monthsEntered: number;
};

export type ForecastResult = {
  projectedIncomeCents: number;
  projectedExpensesCents: number;
  projectedNetBusinessIncomeCents: number;

  selfEmploymentTaxCents: number;
  qbiDeductionCents: number;
  taxableIncomeCents: number;
  federalIncomeTaxCents: number;
  stateTaxCents: number;

  totalTaxCents: number;
  alreadyPaidCents: number;
  stillOwedCents: number;

  monthlySaveTargetCents: number;
  effectiveRate: number;
  marginalRate: number;

  // Year-to-date "as of today" snapshot (no projection): handy for the
  // "what you've actually earned vs. what you'll owe at this pace" UI.
  ytdIncomeCents: number;
  ytdDeductibleExpensesCents: number;
  ytdNetBusinessIncomeCents: number;

  // Plain-language explanation of what was assumed.
  assumptions: string[];
  hints: string[];
};

// ----------------------------------------------------------------------------
// Engine
// ----------------------------------------------------------------------------

const SE_ENTITY_TYPES: ReadonlySet<EntityType> = new Set([
  "sole_prop",
  "single_llc",
  "self_employed_1099",
  "multi_llc",
  "partnership",
]);

const C_CORP_RATE = 0.21;

export function forecast(input: ForecastInput): ForecastResult {
  const hints: string[] = [];
  const assumptions: string[] = [];
  const months = Math.max(1, Math.min(12, input.monthsEntered));
  const projectionFactor = 12 / months;

  // Apply meals 50% rule once, then build year-to-date deductible expenses.
  const ytdMealsDeductible = Math.round(input.ytdMealsCents * 0.5);
  const ytdDeductibleExpenses =
    Math.max(0, input.ytdBusinessExpensesCents) +
    ytdMealsDeductible +
    Math.max(0, input.autoMileageCents) +
    Math.max(0, input.autoHomeOfficeCents);
  const ytdNetBiz = Math.max(0, input.ytdIncomeCents - ytdDeductibleExpenses);

  if (input.autoMileageCents > 0) {
    assumptions.push(
      "Vehicle: standard mileage applied at the IRS 2025 rate of $0.70 per business mile.",
    );
  }
  if (input.autoHomeOfficeCents > 0) {
    assumptions.push(
      "Home office: simplified method applied ($5 per sq ft, up to 300 sq ft).",
    );
  }
  if (input.ytdMealsCents > 0) {
    assumptions.push("Meals: 50% deductibility applied per IRC §274(n).");
  }

  // Project full-year amounts via linear pace.
  const projectedIncome = round(input.ytdIncomeCents * projectionFactor);
  const projectedExpenses = round(ytdDeductibleExpenses * projectionFactor);
  const projectedAboveTheLine = round(
    Math.max(0, input.ytdAboveTheLineCents) * projectionFactor,
  );
  const netBiz = Math.max(0, projectedIncome - projectedExpenses);

  // C-Corp short-circuit: flat 21% on net business income.
  if (input.entityType === "c_corp") {
    const cTax = Math.round(netBiz * C_CORP_RATE);
    const stRate = stateRate(input.stateCode);
    const stTax = Math.round(netBiz * stRate);
    const totalTax = cTax + stTax;
    const remaining = Math.max(0, totalTax - input.estimatedPaymentsCents);
    const monthsRemaining = remainingMonthsToFilingDeadline(input.taxYear);
    const monthlySaveTarget = Math.round(remaining / monthsRemaining);
    hints.push(
      "C-Corp: a flat 21% federal rate is applied to net business income at the entity level. Personal taxes on dividends or wages are separate.",
    );
    return {
      projectedIncomeCents: projectedIncome,
      projectedExpensesCents: projectedExpenses,
      projectedNetBusinessIncomeCents: netBiz,
      selfEmploymentTaxCents: 0,
      qbiDeductionCents: 0,
      taxableIncomeCents: netBiz,
      federalIncomeTaxCents: cTax,
      stateTaxCents: stTax,
      totalTaxCents: totalTax,
      alreadyPaidCents: input.estimatedPaymentsCents,
      stillOwedCents: remaining,
      monthlySaveTargetCents: monthlySaveTarget,
      effectiveRate: projectedIncome > 0 ? totalTax / projectedIncome : 0,
      marginalRate: C_CORP_RATE,
      ytdIncomeCents: input.ytdIncomeCents,
      ytdDeductibleExpensesCents: ytdDeductibleExpenses,
      ytdNetBusinessIncomeCents: ytdNetBiz,
      assumptions,
      hints,
    };
  }

  // SE tax (only for pass-throughs / sole prop / partnerships / 1099).
  // S-Corp owners pay payroll on W-2 wages instead; we don't model wages here.
  let seTax = 0;
  if (SE_ENTITY_TYPES.has(input.entityType)) {
    seTax = computeSelfEmploymentTax(netBiz, input.filingStatus);
    assumptions.push(
      "Self-employment tax: 12.4% Social Security up to the $176,100 wage base + 2.9% Medicare uncapped, on 92.35% of net earnings (IRC §1401).",
    );
  }
  if (input.entityType === "s_corp") {
    hints.push(
      "S-Corp owner-employees pay payroll tax on reasonable W-2 wages instead of SE tax. Track W-2 wages separately.",
    );
  }

  // Half SE-tax is an above-the-line deduction (IRC §164(f)).
  const halfSeTaxDeduction = Math.round(seTax / 2);

  // AGI = net biz + spouse income - half SE tax - other above-the-line items.
  const agi = Math.max(
    0,
    netBiz +
      input.spouseIncomeCents -
      halfSeTaxDeduction -
      projectedAboveTheLine,
  );
  if (projectedAboveTheLine > 0) {
    assumptions.push(
      "Self-employed health insurance, retirement contributions, and HSA deductions are applied above-the-line (Schedule 1), not as Schedule C expenses.",
    );
  }

  // Standard or itemized.
  const stdDeduction = computeStandardDeduction(input);
  const deduction = input.itemize
    ? Math.max(stdDeduction, input.ytdItemizedCents)
    : stdDeduction;
  if (input.itemize && input.ytdItemizedCents < stdDeduction) {
    hints.push(
      "Your itemized total is below the standard deduction. Switching to standard would lower taxable income.",
    );
  }

  // QBI: 20% of net biz, only when AGI is below the §199A threshold and the
  // entity is a pass-through. Above threshold, surface a CPA hint and skip.
  let qbi = 0;
  const qbiThreshold = QBI_2025.thresholdBelow[input.filingStatus];
  if (SE_ENTITY_TYPES.has(input.entityType) && netBiz > 0) {
    if (agi <= qbiThreshold) {
      // QBI is limited to lesser of (20% of QBI, 20% of taxable income before QBI).
      const taxableBeforeQbi = Math.max(0, agi - deduction);
      qbi = Math.min(
        Math.round(netBiz * QBI_2025.rate),
        Math.round(taxableBeforeQbi * QBI_2025.rate),
      );
    } else {
      hints.push(
        "Your AGI is above the QBI safe-harbor threshold. The actual §199A deduction depends on W-2 wages, qualified property, and SSTB classification - confirm with a CPA.",
      );
    }
  }

  const taxableIncome = Math.max(0, agi - deduction - qbi);
  const fedTax = computeFederalIncomeTax(taxableIncome, input.filingStatus);

  const stRate = stateRate(input.stateCode);
  const stTax = Math.round(taxableIncome * stRate);
  if (stRate === 0 && input.stateCode) {
    assumptions.push(
      `State estimate uses ${input.stateCode}'s curated flat rate. Real bracket math for all states is on the roadmap.`,
    );
  }

  const totalTax = fedTax + seTax + stTax;
  const remaining = Math.max(0, totalTax - input.estimatedPaymentsCents);

  const monthsRemaining = remainingMonthsToFilingDeadline(input.taxYear);
  const monthlySaveTarget = Math.round(remaining / monthsRemaining);

  const marginal = marginalFederalRate(taxableIncome, input.filingStatus);
  const effective = projectedIncome > 0 ? totalTax / projectedIncome : 0;

  if (months < 3) {
    hints.push(
      `Only ${months} month${months === 1 ? "" : "s"} of data entered. Projections are early estimates and tighten as you log more.`,
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
    ytdIncomeCents: input.ytdIncomeCents,
    ytdDeductibleExpensesCents: ytdDeductibleExpenses,
    ytdNetBusinessIncomeCents: ytdNetBiz,
    assumptions,
    hints,
  };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Compute mileage deduction in cents, annualized from year-to-date miles.
 * If business profile only stores YTD miles, we project to year-end.
 */
export function computeMileageDeductionCents(args: {
  ytdMiles: number;
  monthsEntered: number;
}): number {
  if (!args.ytdMiles || args.ytdMiles <= 0) return 0;
  const projectionFactor =
    args.monthsEntered > 0 ? 12 / Math.min(12, args.monthsEntered) : 1;
  const projectedMiles = args.ytdMiles * projectionFactor;
  return Math.round(projectedMiles * MILEAGE_RATE_2025_PER_MILE_CENTS);
}

/**
 * Simplified home-office deduction: $5/sqft up to 300 sqft, max $1,500.
 * Returns 0 if either field is missing.
 */
export function computeHomeOfficeSimplifiedCents(args: {
  homeOfficeSqft: number | null;
  hasHomeOffice: boolean;
}): number {
  if (!args.hasHomeOffice) return 0;
  const sqft = args.homeOfficeSqft ?? 0;
  if (sqft <= 0) return 0;
  const eligibleSqft = Math.min(sqft, 300);
  return eligibleSqft * 500; // $5.00 per sqft = 500 cents
}

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

/**
 * Number of months from today until the federal filing deadline (Apr 15
 * of the following calendar year). Used to spread "still owed" into a
 * monthly save-target.
 */
function remainingMonthsToFilingDeadline(taxYear: number): number {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (taxYear > currentYear) return 12;
  // Months left in the calendar tax year + Jan/Feb/Mar/Apr of next year (4)
  return Math.max(1, 12 - currentMonth + 4);
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
