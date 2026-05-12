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
  CHILD_TAX_CREDIT_2025,
  FEDERAL_BRACKETS_2025,
  MILEAGE_RATE_2025_PER_MILE_CENTS,
  NIIT_2025,
  QBI_2025,
  QUARTERLY_DUE_DATES_2025,
  SE_TAX_2025,
  STANDARD_DEDUCTION_2025,
  UNDERPAYMENT_SAFE_HARBOR_2025,
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
  // Of the total dependents, how many are qualifying children under 17.
  // The rest fall back to the Credit for Other Dependents ($500). If 0,
  // we treat all dependents as "other".
  dependentsUnder17: number;
  // Generic spouse income fallback (kept for backwards compatibility with
  // older profiles that haven't broken out W-2 yet). When the explicit
  // spouseW2WagesCents is set, that takes precedence.
  spouseIncomeCents: number;
  estimatedPaymentsCents: number;

  // Owner's W-2 wages (annual). Many self-employed users moonlight: a
  // day-job W-2 plus a side-hustle. We need the W-2 income to land in
  // taxable income, the W-2 withholding to count as already-paid, and
  // the W-2 SS wages to reduce the remaining SS wage base for SE tax.
  ownerW2WagesCents: number;
  ownerW2WithheldCents: number;
  ownerW2SsWagesCents: number;

  // Spouse W-2 wages (annual), withholding, and SS wages.
  spouseW2WagesCents: number;
  spouseW2WithheldCents: number;
  spouseW2SsWagesCents: number;

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

  // Investment income (year-to-date): interest, dividends, capital
  // gains, passive rental. Drives the Net Investment Income Tax (3.8%
  // surtax) when modified AGI is above the threshold. Optional —
  // callers without investment data pass 0 and NIIT computes to 0.
  ytdInvestmentIncomeCents?: number;
};

export type QuarterlyEstimate = {
  quarter: 1 | 2 | 3 | 4;
  /** Calendar date (ISO string yyyy-mm-dd) the IRS estimate is due. */
  dueDate: string;
  /** Cents the user should send for this quarter. Already accounts for
   *  W-2 withholding spread evenly across the year and any estimates
   *  the user has already paid. Negative or zero means "no payment
   *  needed this quarter." */
  amountCents: number;
  /** True if the due date has already passed at the time of forecast. */
  isPast: boolean;
};

export type ForecastResult = {
  projectedIncomeCents: number;
  projectedExpensesCents: number;
  projectedNetBusinessIncomeCents: number;

  selfEmploymentTaxCents: number;
  // Additional 0.9% Medicare surcharge on COMBINED wages + SE earnings
  // above the filing-status threshold. Surfaced separately so the UI
  // can show why it appeared.
  additionalMedicareCents: number;
  // Net Investment Income Tax (3.8% on the lesser of investment income
  // or modified AGI over threshold). Zero unless investment income was
  // supplied to the forecast.
  niitCents: number;
  qbiDeductionCents: number;
  // Total non-refundable family credits applied to federal income tax
  // (CTC + ODC, after phase-out). Reported separately so the UI can
  // surface it as "minus child / dependent credits".
  childAndDependentCreditsCents: number;
  taxableIncomeCents: number;
  federalIncomeTaxCents: number;
  stateTaxCents: number;

  totalTaxCents: number;
  alreadyPaidCents: number;
  /**
   * Net balance owed: max(0, totalTax - alreadyPaid). Always >= 0.
   * If the user has overpaid (withholding + estimates exceed total
   * tax), this stays at 0 and `refundCents` is populated instead.
   */
  stillOwedCents: number;
  /**
   * Net refund expected: max(0, alreadyPaid - totalTax). Always >= 0.
   * If the user owes (totalTax > alreadyPaid), this stays at 0 and
   * `stillOwedCents` is populated instead. Exactly one of the two is
   * non-zero on any given forecast (or both zero when perfectly
   * balanced). Bidirectional output so the UI can show "you'll get
   * back $X" or "you'll owe $X" without re-deriving the sign.
   */
  refundCents: number;

  monthlySaveTargetCents: number;
  effectiveRate: number;
  marginalRate: number;

  // Quarterly estimated-tax payment plan. Length 4. Past quarters
  // surface what the user *should have* paid by that date so they
  // can self-assess whether they're behind on safe-harbor.
  quarterlyEstimates: QuarterlyEstimate[];
  /** True if alreadyPaid is below 90% of total tax; user owes a
   *  catch-up to dodge the underpayment penalty. */
  underpaymentRisk: boolean;

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

  // C-Corp short-circuit: flat 21% on net business income at the entity
  // level. Owner's personal W-2 / withholding / spouse income don't apply
  // to the corporation itself; they'd be on the owner's separate 1040.
  // We still surface the personal withholding as "already paid" so a
  // sole-shareholder running both threads gets the right cash picture.
  if (input.entityType === "c_corp") {
    const cTax = Math.round(netBiz * C_CORP_RATE);
    const stRate = stateRate(input.stateCode);
    const stTax = Math.round(netBiz * stRate);
    const totalTax = cTax + stTax;
    const w2WithheldTotal =
      input.ownerW2WithheldCents + input.spouseW2WithheldCents;
    const alreadyPaid = input.estimatedPaymentsCents + w2WithheldTotal;
    // Bidirectional balance: positive = still owe, negative = refund.
    // Surface both sides separately so the UI doesn't have to recover
    // the sign from a clamped value.
    const balance = totalTax - alreadyPaid;
    const remaining = Math.max(0, balance);
    const refund = Math.max(0, -balance);
    const monthsRemaining = remainingMonthsToFilingDeadline(input.taxYear);
    const monthlySaveTarget = Math.round(remaining / monthsRemaining);
    hints.push(
      "C-Corp: a flat 21% federal rate is applied to net business income at the entity level. Personal taxes on dividends or wages are separate.",
    );
    const quarterlyEstimates = buildQuarterlyEstimates({
      taxYear: input.taxYear,
      totalTaxCents: totalTax,
      w2WithheldCents: w2WithheldTotal,
      estimatedPaymentsCents: input.estimatedPaymentsCents,
    });
    const underpaymentRisk =
      alreadyPaid < Math.round(totalTax * UNDERPAYMENT_SAFE_HARBOR_2025.currentYearShare);
    return {
      projectedIncomeCents: projectedIncome,
      projectedExpensesCents: projectedExpenses,
      projectedNetBusinessIncomeCents: netBiz,
      selfEmploymentTaxCents: 0,
      additionalMedicareCents: 0,
      niitCents: 0,
      qbiDeductionCents: 0,
      childAndDependentCreditsCents: 0,
      taxableIncomeCents: netBiz,
      federalIncomeTaxCents: cTax,
      stateTaxCents: stTax,
      totalTaxCents: totalTax,
      alreadyPaidCents: alreadyPaid,
      stillOwedCents: remaining,
      refundCents: refund,
      monthlySaveTargetCents: monthlySaveTarget,
      effectiveRate: projectedIncome > 0 ? totalTax / projectedIncome : 0,
      marginalRate: C_CORP_RATE,
      quarterlyEstimates,
      underpaymentRisk,
      ytdIncomeCents: input.ytdIncomeCents,
      ytdDeductibleExpensesCents: ytdDeductibleExpenses,
      ytdNetBusinessIncomeCents: ytdNetBiz,
      assumptions,
      hints,
    };
  }

  // SE tax (only for pass-throughs / sole prop / partnerships / 1099).
  // S-Corp owners pay payroll on W-2 wages instead; we don't model wages here.
  //
  // Wage-base interaction: the $176,100 Social Security wage base is
  // shared between W-2 wages and SE earnings. If the owner already paid
  // SS on W-2 wages, only the remaining headroom is subject to the SS
  // portion of SE tax. Spouse W-2 SS wages do NOT count - the wage base
  // is per-person.
  let seTax = 0;
  let seEarningsForAddtlMedicare = 0;
  if (SE_ENTITY_TYPES.has(input.entityType)) {
    const result = computeSelfEmploymentTax({
      netBizCents: netBiz,
      ownerW2SsWagesCents: input.ownerW2SsWagesCents,
    });
    seTax = result.totalSeTax;
    seEarningsForAddtlMedicare = result.seEarnings;
    assumptions.push(
      "Self-employment tax: 12.4% Social Security up to the $176,100 wage base + 2.9% Medicare uncapped, on 92.35% of net earnings (IRC §1401).",
    );
    if (input.ownerW2SsWagesCents > 0) {
      assumptions.push(
        "Owner W-2 Social Security wages reduce the remaining SS wage base that applies to SE earnings.",
      );
    }
  }
  if (input.entityType === "s_corp") {
    hints.push(
      "S-Corp owner-employees pay payroll tax on reasonable W-2 wages instead of SE tax. Track W-2 wages separately.",
    );
  }

  // Additional Medicare 0.9% surtax. IRC §3101(b)(2) / §1401(b)(2).
  // Applies to COMBINED Medicare-base wages + SE earnings above the
  // filing-status threshold. The employer withholds 0.9% on wages over
  // $200K from a single employer; whatever the employer didn't catch
  // (e.g. household has two W-2s, or wage + SE combo crosses) shows up
  // here so the user sees the right "still owed" number.
  const combinedMedicareIncome =
    input.ownerW2WagesCents + input.spouseW2WagesCents + seEarningsForAddtlMedicare;
  const addtlMedicareThreshold =
    SE_TAX_2025.additionalMedicareThreshold[input.filingStatus] ?? 0;
  const additionalMedicare =
    combinedMedicareIncome > addtlMedicareThreshold
      ? Math.round(
          (combinedMedicareIncome - addtlMedicareThreshold) *
            SE_TAX_2025.additionalMedicareRate,
        )
      : 0;
  if (additionalMedicare > 0) {
    assumptions.push(
      "Additional Medicare 0.9% surtax applied to wages + SE earnings above the filing-status threshold (Form 8959).",
    );
  }

  // Half SE-tax is an above-the-line deduction (IRC §164(f)).
  const halfSeTaxDeduction = Math.round(seTax / 2);

  // Spouse income: prefer the explicit W-2 field if set, fall back to
  // the legacy generic field for older profiles. Don't double-count.
  const effectiveSpouseIncome =
    input.spouseW2WagesCents > 0
      ? input.spouseW2WagesCents
      : input.spouseIncomeCents;

  // AGI = net biz + owner W-2 wages + spouse income - half SE tax
  //       - other above-the-line items.
  // (W-2 wages are taxable income on the personal return, even though
  // SS/Medicare/withholding were already settled by the employer.)
  const agi = Math.max(
    0,
    netBiz +
      input.ownerW2WagesCents +
      effectiveSpouseIncome -
      halfSeTaxDeduction -
      projectedAboveTheLine,
  );
  if (projectedAboveTheLine > 0) {
    assumptions.push(
      "Self-employed health insurance, retirement contributions, and HSA deductions are applied above-the-line (Schedule 1), not as Schedule C expenses.",
    );
  }
  if (input.ownerW2WagesCents > 0 || effectiveSpouseIncome > 0) {
    assumptions.push(
      "Household W-2 wages are added to taxable income, and federal withholding is credited as already-paid.",
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
  const fedTaxBeforeCredits = computeFederalIncomeTax(
    taxableIncome,
    input.filingStatus,
  );

  // Apply Child Tax Credit + Credit for Other Dependents. Both are
  // non-refundable here (we deliberately don't model the refundable
  // Additional CTC because forecasting "you'll get money back" is more
  // surprising than helpful for a save-target tool).
  const credits = computeFamilyCredits({
    dependents: input.dependents,
    dependentsUnder17: input.dependentsUnder17,
    filingStatus: input.filingStatus,
    agiCents: agi,
  });
  if (credits > 0) {
    assumptions.push(
      "Family credits: $2,000 per qualifying child under 17 (CTC) + $500 per other dependent (ODC), phased out above the AGI threshold.",
    );
  }

  const fedTax = Math.max(0, fedTaxBeforeCredits - credits);

  const stRate = stateRate(input.stateCode);
  const stTax = Math.round(taxableIncome * stRate);
  if (stRate === 0 && input.stateCode) {
    assumptions.push(
      `State estimate uses ${input.stateCode}'s curated flat rate. Real bracket math for all states is on the roadmap.`,
    );
  }

  // Net Investment Income Tax (NIIT). IRC §1411 — 3.8% on the lesser
  // of net investment income or modified AGI over the threshold.
  // Investment income: interest, dividends, capital gains, passive
  // rental. Caller passes ytdInvestmentIncomeCents; we project it the
  // same way as ordinary income.
  const projectedInvestmentIncome = round(
    Math.max(0, input.ytdInvestmentIncomeCents ?? 0) * projectionFactor,
  );
  let niit = 0;
  if (projectedInvestmentIncome > 0) {
    const niitThreshold = NIIT_2025.threshold[input.filingStatus] ?? 0;
    const agiOverThreshold = Math.max(0, agi - niitThreshold);
    const niitBase = Math.min(projectedInvestmentIncome, agiOverThreshold);
    niit = Math.round(niitBase * NIIT_2025.rate);
    if (niit > 0) {
      assumptions.push(
        "Net Investment Income Tax (NIIT) 3.8% applied to the lesser of investment income or AGI over threshold (Form 8960).",
      );
    }
  }

  const totalTax = fedTax + seTax + additionalMedicare + niit + stTax;
  const w2WithheldTotal =
    input.ownerW2WithheldCents + input.spouseW2WithheldCents;
  const alreadyPaid = input.estimatedPaymentsCents + w2WithheldTotal;
  // Bidirectional balance: positive = still owe, negative = refund.
  // The combined-filer (W-2 + Schedule C) case is exactly where this
  // matters most — the user's W-2 withholding can easily exceed total
  // tax once SE deductions and credits are applied, and they should
  // see the refund amount, not a flat $0 next to a "Refund" label.
  const balance = totalTax - alreadyPaid;
  const remaining = Math.max(0, balance);
  const refund = Math.max(0, -balance);

  const monthsRemaining = remainingMonthsToFilingDeadline(input.taxYear);
  const monthlySaveTarget = Math.round(remaining / monthsRemaining);

  const marginal = marginalFederalRate(taxableIncome, input.filingStatus);
  const effective = projectedIncome > 0 ? totalTax / projectedIncome : 0;

  // Underpayment-penalty safe harbor: pay at least 90% of this year's
  // tax to avoid the penalty. We surface the risk via a hint; the
  // quarterly schedule below already nudges the user toward the right
  // catch-up amount.
  const safeHarborTarget = Math.round(
    totalTax * UNDERPAYMENT_SAFE_HARBOR_2025.currentYearShare,
  );
  const underpaymentRisk = alreadyPaid < safeHarborTarget;
  if (underpaymentRisk && totalTax > 0) {
    const shortfall = safeHarborTarget - alreadyPaid;
    hints.push(
      `Withholding plus estimates so far are below the 90%-of-current-year safe harbor by ~${formatCents(
        shortfall,
      )}. Consider sending an estimate before the next quarterly due date to avoid an underpayment penalty.`,
    );
  }

  const quarterlyEstimates = buildQuarterlyEstimates({
    taxYear: input.taxYear,
    totalTaxCents: totalTax,
    w2WithheldCents: w2WithheldTotal,
    estimatedPaymentsCents: input.estimatedPaymentsCents,
  });

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
    additionalMedicareCents: additionalMedicare,
    niitCents: niit,
    qbiDeductionCents: qbi,
    childAndDependentCreditsCents: credits,
    taxableIncomeCents: taxableIncome,
    federalIncomeTaxCents: fedTax,
    stateTaxCents: stTax,
    totalTaxCents: totalTax,
    alreadyPaidCents: alreadyPaid,
    stillOwedCents: remaining,
    refundCents: refund,
    monthlySaveTargetCents: monthlySaveTarget,
    effectiveRate: effective,
    marginalRate: marginal,
    quarterlyEstimates,
    underpaymentRisk,
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

function computeSelfEmploymentTax(args: {
  netBizCents: number;
  ownerW2SsWagesCents: number;
}): { totalSeTax: number; seEarnings: number } {
  const seEarnings = Math.round(
    args.netBizCents * SE_TAX_2025.netEarningsFactor,
  );
  if (seEarnings <= 0) return { totalSeTax: 0, seEarnings: 0 };

  // SS portion is capped at the wage base, but the wage base is shared
  // with W-2 SS wages already earned in the year. Whatever's left of the
  // base is what SE earnings can be taxed against.
  const ssCap = SE_TAX_2025.socialSecurityWageBase;
  const ssRemaining = Math.max(
    0,
    ssCap - Math.max(0, args.ownerW2SsWagesCents),
  );
  const ssBase = Math.min(seEarnings, ssRemaining);
  const ssTax = Math.round(ssBase * SE_TAX_2025.socialSecurityRate);

  const medicareTax = Math.round(seEarnings * SE_TAX_2025.medicareRate);

  // The 0.9% additional Medicare surtax used to live here, but it
  // applies to COMBINED W-2 wages + SE earnings above the threshold —
  // not SE earnings in isolation. It's now computed at the household
  // level in forecast() and added to total tax separately.
  return { totalSeTax: ssTax + medicareTax, seEarnings };
}

/**
 * Split annual liability into Q1-Q4 estimated payments. Each quarter
 * is responsible for a quarter of the annual total minus the slice
 * of W-2 withholding the IRS treats as paid evenly through the year.
 * Estimated payments the user has already made are subtracted from
 * the earliest still-due quarter so the schedule reflects "how much
 * more you should send."
 */
function buildQuarterlyEstimates(args: {
  taxYear: number;
  totalTaxCents: number;
  w2WithheldCents: number;
  estimatedPaymentsCents: number;
}): QuarterlyEstimate[] {
  const today = new Date();
  // Quarter target: total annual tax / 4 minus the quarter's share of
  // W-2 withholding (treated as paid throughout the year).
  const perQuarterGross = Math.round(args.totalTaxCents / 4);
  const perQuarterWithholdingCredit = Math.round(args.w2WithheldCents / 4);
  const baseQuarterCents = Math.max(
    0,
    perQuarterGross - perQuarterWithholdingCredit,
  );

  // Spread previously-made estimated payments against the earliest
  // quarters so the user sees future quarters as the catch-up.
  let estimatesRemaining = Math.max(0, args.estimatedPaymentsCents);
  return QUARTERLY_DUE_DATES_2025.map((d) => {
    const dueYear = d.inFollowingYear ? args.taxYear + 1 : args.taxYear;
    const dueDate = new Date(Date.UTC(dueYear, d.month - 1, d.day));
    const isPast = dueDate.getTime() < today.getTime();
    let amount = baseQuarterCents;
    const credit = Math.min(estimatesRemaining, amount);
    amount -= credit;
    estimatesRemaining -= credit;
    return {
      quarter: d.quarter,
      dueDate: dueDate.toISOString().slice(0, 10),
      amountCents: Math.max(0, amount),
      isPast,
    };
  });
}

/**
 * Non-refundable family credits: Child Tax Credit ($2,000 / qualifying
 * child under 17) and Credit for Other Dependents ($500 each), reduced
 * by $50 per $1,000 (or fraction thereof) of AGI above the phase-out
 * threshold. The reduction applies to the COMBINED credit.
 */
export function computeFamilyCredits(args: {
  dependents: number;
  dependentsUnder17: number;
  filingStatus: FilingStatus;
  agiCents: number;
}): number {
  const totalDependents = Math.max(0, args.dependents);
  const ctcChildren = Math.min(
    Math.max(0, args.dependentsUnder17),
    totalDependents,
  );
  const odcChildren = Math.max(0, totalDependents - ctcChildren);

  const baseCredit =
    ctcChildren * CHILD_TAX_CREDIT_2025.ctcPerChildCents +
    odcChildren * CHILD_TAX_CREDIT_2025.odcPerOtherCents;
  if (baseCredit <= 0) return 0;

  const phaseOutStart =
    CHILD_TAX_CREDIT_2025.phaseOutStart[args.filingStatus] ?? 0;
  if (args.agiCents <= phaseOutStart) return baseCredit;

  // Reduction: $50 per $1,000 (or fraction) over threshold. Math in
  // cents: each $1,000 = 100,000 cents.
  const overCents = args.agiCents - phaseOutStart;
  const stepsOver = Math.ceil(overCents / 100_000);
  const reduction = stepsOver * CHILD_TAX_CREDIT_2025.phaseOutReductionPer1000;
  return Math.max(0, baseCredit - reduction);
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
