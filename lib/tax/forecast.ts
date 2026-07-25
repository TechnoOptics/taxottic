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

import { stateRate, type FilingStatus } from "./constants-2025";
import { getTaxYearConstants, type TaxYearConstants } from "./constants";
import { computeEitcCents } from "./credits/eitc";
import { computeSaversCreditCents } from "./credits/savers";
import { computeEducationCreditCents } from "./credits/education";
import {
  computeStateTaxFromBrackets,
  stateTaxableIncomeFromAgi,
} from "./state-brackets";
import { computeStateEntityTax } from "./state-entity-taxes";

// Engine helpers extracted from this file; forecast() orchestrates them.
import { round, formatCents, parseDollarsToCents } from "./engine/money";
import {
  computeStandardDeduction,
  computeFederalIncomeTax,
  marginalFederalRate,
} from "./engine/federal-income-tax";
import { computeSelfEmploymentTax } from "./engine/self-employment-tax";
import {
  buildQuarterlyEstimates,
  remainingMonthsToFilingDeadline,
} from "./engine/quarterly";
import {
  computeMileageDeductionCents,
  computeHomeOfficeSimplifiedCents,
  computeFamilyCredits,
} from "./engine/line-items";

// Public helpers re-exported so existing `@/lib/tax/forecast` imports keep
// working now that their implementations live under ./engine.
export {
  formatCents,
  parseDollarsToCents,
  computeMileageDeductionCents,
  computeHomeOfficeSimplifiedCents,
  computeFamilyCredits,
};

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

/**
 * Multi-state apportionment input. When provided, the engine
 * computes state tax PER state and sums the result with a credit
 * back to the resident state for taxes paid to non-resident
 * states (Schedule M1CR-equivalent).
 *
 * Sales factor weights are basis-points (0-10000). Should sum to
 * roughly 10000 across all rows; the engine normalizes if not.
 */
export type StateNexusRow = {
  stateCode: string;
  isResident: boolean;
  salesFactorBps: number;
};

export type ForecastInput = {
  taxYear: number;
  filingStatus: FilingStatus;
  /** Single-state mode (legacy). Use stateNexus instead when the
   *  company has nexus in multiple states. */
  stateCode: string | null;
  /** Multi-state mode. When set + length > 1, the engine apportions
   *  income across states using sales-factor weights and credits the
   *  resident state for taxes paid elsewhere. */
  stateNexus?: StateNexusRow[];
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
  /**
   * Which side of the app this forecast is for. "business" (the company
   * forecast) suppresses individual-return credits the personal side owns:
   * child tax credit, EITC, Saver's Credit, and education credits. Those
   * belong on the personal return, so the business view shows only the
   * business's tax picture. Defaults to "personal" (undefined), preserving
   * existing behavior everywhere else (personal forecast, all calculators).
   */
  scope?: "personal" | "business";
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
  // surtax) when modified AGI is above the threshold. Optional -
  // callers without investment data pass 0 and NIIT computes to 0.
  ytdInvestmentIncomeCents?: number;

  // ---------- Benefits the original engine missed (see docs/irs-2026-changes.md) ----------
  //
  // Retirement contributions (item #1 in the gap audit). The engine
  // deducts the sum as an above-the-line adjustment alongside the
  // existing `ytdAboveTheLineCents`. Optional: callers that haven't
  // collected these pass undefined or 0 and the math is a no-op.
  retirementSolo401kCents?: number;
  retirementSepIraCents?: number;
  retirementTraditionalIraCents?: number;
  retirementRothIraCents?: number; // not deductible; used for Saver's Credit
  retirementHsaCents?: number;

  // Self-employed health insurance (item #2). Above-the-line, capped
  // by SE earnings.
  selfEmployedHealthInsuranceCents?: number;

  // Capital gains + qualified dividends (item #4). When provided, the
  // engine taxes these at the separate 0/15/20% LTCG brackets instead
  // of bundling them into ordinary income.
  longTermCapitalGainsCents?: number;
  qualifiedDividendsCents?: number;

  // Foreign earned income (item #11). Up to the per-year cap is
  // excluded from gross income under § 911.
  foreignEarnedIncomeCents?: number;

  // Student loan interest (item #6, deductible portion). Above-the-line
  // up to $2,500 with its own AGI phase-out.
  studentLoanInterestCents?: number;

  // Qualified higher-education expenses (item #6 - AOTC/LLC input).
  qualifiedEducationExpensesCents?: number;
  // True when the user has confirmed AOTC eligibility (first-4-years
  // undergrad + half-time + no-felony-drug + AOTC not previously
  // claimed 4 prior years). When true the engine computes AOTC; when
  // false the engine falls back to Lifetime Learning Credit.
  claimAotc?: boolean;

  // Itemized sub-types (item #5). When provided, the engine still uses
  // ytdItemizedCents as the working total but surfaces the SALT-cap
  // warning if SALT > $10k.
  itemizedSaltCents?: number;
  itemizedMortgageInterestCents?: number;
  itemizedCharityCents?: number;
  itemizedMedicalCents?: number;

  // § 179 expensing election (item #7). Treated as a same-year expense
  // (in addition to the regular business expenses). The engine doesn't
  // do proper depreciation tracking; this is the simple "expense it
  // now" treatment most small filers want.
  section179ExpenseCents?: number;

  // Residential energy + EV credits (item #12). Engine applies them as
  // non-refundable credits against tax.
  residentialEnergyCreditCents?: number;
  evCreditCents?: number;

  // Premium Tax Credit advance payments (item #9). Hint only - we
  // surface a reconciliation note rather than do the full PTC math.
  ptcAdvancePaymentsCents?: number;
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

  // ---------- New output fields ----------
  //
  // AMT (item #3). When AMT exceeds regular tax, totalTaxCents already
  // reflects the AMT amount; this field reports the AMT delta that was
  // added so the UI can show "AMT kicked in by $X."
  amtAddOnCents: number;
  // Capital gains + qualified dividends taxed at LTCG brackets (item #4).
  // Reported separately so the UI can show "qualified gains taxed at
  // preferred rates." Zero if no LTCG/QD income supplied.
  capitalGainsTaxCents: number;
  // Total retirement contributions the user reported (Solo 401(k) +
  // SEP + IRA + HSA). Used by the savings-tile recommendation.
  retirementContributionTotalCents: number;
  // Tax savings the user got from retirement contributions (item #1).
  // Approximated as marginal rate × deductible portion; surfaced as
  // "you saved $X this year by contributing $Y" copy on the tile.
  retirementTaxSavingsCents: number;
  // Foreign earned income excluded under § 911 (item #11). Zero if
  // none reported.
  foreignEarnedIncomeExcludedCents: number;
  // Student loan interest deduction applied (item #6). Capped at
  // $2,500 with AGI phase-out.
  studentLoanInterestDeductionCents: number;
  // W-4 withholding-adjustment recommendation for W-2 filers (item #15).
  // - "increase": user is under-withholding, suggest a higher W-4
  //   additional-amount;
  // - "decrease": user is significantly over-withholding (large refund),
  //   suggest a lower W-4 to get the money back in paychecks;
  // - "ok": within ~$500 of zero.
  // The amount is the per-paycheck delta assuming bi-weekly pay (26
  // checks/year). The UI rounds and surfaces.
  w4Recommendation: {
    direction: "increase" | "decrease" | "ok";
    perPaycheckDeltaCents: number;
    annualDeltaCents: number;
  };
  /**
   * Personalized retirement-contribution suggestion (item #6 in the
   * "what next" follow-up). Looks at the user's current contributions
   * across Solo 401(k) / SEP-IRA / Traditional IRA / HSA, computes
   * remaining headroom against the 2026 statutory caps (with age >= 50
   * catch-ups), and recommends filling the bucket with the most
   * remaining capacity that still has marginal-rate impact (i.e. the
   * deductible amount won't exceed taxable income).
   *
   * bucket: which account to fund.
   * addCents: how much more to contribute, in cents.
   * taxSavingsCents: dollar value of the deduction (capped by the
   *   amount of taxable income remaining; you can't deduct yourself
   *   below zero on this forecast).
   *
   * Reports bucket="none" when nothing useful is available (e.g., the
   * user has already maxed out everything we model, has no earned
   * income, or is already at zero taxable income).
   */
  retirementRecommendation: {
    bucket:
      | "solo_401k"
      | "sep_ira"
      | "traditional_ira"
      | "hsa"
      | "none";
    addCents: number;
    taxSavingsCents: number;
    /**
     * One-line copy ready to render as the tile body. Engine builds
     * this so the UI doesn't have to redo the conditional logic and
     * we stay consistent across the personal + company forecasts.
     */
    summary: string;
  };
  /**
   * Earned Income Tax Credit (refundable, § 32). Computed by the
   * engine when the filer has earned income; zero when they don't
   * qualify (investment-income disqualifier, MFS, AGI above completed
   * phaseout, etc.). Refundable means a filer with zero income tax
   * owed still gets the EITC as cash back.
   */
  eitcCents: number;
  /**
   * Human-readable reason the EITC is zero (when it is and the filer's
   * profile suggests it's a near-miss worth explaining). Empty string
   * when the credit is nonzero or when the user clearly wouldn't
   * qualify regardless.
   */
  eitcReasonZero: string;
  /**
   * Saver's Credit (§ 25B). Non-refundable; reduces fed tax dollar-for-
   * dollar but won't drop it below zero. 10/20/50% of up to $2,000
   * single / $4,000 MFJ of retirement contributions, per AGI bracket.
   */
  saversCreditCents: number;
  /** 0, 0.1, 0.2, or 0.5 - the bracket that applied. */
  saversCreditRate: number;
  /** "Why zero" copy mirroring the EITC pattern. */
  saversCreditReasonZero: string;
  /**
   * Education credit (§ 25A). Either AOTC (partially refundable) or
   * Lifetime Learning Credit (non-refundable) depending on the
   * user's claimAotc flag and eligibility. Split into refundable +
   * non-refundable portions so the engine can apply each correctly.
   */
  educationCreditRefundableCents: number;
  educationCreditNonRefundableCents: number;
  /** "aotc" | "llc" | "none". */
  educationCreditKind: "aotc" | "llc" | "none";
  educationCreditReasonZero: string;

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
  /**
   * Total tax ÷ total gross income (business + W-2 + spouse), or 0 when
   * there's no income. The honest "your overall effective rate" figure.
   * Renamed from `effectiveRate`, which divided by BUSINESS income only -
   * that returned 0% for a pure-W-2 filer and overstated the rate for
   * mixed filers (the field name lied about its denominator).
   */
  overallEffectiveRate: number;
  /**
   * Federal income tax / taxable income (or 0 when taxable income is
   * 0). The UI shows this as "Effective rate" under the Federal Income
   * Tax tile, distinct from `overallEffectiveRate` which is the
   * combined total/gross figure used in overall "you'll keep ~X%" copy.
   * Introduced in response to the May 2026 audit's High #4 finding
   * that the FIT tile was rendering 11% on a $0 federal income tax.
   */
  federalIncomeTaxEffectiveRate: number;
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

// Entities whose owner gets the §199A QBI deduction on net pass-
// through income. Same set as `SE_ENTITY_TYPES` PLUS `s_corp`, S-Corp
// distributions to owners ARE QBI-eligible under IRC §199A even
// though the entity itself pays no SE tax. The May 2026 round-2
// audit caught the engine returning QBI = 0 for every S-Corp because
// the old code path gated QBI on `SE_ENTITY_TYPES.has(...)`.
const QBI_ELIGIBLE_ENTITY_TYPES: ReadonlySet<EntityType> = new Set([
  "sole_prop",
  "single_llc",
  "self_employed_1099",
  "multi_llc",
  "partnership",
  "s_corp",
]);

const C_CORP_RATE = 0.21;

export function forecast(input: ForecastInput): ForecastResult {
  const hints: string[] = [];
  const assumptions: string[] = [];
  const months = Math.max(1, Math.min(12, input.monthsEntered));
  const projectionFactor = 12 / months;

  // Resolve the per-tax-year constants bundle ONCE at the top of the
  // function and pass it into helpers via closure. Previously the
  // engine hard-imported the _2025 constants which baked last year's
  // brackets into every forecast regardless of input.taxYear; now a
  // 2026 forecast picks up the 2026 brackets / standard deduction /
  // QBI thresholds, and a future-year request falls back to the most
  // recent published bundle with `isFallback` set so the UI can warn.
  const k: TaxYearConstants = getTaxYearConstants(input.taxYear);
  if (k.isFallback) {
    hints.push(
      `We don't yet have IRS-published tax tables for ${input.taxYear}; this forecast uses ${k.year} brackets as a placeholder. The numbers will refresh once the IRS publishes ${input.taxYear} inflation adjustments (usually late October of the prior year).`,
    );
  }

  // Apply meals 50% rule once, then build year-to-date deductible expenses.
  // § 179 election (item #7 in the benefits audit) adds to deductible
  // business expenses in the same year - capped at the per-year statutory
  // limit ($2,560,000 for 2026 per OBBBA § 70306). The full-blown
  // depreciation election (basis tracking, recapture, etc.) is a separate
  // future feature; for now we treat it as expense-it-now subject to
  // the cap.
  const SECTION_179_2026_CAP_CENTS = 2_560_000 * 100;
  const requestedSection179 = Math.max(0, input.section179ExpenseCents ?? 0);
  const section179Applied = Math.min(
    requestedSection179,
    SECTION_179_2026_CAP_CENTS,
  );
  if (
    requestedSection179 > 0 &&
    requestedSection179 > section179Applied
  ) {
    hints.push(
      `Your § 179 election exceeds the ${k.year} cap of $${(SECTION_179_2026_CAP_CENTS / 100).toLocaleString()}. The excess will need to depreciate normally over the asset's class life, confirm with a CPA.`,
    );
  }
  const ytdMealsDeductible = Math.round(input.ytdMealsCents * 0.5);
  const ytdDeductibleExpenses =
    Math.max(0, input.ytdBusinessExpensesCents) +
    ytdMealsDeductible +
    Math.max(0, input.autoMileageCents) +
    Math.max(0, input.autoHomeOfficeCents) +
    section179Applied;
  const ytdNetBiz = Math.max(0, input.ytdIncomeCents - ytdDeductibleExpenses);
  if (section179Applied > 0) {
    assumptions.push(
      `§ 179 election: expensing $${(section179Applied / 100).toLocaleString()} of equipment in ${k.year} instead of depreciating over the asset's class life (OBBBA § 70306 raised the cap to $2.56M).`,
    );
  }

  if (input.autoMileageCents > 0) {
    // Mileage rate is published in a separate IRS Notice each December.
    // When the next year's Notice hasn't dropped yet, the per-year
    // bundle carries `isMileageRateProvisional=true` and falls back to
    // the prior year's rate. Phrase the assumption to be honest about
    // that so a user comparing to their own bookkeeping software
    // doesn't think we miscoded - we're a placeholder that will refresh.
    // Render as cents (e.g. "72.5¢") so half-cent rates like the 2026
    // 72.5¢/mile show correctly, a dollar `.toFixed(2)` would round
    // $0.725 down to "$0.72".
    const ratePerMile = `${k.MILEAGE_RATE_PER_MILE_CENTS}¢`;
    if (k.MILEAGE_RATE_PERIODS && k.MILEAGE_RATE_PERIODS.length > 1) {
      // Split-rate year (IRS mid-year adjustment): say exactly which
      // rate applies when, so the on-screen claim matches how each
      // trip was actually priced.
      const parts = k.MILEAGE_RATE_PERIODS.map((per, i, arr) => {
        const from = new Date(per.fromIso + "T00:00:00Z");
        const to = arr[i + 1]
          ? new Date(Date.parse(arr[i + 1].fromIso) - 86_400_000)
          : new Date(Date.UTC(k.year, 11, 31));
        const fmt = (d: Date) =>
          d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          });
        return `${per.centsPerMile}¢ (${fmt(from)} – ${fmt(to)})`;
      });
      assumptions.push(
        `Vehicle: standard mileage applied at the IRS ${k.year} split rates of ${parts.join(" and ")} per business mile, per the IRS mid-year adjustment. Each trip is priced at the rate in force on its date.`,
      );
    } else if (k.isMileageRateProvisional) {
      assumptions.push(
        `Vehicle: standard mileage applied at ${ratePerMile} per business mile (the ${k.year} IRS Notice hasn't been published yet; we're carrying forward last year's rate as a placeholder and will refresh once the Notice posts).`,
      );
    } else {
      assumptions.push(
        `Vehicle: standard mileage applied at the IRS ${k.year} rate of ${ratePerMile} per business mile.`,
      );
    }
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

  // Denominator for the OVERALL effective rate (total tax ÷ total gross
  // income). Includes W-2 + spouse income so the rate is correct for W-2
  // and mixed filers, the old business-only denominator returned 0% for
  // a pure-W-2 filer and overstated the rate for anyone with W-2 wages
  // (May 2026 audit). A pure self-employed filer has no W-2/spouse income,
  // so this equals projectedIncome and their displayed rate is unchanged.
  // Spouse income appears in TWO fields (the explicit W-2 one and a
  // legacy generic one). Everywhere else the engine picks ONE via
  // effectiveSpouseIncome; this denominator used to add both, inflating
  // gross income and understating the displayed effective rate for any
  // profile that had filled in both (audit #38).
  const denomSpouseIncome =
    input.spouseW2WagesCents > 0
      ? input.spouseW2WagesCents
      : input.spouseIncomeCents;
  const totalGrossIncomeCents =
    projectedIncome + input.ownerW2WagesCents + denomSpouseIncome;

  // Above-the-line aggregation. The original engine had one number
  // (ytdAboveTheLineCents) summed from monthly_expenses rows tagged with
  // ABOVE_THE_LINE_CODES; many users don't categorize retirement
  // contributions as transactions and prefer to enter them as a single
  // "I put $X in my Solo 401(k) this year" number. The new structured
  // fields below let them do that; we add them to the projected total
  // so the engine doesn't have to care about the source.
  //
  // Items wired here:
  //   #1 Retirement contributions (Solo 401(k), SEP-IRA, Traditional IRA, HSA)
  //   #2 Self-employed health insurance
  //   #6 Student loan interest deduction (capped $2,500, AGI phase-out applied below)
  const structuredRetirementCents =
    Math.max(0, input.retirementSolo401kCents ?? 0) +
    Math.max(0, input.retirementSepIraCents ?? 0) +
    Math.max(0, input.retirementTraditionalIraCents ?? 0) +
    Math.max(0, input.retirementHsaCents ?? 0);
  // Roth IRA is NOT deductible but the contribution counts toward the
  // Saver's Credit + the savings-target tile; track it separately so
  // we don't deduct it.
  const rothContributionCents = Math.max(
    0,
    input.retirementRothIraCents ?? 0,
  );
  const seHealthInsuranceCents = Math.max(
    0,
    input.selfEmployedHealthInsuranceCents ?? 0,
  );
  // Student loan interest is also above-the-line but has its own AGI
  // phase-out we apply below once we know AGI. Compute the unconstrained
  // amount here (capped at the statutory $2,500 / IRC § 221) so we have
  // a starting figure.
  const STUDENT_LOAN_INTEREST_STATUTORY_MAX_CENTS = 2_500 * 100;
  const studentLoanInterestUnconstrainedCents = Math.min(
    Math.max(0, input.studentLoanInterestCents ?? 0),
    STUDENT_LOAN_INTEREST_STATUTORY_MAX_CENTS,
  );

  // Projected above-the-line from logged monthly_expenses (legacy path)
  // PLUS the new structured fields. The structured fields aren't
  // projected because they're entered as annual totals already, so we
  // skip projectionFactor for them.
  const projectedAboveTheLineExisting = round(
    Math.max(0, input.ytdAboveTheLineCents) * projectionFactor,
  );
  const netBiz = Math.max(0, projectedIncome - projectedExpenses);
  // SE health insurance (IRC §162(l)) is deductible only up to the
  // business's earnings, you can't deduct more in health premiums than
  // the business made. Cap at net business income so a large premium on a
  // small- or zero-profit business can't over-reduce AGI. (The assumption
  // text already promised this cap; it just wasn't being applied.)
  const seHealthDeductibleCents = Math.min(seHealthInsuranceCents, netBiz);

  // Note: studentLoanInterestUnconstrainedCents is intentionally NOT
  // added here yet - it's applied to AGI after we phase it out by AGI.
  let projectedAboveTheLine =
    projectedAboveTheLineExisting +
    structuredRetirementCents +
    seHealthDeductibleCents;

  // C-Corp short-circuit: flat 21% on net business income at the entity
  // level. Owner's personal W-2 / withholding / spouse income don't apply
  // to the corporation itself; they'd be on the owner's separate 1040.
  // We still surface the personal withholding as "already paid" so a
  // sole-shareholder running both threads gets the right cash picture.
  if (input.entityType === "c_corp") {
    const cTax = Math.round(netBiz * C_CORP_RATE);
    // Replace the personal-rate fallback with the proper C-Corp
    // state rate. The new `computeStateEntityTax()` helper applies
    // (a) the C-Corp state income tax at the correct corporate
    // rate, (b) gross-receipts / margin taxes (TX, OH, WA, OR, NV)
    // when receipts exceed the state-specific threshold, and
    // (c) hints for PTET availability + QBI conformity.
    const entityTax = computeStateEntityTax({
      stateCode: input.stateCode,
      entityType: "c_corp",
      netBusinessIncomeCents: netBiz,
      grossReceiptsCents: projectedIncome,
    });
    const stTax = entityTax.totalEntityTaxCents;
    for (const n of entityTax.notes) assumptions.push(n);
    for (const h of entityTax.hints) hints.push(h);
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
      alreadyPaid < Math.round(totalTax * k.UNDERPAYMENT_SAFE_HARBOR.currentYearShare);
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
      overallEffectiveRate:
        totalGrossIncomeCents > 0 ? totalTax / totalGrossIncomeCents : 0,
      // C-Corps don't have an ordinary FIT tile to label, but keep the
      // field shape uniform so the UI doesn't have to branch on
      // entity type. Use the flat federal rate as the "FIT effective
      // rate", same value the UI shows as the marginal rate.
      federalIncomeTaxEffectiveRate: netBiz > 0 ? cTax / netBiz : 0,
      marginalRate: C_CORP_RATE,
      quarterlyEstimates,
      underpaymentRisk,
      ytdIncomeCents: input.ytdIncomeCents,
      ytdDeductibleExpensesCents: ytdDeductibleExpenses,
      ytdNetBusinessIncomeCents: ytdNetBiz,
      assumptions,
      hints,
      // C-Corps don't have these, they live on the owner's separate
      // 1040, not on the entity return. Default to zero so the result
      // shape is uniform across entity types.
      amtAddOnCents: 0,
      capitalGainsTaxCents: 0,
      retirementContributionTotalCents: 0,
      retirementTaxSavingsCents: 0,
      foreignEarnedIncomeExcludedCents: 0,
      studentLoanInterestDeductionCents: 0,
      w4Recommendation: {
        direction: "ok",
        perPaycheckDeltaCents: 0,
        annualDeltaCents: 0,
      },
      retirementRecommendation: {
        bucket: "none",
        addCents: 0,
        taxSavingsCents: 0,
        summary:
          "C-Corp owners receive retirement-plan contributions through payroll (Solo 401(k) tied to W-2 wages, not Schedule C income). The personal-side recommendation runs on the owner's 1040, not on this entity forecast.",
      },
      // EITC is an individual credit; doesn't apply to the C-Corp's
      // entity-level return. The owner's separate 1040 would compute it.
      eitcCents: 0,
      eitcReasonZero: "",
      saversCreditCents: 0,
      saversCreditRate: 0,
      saversCreditReasonZero: "",
      // Education credits are individual; not applicable at the C-Corp
      // entity level. The owner's separate 1040 would claim them.
      educationCreditRefundableCents: 0,
      educationCreditNonRefundableCents: 0,
      educationCreditKind: "none",
      educationCreditReasonZero: "",
    };
  }

  // SE tax (only for pass-throughs / sole prop / partnerships / 1099).
  // S-Corp owners pay payroll on W-2 wages instead; we don't model wages here.
  //
  // Wage-base interaction: the Social Security wage base is shared
  // between W-2 wages and SE earnings. If the owner already paid SS on
  // W-2 wages, only the remaining headroom is subject to the SS
  // portion of SE tax. Spouse W-2 SS wages do NOT count - the wage
  // base is per-person. The actual dollar threshold is per tax year
  // and lives on `k.SE_TAX.socialSecurityWageBase` (see constants-
  // 2026.ts for the SSA's October announcement); the May 2026 round-2
  // audit caught this comment + the assumption text below carrying
  // the stale 2025 number ($176,100) even though the math correctly
  // used 2026's $184,500.
  let seTax = 0;
  let seEarningsForAddtlMedicare = 0;
  if (SE_ENTITY_TYPES.has(input.entityType)) {
    const result = computeSelfEmploymentTax({
      netBizCents: netBiz,
      ownerW2SsWagesCents: input.ownerW2SsWagesCents,
      k,
    });
    seTax = result.totalSeTax;
    seEarningsForAddtlMedicare = result.seEarnings;
    assumptions.push(
      `Self-employment tax: 12.4% Social Security up to the $${(
        k.SE_TAX.socialSecurityWageBase / 100
      ).toLocaleString()} wage base + 2.9% Medicare uncapped, on ${(
        k.SE_TAX.netEarningsFactor * 100
      ).toFixed(2)}% of net earnings (IRC §1401).`,
    );
    if (input.ownerW2SsWagesCents > 0) {
      assumptions.push(
        "Owner W-2 Social Security wages reduce the remaining SS wage base that applies to SE earnings.",
      );
    }
  }
  if (input.entityType === "s_corp") {
    // S-Corp owner-employees are required by the IRS to take
    // "reasonable compensation" via W-2 payroll before any net
    // distributions. The May 2026 round-2 audit caught that the
    // engine doesn't yet capture owner wages, so the full pass-
    // through is being modeled as distribution and the savings vs
    // Sole-Prop look unrealistically large. We don't have the input
    // wired into the wizard yet; surface the assumption explicitly
    // so a user (or their CPA) doesn't take the forecast at face
    // value.
    if (input.ownerW2WagesCents > 0) {
      assumptions.push(
        `S-Corp: this forecast assumes you take $${(
          input.ownerW2WagesCents / 100
        ).toLocaleString()} in owner W-2 wages (already runs through payroll-tax withholding) and the remainder as distribution. Increase or decrease that figure on your tax profile if reality differs.`,
      );
    } else {
      hints.push(
        "S-Corp: this forecast assumes $0 owner W-2 wages, which is NOT a defensible position with the IRS, every S-Corp owner-employee must take reasonable compensation before distributions. The forecast over-states the SE-tax savings until you record your owner wages on the tax-profile page (Owner W-2 wages field). If you take $0 wages this year the IRS can re-characterise distributions as wages and assess back FICA + penalties.",
      );
      assumptions.push(
        "S-Corp owner-employees pay payroll tax (FICA) on reasonable W-2 wages instead of SE tax on the same dollars. The whole-amount-as-distribution treatment below is provisional until owner wages are recorded.",
      );
    }
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
    k.SE_TAX.additionalMedicareThreshold[input.filingStatus] ?? 0;
  const additionalMedicare =
    combinedMedicareIncome > addtlMedicareThreshold
      ? Math.round(
          (combinedMedicareIncome - addtlMedicareThreshold) *
            k.SE_TAX.additionalMedicareRate,
        )
      : 0;
  // Employers MUST withhold the 0.9% on any single employee's wages over
  // $200k regardless of filing status (IRC §3102(f)(1)); that withholding
  // is already money paid, so counting the full surtax as still-owed
  // double-charges a high-W-2 household (audit #37). Estimated per earner
  // and credited below via alreadyPaid.
  const EMPLOYER_ADDTL_MEDICARE_FLOOR = 200_000_00;
  const employerWithheldAddtlMedicare = Math.round(
    (Math.max(0, input.ownerW2WagesCents - EMPLOYER_ADDTL_MEDICARE_FLOOR) +
      Math.max(0, input.spouseW2WagesCents - EMPLOYER_ADDTL_MEDICARE_FLOOR)) *
      k.SE_TAX.additionalMedicareRate,
  );
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

  // Foreign earned income exclusion (item #11 - § 911). Excludes up
  // to the per-year cap of qualified foreign earned income from gross
  // income. Applied BEFORE AGI so the exclusion reduces every
  // downstream phase-out threshold the user might otherwise blow past.
  // The bundle's FOREIGN_EARNED_INCOME_EXCLUSION isn't yet on the
  // shared type (intentional - it's a single-number constant most
  // years), so we inline the 2026 figure here. Update annually with
  // the rest of constants-<year>.ts.
  const FOREIGN_EARNED_INCOME_EXCLUSION_CENTS =
    input.taxYear >= 2026 ? 132_900 * 100 : 130_000 * 100;
  const foreignEarnedIncomeExcludedCents = Math.min(
    Math.max(0, input.foreignEarnedIncomeCents ?? 0),
    FOREIGN_EARNED_INCOME_EXCLUSION_CENTS,
  );
  if (foreignEarnedIncomeExcludedCents > 0) {
    assumptions.push(
      `Foreign earned income exclusion (§ 911) applied: $${(foreignEarnedIncomeExcludedCents / 100).toLocaleString()} excluded from gross income.`,
    );
  }

  // AGI = net biz + owner W-2 wages + spouse income + LTCG + qualified
  //       dividends - half SE tax - other above-the-line items -
  //       foreign earned exclusion.
  //
  // Long-term capital gains and qualified dividends are part of gross
  // income → AGI; they just get taxed at the preferential LTCG
  // brackets instead of ordinary rates later in the engine. Earlier
  // versions of this function omitted them from AGI which made every
  // downstream AGI-driven check (NIIT threshold, credit phase-outs,
  // EITC investment-income disqualifier, AMT exemption phase-out)
  // see too LOW an AGI for filers with investment income.
  //
  // (W-2 wages are also taxable income on the personal return, even
  // though SS/Medicare/withholding were already settled by the
  // employer.) Compute MAGI-ish AGI first (without the student-loan
  // deduction so we can apply the AGI phase-out for SLI against it).
  const longTermCapitalGainsCents = Math.max(
    0,
    input.longTermCapitalGainsCents ?? 0,
  );
  const qualifiedDividendsCents = Math.max(
    0,
    input.qualifiedDividendsCents ?? 0,
  );
  // Net capital gain, hoisted: the QBI cap (§199A(a)(2)) and the NIIT /
  // EITC investment-income tests all need it before their own sites.
  const ltcgIncome = longTermCapitalGainsCents + qualifiedDividendsCents;
  const agiBeforeSli = Math.max(
    0,
    netBiz +
      input.ownerW2WagesCents +
      effectiveSpouseIncome +
      longTermCapitalGainsCents +
      qualifiedDividendsCents -
      halfSeTaxDeduction -
      projectedAboveTheLine -
      foreignEarnedIncomeExcludedCents,
  );

  // Student loan interest deduction (item #6 - § 221). $2,500 max,
  // phased out for MAGI above $85k single / $175k MFJ (2026 figures
  // from Rev. Proc. 2025-32 § 4.29), completely phased out at $100k /
  // $205k. We approximate MAGI as AGI here (the difference is small
  // foreign-earned add-backs we've already excluded).
  const isJoint =
    input.filingStatus === "married_filing_jointly" ||
    input.filingStatus === "qualifying_widow";
  const sliPhaseOutStart = isJoint ? 175_000 * 100 : 85_000 * 100;
  const sliPhaseOutEnd = isJoint ? 205_000 * 100 : 100_000 * 100;
  let studentLoanInterestDeductionCents = 0;
  if (studentLoanInterestUnconstrainedCents > 0) {
    if (agiBeforeSli <= sliPhaseOutStart) {
      studentLoanInterestDeductionCents = studentLoanInterestUnconstrainedCents;
    } else if (agiBeforeSli < sliPhaseOutEnd) {
      const phaseFrac =
        1 - (agiBeforeSli - sliPhaseOutStart) /
        (sliPhaseOutEnd - sliPhaseOutStart);
      studentLoanInterestDeductionCents = Math.round(
        studentLoanInterestUnconstrainedCents * phaseFrac,
      );
    } else {
      studentLoanInterestDeductionCents = 0;
      hints.push(
        "Your MAGI exceeds the § 221 student-loan-interest deduction phase-out. None of the interest paid is deductible this year.",
      );
    }
    if (studentLoanInterestDeductionCents > 0) {
      assumptions.push(
        `Student loan interest deduction (§ 221) applied: $${(studentLoanInterestDeductionCents / 100).toLocaleString()} (capped at $2,500 with AGI phase-out).`,
      );
    }
  }
  projectedAboveTheLine += studentLoanInterestDeductionCents;
  const agi = Math.max(0, agiBeforeSli - studentLoanInterestDeductionCents);

  if (projectedAboveTheLineExisting > 0) {
    assumptions.push(
      "Self-employed health insurance, retirement contributions, and HSA deductions are applied above-the-line (Schedule 1), not as Schedule C expenses.",
    );
  }
  if (structuredRetirementCents > 0) {
    assumptions.push(
      `Retirement contributions applied above-the-line: $${(structuredRetirementCents / 100).toLocaleString()} (Solo 401(k) + SEP-IRA + Traditional IRA + HSA).`,
    );
  }
  if (seHealthDeductibleCents > 0) {
    assumptions.push(
      `Self-employed health insurance deduction applied: $${(seHealthDeductibleCents / 100).toLocaleString()} (above-the-line; capped at net business income per IRC §162(l)).`,
    );
  }
  if (input.ownerW2WagesCents > 0 || effectiveSpouseIncome > 0) {
    assumptions.push(
      "Household W-2 wages are added to taxable income, and federal withholding is credited as already-paid.",
    );
  }

  // Item #5 SALT cap warning. The TCJA capped the State And Local Tax
  // itemized deduction at $10,000 ($5,000 MFS); OBBBA didn't change
  // this. If the user reported more than the cap in itemizedSaltCents
  // they're effectively wasting deduction headroom.
  const saltReported = Math.max(0, input.itemizedSaltCents ?? 0);
  if (saltReported > 0) {
    const saltCap =
      input.filingStatus === "married_filing_separately"
        ? 5_000 * 100
        : 10_000 * 100;
    if (saltReported > saltCap) {
      hints.push(
        `Your reported state + local taxes ($${(saltReported / 100).toLocaleString()}) exceed the SALT cap of $${(saltCap / 100).toLocaleString()}. The excess isn't deductible. Consider bunching charitable contributions or other itemized buckets where the cap doesn't apply.`,
      );
    }
  }

  // Standard or itemized.
  const stdDeduction = computeStandardDeduction(input, k);
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
  //
  // TY 2026+ (OBBBA § 70105 amendments to § 199A(i)) layers in two extra
  // rules on top of the original formula:
  //   - The taxpayer needs at least `obbbaMinimumQbiToQualifyCents` of QBI
  //     to claim any deduction at all (statutory $1,000 floor; inflation-
  //     adjusted from 2027).
  //   - Above that floor, the deduction is max(formula, $400).
  // Both rules apply only when the bundle carries the OBBBA fields, which
  // is gated by tax year via constants.ts - 2025 leaves the fields
  // undefined and this block is a no-op for back-year forecasts.
  let qbi = 0;
  const qbiThreshold = k.QBI.thresholdBelow[input.filingStatus];
  if (QBI_ELIGIBLE_ENTITY_TYPES.has(input.entityType) && netBiz > 0) {
    // §199A(e)(2) tests against TAXABLE income (before QBI), not AGI, and
    // §199A(a)(2) caps the deduction at 20% of taxable income REDUCED BY
    // net capital gain. Using AGI let a filer just over the line keep a
    // deduction they'd lost, and ignoring capital gain overstated the cap
    // for anyone with meaningful LTCG/qualified dividends (audit #24).
    const taxableBeforeQbiForTest = Math.max(0, agi - deduction);
    if (taxableBeforeQbiForTest <= qbiThreshold) {
      // QBI is limited to lesser of (20% of QBI, 20% of taxable income
      // before QBI, excluding net capital gain).
      const taxableBeforeQbi = Math.max(
        0,
        agi - deduction - ltcgIncome,
      );
      qbi = Math.min(
        Math.round(netBiz * k.QBI.rate),
        Math.round(taxableBeforeQbi * k.QBI.rate),
      );

      // OBBBA minimum-deduction floor (TY 2026+).
      const minQbiToQualify = k.QBI.obbbaMinimumQbiToQualifyCents;
      const minDeduction = k.QBI.obbbaMinimumDeductionCents;
      if (minQbiToQualify != null && minDeduction != null) {
        if (netBiz < minQbiToQualify) {
          // OBBBA gates the deduction entirely below the QBI floor.
          if (qbi > 0) {
            assumptions.push(
              `QBI under $${(minQbiToQualify / 100).toLocaleString()} - OBBBA § 70105 disqualifies the §199A deduction for ${k.year}.`,
            );
          }
          qbi = 0;
        } else if (qbi < minDeduction) {
          // OBBBA floors the deduction at $400 once QBI clears the gate.
          // Cap by taxable income so we don't deduct more than the user
          // can actually use (prevents creating a "refund from QBI" in
          // edge cases where taxable income is small but QBI is sizable).
          const floored = Math.min(
            minDeduction,
            Math.max(0, agi - deduction),
          );
          if (floored > qbi) {
            assumptions.push(
              `§199A minimum deduction applied: $${(floored / 100).toLocaleString()} (OBBBA § 70105 boost - your formula yielded less).`,
            );
            qbi = floored;
          }
        }
      }
    } else {
      // Item #14: simplified QBI phase-in partial deduction. Statutory
      // phase-in range under § 199A(b)(3)(B) is $50,000 (single/HoH/MFS)
      // or $100,000 (MFJ/SS), measured above the threshold. Above the
      // threshold + range, SSTB gets zero and non-SSTB is W-2-wage /
      // UBIA limited. We don't have SSTB classification or business
      // W-2 wage / UBIA inputs, so we approximate as a linear phase-out
      // to zero across the range (the SSTB-equivalent case). A hint
      // tells the non-SSTB filer they may qualify for more.
      const phaseInWidth = isJoint ? 100_000 * 100 : 50_000 * 100;
      const overThreshold = agi - qbiThreshold;
      if (overThreshold < phaseInWidth) {
        const taxableBeforeQbi = Math.max(0, agi - deduction);
        const fullDeduction = Math.min(
          Math.round(netBiz * k.QBI.rate),
          Math.round(taxableBeforeQbi * k.QBI.rate),
        );
        const phaseFrac = 1 - overThreshold / phaseInWidth;
        qbi = Math.round(fullDeduction * phaseFrac);
        if (qbi > 0) {
          assumptions.push(
            `Partial §199A deduction applied (AGI is in the phase-in range; phased to ${Math.round(phaseFrac * 100)}% of the full 20% formula). Real deduction may be higher if your business is non-SSTB with W-2 wages or qualified property - confirm with a CPA.`,
          );
        }
      } else {
        hints.push(
          "Your AGI is above the QBI safe-harbor threshold AND the phase-in range. Non-SSTB businesses with W-2 wages or qualified property may still qualify for a partial deduction (the actual §199A math then involves W-2 wages, qualified property, and SSTB classification) - confirm with a CPA.",
        );
      }
    }
  }

  // OBBBA § 70433 1099-reporting threshold hint. Self-employed filers in
  // a tax year that has the new $2,000 threshold should know they no
  // longer need to send 1099s to vendors paid under that amount. Pure
  // compliance UX; doesn't affect any tax math.
  if (
    SE_ENTITY_TYPES.has(input.entityType) &&
    k.INFO_REPORTING_THRESHOLD_CENTS > 60_000 // distinguishes new $2,000 from legacy $600
  ) {
    hints.push(
      `Heads-up: for ${k.year}, you only need to send 1099-NEC/1099-MISC to vendors you've paid more than $${(k.INFO_REPORTING_THRESHOLD_CENTS / 100).toLocaleString()} (up from $600 - OBBBA § 70433). Anything below that no longer requires a 1099.`,
    );
  }

  const taxableIncome = Math.max(0, agi - deduction - qbi);

  // Capital gains + qualified dividends (item #4). Currently the engine
  // bundles investment income (ytdInvestmentIncomeCents) into the
  // ordinary-tax stream. When the caller passes structured LTCG and/or
  // QD numbers, we split them out and tax them at the LTCG brackets
  // (0/15/20%) instead. Net effect: a user with $50k of LTCG sees a
  // much lower tax than if it were ordinary income.
  //
  // The math: stack ordinary income up to the 0% breakpoint, then 15%,
  // then 20%. We approximate "ordinary income for stacking" as
  // (taxable - LTCG - QD) so the LTCG slice starts where ordinary ends.
  // Use the same local LTCG / QD values that were added to AGI above,
  // so the LTCG slice math is consistent with what's in AGI. (If we
  // re-read input here we'd risk a sign/zero mismatch if either value
  // ever gets normalized differently between the two code paths.)
  const ordinaryTaxable = Math.max(0, taxableIncome - ltcgIncome);
  const fedTaxOnOrdinary = computeFederalIncomeTax(
    ordinaryTaxable,
    input.filingStatus,
    k,
  );
  let capitalGainsTax = 0;
  if (ltcgIncome > 0) {
    // 2026 LTCG breakpoints (Rev. Proc. 2025-32 § 4.03). Hard-coded
    // here rather than threaded through the bundle because they're
    // only relevant when LTCG/QD is non-zero; bundle stays focused
    // on the high-traffic ordinary-tax numbers.
    const zeroBreak =
      input.taxYear >= 2026
        ? isJoint
          ? 98_900 * 100
          : input.filingStatus === "head_of_household"
            ? 66_200 * 100
            : input.filingStatus === "married_filing_separately"
              ? 49_450 * 100
              : 49_450 * 100
        : isJoint
          ? 96_700 * 100
          : 48_350 * 100;
    const fifteenBreak =
      input.taxYear >= 2026
        ? isJoint
          ? 613_700 * 100
          : input.filingStatus === "head_of_household"
            ? 579_600 * 100
            : input.filingStatus === "married_filing_separately"
              ? 306_850 * 100
              : 545_500 * 100
        : isJoint
          ? 600_050 * 100
          : 533_400 * 100;
    let remainingLtcg = Math.min(ltcgIncome, taxableIncome);
    const taxedAtZero = Math.max(
      0,
      Math.min(remainingLtcg, zeroBreak - ordinaryTaxable),
    );
    remainingLtcg -= taxedAtZero;
    const taxedAtFifteen = Math.max(
      0,
      Math.min(
        remainingLtcg,
        fifteenBreak - Math.max(ordinaryTaxable, zeroBreak),
      ),
    );
    remainingLtcg -= taxedAtFifteen;
    const taxedAtTwenty = Math.max(0, remainingLtcg);
    capitalGainsTax =
      Math.round(taxedAtFifteen * 0.15) +
      Math.round(taxedAtTwenty * 0.2);
    if (capitalGainsTax >= 0) {
      assumptions.push(
        `Qualified gains + dividends taxed at preferred LTCG brackets (0/15/20%): $${(taxedAtZero / 100).toLocaleString()} at 0%, $${(taxedAtFifteen / 100).toLocaleString()} at 15%, $${(taxedAtTwenty / 100).toLocaleString()} at 20%.`,
      );
    }
  }

  const fedTaxBeforeCredits = fedTaxOnOrdinary + capitalGainsTax;

  // AMT computation (item #3). § 55 alternative minimum tax. The
  // approximation here:
  //   AMTI = AGI (most preferences we'd need to add back live above
  //          the AGI line in the regular path already, e.g. SALT and
  //          some misc deductions; on a real return AMT has its own
  //          standard deduction add-back). We use AGI as a
  //          conservative AMTI base.
  //   AMT exemption: from the bundle's per-year AMT_2026 / 2025 table.
  //   AMT phase-out: 25 cents per dollar of AMTI above the phaseout
  //                  start.
  //   AMT rate: 26% up to the 28%-breakpoint, 28% beyond.
  // We take the larger of regular tax (after credits) and AMT, and
  // report the delta as amtAddOnCents so the UI can show "AMT kicked
  // in by $X" rather than burying it inside totalTaxCents.
  //
  // Constants are inlined for 2026 from Rev. Proc. 2025-32 § 4.10
  // because they're only consumed here; threading them through the
  // bundle would add a lot of fields for a single consumer. Update
  // alongside the rest of constants-<year>.ts when refreshing.
  const amtConstants =
    input.taxYear >= 2026
      ? {
          exemption: isJoint
            ? 140_200 * 100
            : input.filingStatus === "married_filing_separately"
              ? 70_100 * 100
              : 90_100 * 100,
          phaseoutStart: isJoint ? 1_000_000 * 100 : 500_000 * 100,
          rate28Breakpoint: isJoint
            ? 244_500 * 100
            : input.filingStatus === "married_filing_separately"
              ? 122_250 * 100
              : 244_500 * 100,
        }
      : {
          // 2025 figures from Rev. Proc. 2024-40.
          exemption: isJoint
            ? 137_000 * 100
            : input.filingStatus === "married_filing_separately"
              ? 68_500 * 100
              : 88_100 * 100,
          phaseoutStart: isJoint ? 1_000_000 * 100 : 500_000 * 100,
          rate28Breakpoint: isJoint
            ? 239_100 * 100
            : input.filingStatus === "married_filing_separately"
              ? 119_550 * 100
              : 239_100 * 100,
        };
  const amtiBase = agi;
  const phaseoutOver = Math.max(0, amtiBase - amtConstants.phaseoutStart);
  const exemptionAfterPhaseout = Math.max(
    0,
    amtConstants.exemption - Math.round(phaseoutOver * 0.25),
  );
  const amti = Math.max(0, amtiBase - exemptionAfterPhaseout);
  const amtAt26 = Math.min(amti, amtConstants.rate28Breakpoint);
  const amtAt28 = Math.max(0, amti - amtConstants.rate28Breakpoint);
  const tentativeAmt =
    Math.round(amtAt26 * 0.26) + Math.round(amtAt28 * 0.28);
  // The AMT computation also keeps the LTCG/QD preferential rates - it
  // does NOT re-tax those amounts. So we subtract our LTCG tax from
  // tentativeAmt's "regular tax portion" before comparing. Simplified:
  // compare tentativeAmt against (regular fed tax before credits +
  // capital gains tax). Take whichever is larger.
  const amtTotal = Math.max(0, tentativeAmt - capitalGainsTax);
  let amtAddOnCents = 0;
  const fedTaxBeforeAmt = Math.max(0, fedTaxBeforeCredits);

  // Apply Child Tax Credit + Credit for Other Dependents. Both are
  // non-refundable here (we deliberately don't model the refundable
  // Additional CTC because forecasting "you'll get money back" is more
  // surprising than helpful for a save-target tool).
  // Business scope suppresses individual-return credits (see ForecastInput.scope).
  const isBusinessScope = input.scope === "business";
  const credits = isBusinessScope
    ? 0
    : computeFamilyCredits({
        dependents: input.dependents,
        dependentsUnder17: input.dependentsUnder17,
        filingStatus: input.filingStatus,
        agiCents: agi,
        taxYear: input.taxYear,
      });
  if (credits > 0) {
    assumptions.push(
      `Family credits: $${(k.CHILD_TAX_CREDIT.ctcPerChildCents / 100).toLocaleString()} per qualifying child under 17 (CTC) + $${(k.CHILD_TAX_CREDIT.odcPerOtherCents / 100).toLocaleString()} per other dependent (ODC), phased out above the AGI threshold.`,
    );
  }

  // Saver's Credit (§ 25B). Non-refundable; bracket-driven 10/20/50%
  // of up to $2,000 ($4,000 MFJ) of retirement contributions. Computed
  // here because we need final agi + contribution total. Roth IRA
  // contributions count toward the Saver's Credit even though they
  // aren't deductible, so the contribution base for this calculation
  // includes both deductible AND Roth amounts.
  const saversContributionBase =
    Math.max(0, structuredRetirementCents) +
    Math.max(0, rothContributionCents);
  const saversResult = computeSaversCreditCents({
    retirementContributionsCents: saversContributionBase,
    agiCents: agi,
    filingStatus: input.filingStatus,
    age: input.age,
    taxYear: input.taxYear,
  });
  const saversCreditCents = isBusinessScope ? 0 : saversResult.creditCents;
  const saversCreditRate = isBusinessScope ? 0 : saversResult.rate;
  const saversCreditReasonZero = isBusinessScope
    ? ""
    : (saversResult.reasonZero ?? "");
  if (saversCreditCents > 0) {
    assumptions.push(
      `Saver's Credit (§ 25B) applied at ${Math.round(saversResult.rate * 100)}% of qualifying retirement contributions: $${(saversCreditCents / 100).toLocaleString()}. Non-refundable - reduces tax to zero but no refund of the unused portion.`,
    );
  }

  // Education credit (§ 25A). The user's claimAotc flag picks AOTC
  // (partially refundable, $2,500 max, first-4-years undergrad) vs
  // Lifetime Learning Credit (non-refundable, $2,000 max, any
  // post-secondary). Both phase out over the same MAGI range.
  // Disqualified for MFS.
  const eduCredit = computeEducationCreditCents({
    qualifiedExpensesCents: Math.max(
      0,
      input.qualifiedEducationExpensesCents ?? 0,
    ),
    modifiedAgiCents: agi,
    filingStatus: input.filingStatus,
    claimAotc: input.claimAotc ?? false,
  });
  const educationCreditRefundableCents = isBusinessScope
    ? 0
    : eduCredit.refundableCents;
  const educationCreditNonRefundableCents = isBusinessScope
    ? 0
    : eduCredit.nonRefundableCents;
  const educationCreditKind = isBusinessScope ? "none" : eduCredit.kind;
  const educationCreditReasonZero = isBusinessScope
    ? ""
    : (eduCredit.reasonZero ?? "");
  if (educationCreditRefundableCents + educationCreditNonRefundableCents > 0) {
    if (educationCreditKind === "aotc") {
      assumptions.push(
        `American Opportunity Credit (§ 25A(b)) applied: $${((educationCreditRefundableCents + educationCreditNonRefundableCents) / 100).toLocaleString()} (40% refundable, 60% non-refundable). Eligibility self-attested via the AOTC checkbox.`,
      );
    } else if (educationCreditKind === "llc") {
      assumptions.push(
        `Lifetime Learning Credit (§ 25A(c)) applied: $${(educationCreditNonRefundableCents / 100).toLocaleString()}. Non-refundable - reduces tax dollar-for-dollar.`,
      );
    }
  }

  // Residential energy + EV credits (item #12). Non-refundable; can
  // reduce tax to zero but not below. Sum them with the family credits
  // and clamp to fedTaxBeforeCredits.
  const residentialEnergyCreditCents = Math.max(
    0,
    input.residentialEnergyCreditCents ?? 0,
  );
  const evCreditCents = Math.max(0, input.evCreditCents ?? 0);
  if (residentialEnergyCreditCents > 0) {
    assumptions.push(
      `Residential energy credit applied: $${(residentialEnergyCreditCents / 100).toLocaleString()} (§ 25D - solar/geothermal/wind).`,
    );
  }
  if (evCreditCents > 0) {
    assumptions.push(
      `Clean vehicle credit applied: $${(evCreditCents / 100).toLocaleString()} (§ 30D / § 25E).`,
    );
  }

  const totalNonRefundableCredits =
    credits +
    saversCreditCents +
    educationCreditNonRefundableCents +
    residentialEnergyCreditCents +
    evCreditCents;
  const fedTaxAfterCredits = Math.max(
    0,
    fedTaxBeforeAmt - totalNonRefundableCredits,
  );

  // Compare AMT against the PRE-credit regular tax, then apply the same
  // non-refundable credits to whichever side wins: §26(a) allows the
  // personal credits against AMT, so winning AMT must not wipe them out.
  // Real Form 6251 is more nuanced about credit ordering; this is the
  // directionally-correct simplification for a forecast.
  let fedTax: number;
  if (amtTotal > fedTaxBeforeAmt) {
    amtAddOnCents = amtTotal - fedTaxBeforeAmt;
    // The CTC/ODC and other non-refundable personal credits are allowed
    // against AMT (IRC §26(a) as amended — the personal-credit
    // limitation was permanently repealed), so when AMT wins the filer
    // does NOT lose them. Previously fedTax jumped straight to the raw
    // AMT figure, silently deleting every credit and overstating tax by
    // the full credit amount for anyone AMT touched (audit #36).
    fedTax = Math.max(0, amtTotal - totalNonRefundableCredits);
    assumptions.push(
      `AMT (§ 55) applied: alternative minimum tax exceeds regular tax by $${(amtAddOnCents / 100).toLocaleString()}. Common triggers: large LTCG stacked on high ordinary income, or high state-tax / misc itemized deductions hitting the SALT cap.`,
    );
  } else {
    fedTax = fedTaxAfterCredits;
  }

  // State tax: try real brackets first for the high-tax states we've
  // encoded (CA, NY, NJ, MA, MN, OR, HI, DC, MD, CT - each with proper
  // filing-status columns and high-income surcharges). Fall back to
  // the curated flat-rate table for everywhere else. Surface either
  // way via the assumptions strip so the user can verify what
  // method/year was used.
  let stTax = 0;
  // Tier 1 #4: multi-state apportionment. When the company has
  // declared nexus in >1 state, we apportion AGI across states by
  // the sales-factor weights, compute each state's tax against its
  // own brackets, and credit the resident state for taxes paid to
  // non-resident states. The result lands in stTax as a single
  // aggregate number (the single-state UI doesn't know about
  // per-state breakdown yet; the assumptions strip explains).
  if (input.stateNexus && input.stateNexus.length > 1) {
    // Normalize weights to sum to 10000.
    const totalBps = input.stateNexus.reduce(
      (a, r) => a + Math.max(0, r.salesFactorBps),
      0,
    );
    const normalize = (bps: number) =>
      totalBps > 0 ? bps / totalBps : 1 / input.stateNexus!.length;

    let nonResidentTax = 0;
    let residentGrossTax = 0;
    const residentRow = input.stateNexus.find((r) => r.isResident);
    if (!residentRow) {
      // No resident state declared, treat the first row as resident
      // and warn.
      hints.push(
        "Multi-state nexus declared but no resident state flagged. Pick a home state under the company profile.",
      );
    }

    for (const row of input.stateNexus) {
      const code = row.stateCode.toUpperCase();
      const weight = normalize(row.salesFactorBps);
      const apportionedAgi = Math.round(agi * weight);
      const base = stateTaxableIncomeFromAgi({
        agiCents: apportionedAgi,
        filingStatus: input.filingStatus,
        stateCode: code,
      });
      const brackets = computeStateTaxFromBrackets({
        taxableIncomeCents: base,
        filingStatus: input.filingStatus,
        stateCode: code,
        taxYear: input.taxYear,
      });
      const oneStateTax = brackets
        ? brackets.taxCents
        : Math.round(base * stateRate(code));
      if (row.isResident || (!residentRow && row === input.stateNexus[0])) {
        residentGrossTax = brackets
          ? brackets.taxCents
          : oneStateTax;
        // Compute the resident state on FULL AGI (resident states
        // tax worldwide income), not just the apportioned slice.
        const residentFullBase = stateTaxableIncomeFromAgi({
          agiCents: agi,
          filingStatus: input.filingStatus,
          stateCode: code,
        });
        const residentFullBrackets = computeStateTaxFromBrackets({
          taxableIncomeCents: residentFullBase,
          filingStatus: input.filingStatus,
          stateCode: code,
          taxYear: input.taxYear,
        });
        residentGrossTax = residentFullBrackets
          ? residentFullBrackets.taxCents
          : Math.round(residentFullBase * stateRate(code));
      } else {
        nonResidentTax += oneStateTax;
      }
    }

    // Resident state credit (Schedule M1CR-equivalent): the
    // resident state allows a dollar-for-dollar credit for taxes
    // paid to other states on the income those states taxed, up
    // to the resident state's tax on the SAME slice of income.
    // Conservative approximation: credit = min(nonResidentTax,
    // residentGrossTax × (sum of non-resident weights)).
    const nonResidentWeightSum = input.stateNexus
      .filter((r) => !r.isResident)
      .reduce((a, r) => a + normalize(r.salesFactorBps), 0);
    const creditCap = Math.round(residentGrossTax * nonResidentWeightSum);
    const credit = Math.min(nonResidentTax, creditCap);
    const residentNetTax = Math.max(0, residentGrossTax - credit);
    stTax = residentNetTax + nonResidentTax;

    const stateList = input.stateNexus
      .map(
        (r) =>
          `${r.stateCode.toUpperCase()}${r.isResident ? "*" : ""} ${(normalize(r.salesFactorBps) * 100).toFixed(1)}%`,
      )
      .join(", ");
    assumptions.push(
      `Multi-state apportionment applied: ${stateList} (* = resident state). Resident state credits taxes paid elsewhere up to the resident-state-equivalent tax on the same income slice.`,
    );
    hints.push(
      "Multi-state apportionment is an estimate; confirm each state's specific apportionment rules (single sales factor vs three-factor) and any throwback / throwout rules with your CPA.",
    );
  } else if (input.stateCode) {
    // STATE taxable income ≠ FEDERAL taxable income. Most states key
    // off federal AGI then subtract their own state standard
    // deduction; NONE of them recognise the federal QBI deduction. If
    // we pass `taxableIncome` (which has both federal std deduction
    // and federal QBI removed) into the bracket math we under-state
    // state tax, the May 2026 round-2 audit caught this on CA at
    // ~$378 vs ~$1,033 hand-calc. Use the AGI-based helper instead.
    const stateBase = stateTaxableIncomeFromAgi({
      agiCents: agi,
      filingStatus: input.filingStatus,
      stateCode: input.stateCode,
    });
    const brackets = computeStateTaxFromBrackets({
      taxableIncomeCents: stateBase,
      filingStatus: input.filingStatus,
      stateCode: input.stateCode,
      taxYear: input.taxYear,
    });
    if (brackets) {
      stTax = brackets.taxCents;
      assumptions.push(brackets.note);
      // NYC-specific addendum: city tax adds ~3.07%-3.876%.
      if (input.stateCode.toUpperCase() === "NY") {
        hints.push(
          "If you live in New York City, the city adds its own income tax (~3.078% to 3.876% in 2025) on top of the state. We don't yet capture city residency; manually add it if you're a NYC resident.",
        );
      }
      // Maryland-specific addendum: county tax adds ~2-3.2%.
      if (input.stateCode.toUpperCase() === "MD") {
        hints.push(
          "Maryland counties add their own income tax (~2.0% to 3.2% depending on county) on top of the state brackets. We don't yet capture county residency; estimate ~2.5% on your taxable income if you're not sure.",
        );
      }
    } else {
      // Fall back to the curated flat rate against the SAME state-
      // taxable base, using `taxableIncome` (federal) would under-
      // state state tax for the same reason described above.
      const stRate = stateRate(input.stateCode);
      stTax = Math.round(stateBase * stRate);
      if (stRate > 0) {
        assumptions.push(
          `State estimate for ${input.stateCode} uses a curated ${(stRate * 100).toFixed(2)}% flat rate. Real bracket math is encoded for CA, NY, NJ, MA, MN, OR, HI, DC, MD, CT; other graduated states fall back to this approximation - confirm against your state's published brackets.`,
        );
      } else if (input.stateCode) {
        assumptions.push(
          `No state income tax for ${input.stateCode}.`,
        );
      }
    }
  }

  // Entity-level state taxes (pass-through path).
  //
  // The bracket math above gives us the OWNER's personal-side state
  // income tax. On top of that, the ENTITY itself may owe:
  //   - S-Corp net-income tax (CA 1.5%, IL 1.5%, MA 8%)
  //   - LLC franchise tax + tiered gross-receipts fee (CA)
  //   - Gross-receipts / margin tax (TX, OH, WA, OR, NV)
  //
  // C-Corps are handled in the dedicated short-circuit earlier in
  // this function; this block runs for sole_prop / single_llc /
  // multi_llc / partnership / s_corp / self_employed_1099. The 1099
  // self-employed case has no registered entity at the state level -
  // map it to sole_prop so the gross-receipts taxes (which apply
  // regardless of entity registration) still fire if applicable.
  {
    const entityTypeForState =
      input.entityType === "self_employed_1099"
        ? "sole_prop"
        : input.entityType;
    const entityTax = computeStateEntityTax({
      stateCode: input.stateCode,
      entityType: entityTypeForState,
      netBusinessIncomeCents: netBiz,
      grossReceiptsCents: projectedIncome,
    });
    if (entityTax.totalEntityTaxCents > 0) {
      stTax += entityTax.totalEntityTaxCents;
      for (const n of entityTax.notes) assumptions.push(n);
    }
    for (const h of entityTax.hints) hints.push(h);
  }

  // Net Investment Income Tax (NIIT). IRC §1411-3.8% on the lesser
  // of net investment income or modified AGI over the threshold.
  // Investment income: interest, dividends, capital gains, passive
  // rental. Caller passes ytdInvestmentIncomeCents; we project it the
  // same way as ordinary income.
  // Long-term capital gains and qualified dividends ARE net investment
  // income (IRC §1411(c)) and DO count toward the EITC investment-income
  // disqualifier (§32(i)). They were excluded, so NIIT was effectively
  // dead code and a filer with large gains could still be handed EITC
  // (audit #22). They're already projected to year-end upstream, so only
  // the caller-supplied YTD figure gets the pace factor.
  const projectedInvestmentIncome = round(
    Math.max(0, input.ytdInvestmentIncomeCents ?? 0) * projectionFactor +
      ltcgIncome,
  );
  let niit = 0;
  if (projectedInvestmentIncome > 0) {
    const niitThreshold = k.NIIT.threshold[input.filingStatus] ?? 0;
    const agiOverThreshold = Math.max(0, agi - niitThreshold);
    const niitBase = Math.min(projectedInvestmentIncome, agiOverThreshold);
    niit = Math.round(niitBase * k.NIIT.rate);
    if (niit > 0) {
      assumptions.push(
        "Net Investment Income Tax (NIIT) 3.8% applied to the lesser of investment income or AGI over threshold (Form 8960).",
      );
    }
  }

  // EITC (refundable, § 32). Computed AFTER all other tax math so we
  // can use AGI and the engine-derived earned income (W-2 wages +
  // spouse W-2 wages + net SE earnings via the Medicare-wages
  // combined number, which mirrors how the IRS defines "earned
  // income" for EITC purposes - close enough for a forecast). Use
  // projected investment income for the § 32(i) disqualifier test.
  const earnedIncomeForEitc = combinedMedicareIncome;
  const eitcResult = computeEitcCents({
    earnedIncomeCents: earnedIncomeForEitc,
    agiCents: agi,
    investmentIncomeCents: projectedInvestmentIncome,
    qualifyingChildren: input.dependentsUnder17,
    filingStatus: input.filingStatus,
    taxYear: input.taxYear,
  });
  const eitcCents = isBusinessScope ? 0 : eitcResult.creditCents;
  const eitcReasonZero = isBusinessScope
    ? ""
    : (eitcResult.reasonZero ?? "");
  if (eitcCents > 0) {
    assumptions.push(
      `Earned Income Tax Credit (§ 32) applied: $${(eitcCents / 100).toLocaleString()} (refundable - if you owe less than that in tax, the IRS sends the rest back as a refund).`,
    );
  }

  // totalTax is allowed to go negative here when a refundable credit
  // exceeds the user's regular + payroll tax. That negative net
  // amount flows through the balance/refund math below as additional
  // refund-side cash. Refundable credits applied here:
  //   - EITC (§ 32): fully refundable.
  //   - 40% portion of AOTC (§ 25A(b)): refundable up to $1,000 per
  //     student. We treat the value the engine computed as already
  //     capped at that statutory ceiling.
  const totalTax =
    fedTax +
    seTax +
    additionalMedicare +
    niit +
    stTax -
    eitcCents -
    educationCreditRefundableCents;
  const w2WithheldTotal =
    input.ownerW2WithheldCents + input.spouseW2WithheldCents;
  // Employer-withheld additional Medicare (see the estimate above) is
  // already paid, so it belongs in alreadyPaid — otherwise the same 0.9%
  // is charged twice for a high-wage household (audit #37).
  const alreadyPaid =
    input.estimatedPaymentsCents +
    w2WithheldTotal +
    employerWithheldAddtlMedicare;
  // Bidirectional balance: positive = still owe, negative = refund.
  // The combined-filer (W-2 + Schedule C) case is exactly where this
  // matters most, the user's W-2 withholding can easily exceed total
  // tax once SE deductions and credits are applied, and they should
  // see the refund amount, not a flat $0 next to a "Refund" label.
  const balance = totalTax - alreadyPaid;
  const remaining = Math.max(0, balance);
  const refund = Math.max(0, -balance);

  const monthsRemaining = remainingMonthsToFilingDeadline(input.taxYear);
  const monthlySaveTarget = Math.round(remaining / monthsRemaining);

  const marginal = marginalFederalRate(taxableIncome, input.filingStatus, k);
  // Overall effective rate: total tax (federal income + SE + state +
  // additional Medicare + NIIT, less credits) over gross projected
  // income. This is the "you'll lose ~X% of every dollar to tax"
  // number, useful as a top-line stat.
  const effective =
    totalGrossIncomeCents > 0 ? totalTax / totalGrossIncomeCents : 0;
  // Federal-income-tax-specific effective rate: federal income tax over
  // TAXABLE income. The May 2026 audit (High #4) caught the UI showing
  // the combined `effective` under a tile labelled "Federal income tax
  //, Effective rate" with $0 federal income tax. That label promised
  // FIT/taxable but the value was total/gross. Split it out so the UI
  // can show the right number under the right label.
  const federalIncomeTaxEffectiveRate =
    taxableIncome > 0 ? fedTax / taxableIncome : 0;

  // Underpayment-penalty safe harbor: pay at least 90% of this year's
  // tax to avoid the penalty. We surface the risk via a hint; the
  // quarterly schedule below already nudges the user toward the right
  // catch-up amount.
  const safeHarborTarget = Math.round(
    totalTax * k.UNDERPAYMENT_SAFE_HARBOR.currentYearShare,
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

  // ---------- Educational hints (items #6, #8, #9, #10, #13) ----------
  //
  // Each surfaces a credit/benefit the engine doesn't fully compute but
  // that's likely available to the user given their inputs. The hints
  // are written so the user sees actionable next steps rather than vague
  // tax-jargon.

  // (The old "qualified-education-expenses detected, look into AOTC/LLC"
  // eligibility hint was removed once the engine started computing the
  // real credit through lib/tax/credits/education.ts. The
  // EducationCreditTile now renders the actual dollar amount, the
  // credit type (AOTC vs LLC), and the refundable-portion breakout.)

  // #8 Augusta Rule (§ 280A(g)). 14-day home rental income is excluded
  // from gross income if your business pays you to host meetings, board
  // sessions, etc. at your home. Trigger when the user has a home
  // office (so they have the space) plus an SE business that could
  // pay rent.
  if (
    SE_ENTITY_TYPES.has(input.entityType) &&
    input.autoHomeOfficeCents > 0
  ) {
    hints.push(
      "Augusta Rule (§ 280A(g)): your business can rent your home from you for up to 14 days a year at fair-market rates, and the rental income is tax-free to you while still a deductible expense to the business. Common use: quarterly board meetings or client-strategy days. Document with a written rental agreement and comparable-rate research.",
    );
  }

  // #9 Premium Tax Credit reconciliation (§ 36B). When the user
  // received advance PTC payments, they reconcile on Form 8962 at
  // filing time. We don't compute the actual PTC, but the heads-up
  // is genuinely useful.
  if (Math.max(0, input.ptcAdvancePaymentsCents ?? 0) > 0) {
    hints.push(
      `You received $${((input.ptcAdvancePaymentsCents ?? 0) / 100).toLocaleString()} in marketplace advance Premium Tax Credit payments. These reconcile on Form 8962 at filing time - if your actual AGI is higher than projected when you enrolled, you may owe some back; if lower, you may get more. We don't compute the reconciliation here; the marketplace's calculator is the source of truth.`,
    );
  }

  // (The old "EITC eligibility heads-up" hint that lived here was
  // removed once the engine started computing the real credit through
  // lib/tax/credits/eitc.ts - the EitcTile renders either the actual
  // refundable amount or the engine's per-user "why zero" reason, both
  // of which are more informative than a generic eligibility hint.)

  // (The old "Saver's Credit is likely available" eligibility hint
  // that used to live here was removed once the engine started
  // computing the real credit through lib/tax/credits/savers.ts. The
  // SaversCreditTile renders the actual dollar amount when the credit
  // applies, or a per-user "why zero" note when there's a clear reason
  // it didn't.)

  // ---------- Retirement tax-savings calc (item #1) ----------
  //
  // Show the user the marginal-rate value of the retirement deduction
  // they took (so the savings tile can say "you saved $X this year by
  // contributing $Y"). Capped at the deductible portion (Roth doesn't
  // count - it's after-tax).
  const retirementContributionTotalCents =
    structuredRetirementCents + rothContributionCents;
  const retirementTaxSavingsCents = Math.round(
    structuredRetirementCents * marginal,
  );

  // ---------- Personalized retirement recommendation ----------
  //
  // Look at each bucket the user could still fund and recommend the
  // single highest-impact one. "Impact" = additional deduction × marginal
  // rate, capped at remaining taxable income (you can't deduct yourself
  // below zero, and an additional contribution that would do so saves
  // only what's left of the tax bill).
  //
  // 2026 statutory limits used here:
  //   Solo 401(k) combined:   $70,000  ($77,500 if 50+)
  //   SEP-IRA:                $70,000 or 25% of net SE earnings, lesser
  //   Trad+Roth IRA combined: $7,500   ($8,500 if 50+)
  //   HSA self-only:          $4,400   ($5,400 if 55+)
  //   HSA family:             $8,750   ($9,750 if 55+)
  // We don't know HDHP status, so we conservatively skip the HSA
  // recommendation here - users who already contribute to HSA see it
  // counted in the savings number, but we don't push more.
  const age = input.age ?? 0;
  const ageBonus50 = age >= 50;
  const solo401kCap = (ageBonus50 ? 77_500 : 70_000) * 100;
  const iraCap = (ageBonus50 ? 8_500 : 7_500) * 100;
  const sepCapStatutory = 70_000 * 100;
  const isSeEntity = SE_ENTITY_TYPES.has(input.entityType);
  // SEP cap is min(statutory, 25% of net SE earnings). Net SE earnings
  // here is the projected business income net of half SE tax.
  const sepCapByEarnings = isSeEntity
    ? Math.max(0, Math.round((netBiz - halfSeTaxDeduction) * 0.25))
    : 0;
  const sepCap = Math.min(sepCapStatutory, sepCapByEarnings);
  // Remaining headroom per bucket (subtract what they already
  // contributed).
  const solo401kRemaining = isSeEntity
    ? Math.max(
        0,
        solo401kCap - Math.max(0, input.retirementSolo401kCents ?? 0),
      )
    : 0;
  const sepRemaining = isSeEntity
    ? Math.max(
        0,
        sepCap - Math.max(0, input.retirementSepIraCents ?? 0),
      )
    : 0;
  // Traditional + Roth share the IRA limit; the recommendation is
  // specifically for Traditional (deductible). Subtract BOTH from
  // the cap so we don't over-recommend if Roth already used it.
  const iraAlreadyUsed =
    Math.max(0, input.retirementTraditionalIraCents ?? 0) +
    Math.max(0, input.retirementRothIraCents ?? 0);
  const traditionalIraRemaining = Math.max(0, iraCap - iraAlreadyUsed);

  // The deductible-headroom cap: you can't deduct more than your
  // taxable income (you'd "waste" the rest of the contribution from a
  // tax-savings perspective, though the dollars still grow tax-deferred
  // - we just want the *forecast* number to be honest about marginal
  // benefit).
  const deductibleHeadroom = Math.max(0, taxableIncome);

  type Candidate = {
    bucket:
      | "solo_401k"
      | "sep_ira"
      | "traditional_ira";
    addCents: number;
  };
  // `as const` on each bucket string is what keeps the literal type after
  // .filter(); without it TS widens to `string` and the array no longer
  // assigns to Candidate[].
  const candidates: Candidate[] = [
    { bucket: "solo_401k" as const, addCents: solo401kRemaining },
    { bucket: "sep_ira" as const, addCents: sepRemaining },
    { bucket: "traditional_ira" as const, addCents: traditionalIraRemaining },
  ].filter((c) => c.addCents > 0);

  let retirementBucket:
    | "solo_401k"
    | "sep_ira"
    | "traditional_ira"
    | "hsa"
    | "none" = "none";
  let retirementAddCents = 0;
  let retirementSavingsRecCents = 0;
  let retirementSummary =
    "You're already at the contribution caps we can model, or your taxable income wouldn't benefit from more deductions this year. Nice job.";

  if (candidates.length > 0 && deductibleHeadroom > 0 && marginal > 0) {
    // Pick the largest single-bucket recommendation that's still useful
    // (i.e. capped by deductibleHeadroom). Larger headroom = bigger
    // marginal-rate-value pickup.
    candidates.sort((a, b) => b.addCents - a.addCents);
    const top = candidates[0];
    const usable = Math.min(top.addCents, deductibleHeadroom);
    if (usable > 0) {
      retirementBucket = top.bucket;
      retirementAddCents = usable;
      retirementSavingsRecCents = Math.round(usable * marginal);
      const bucketLabel =
        top.bucket === "solo_401k"
          ? "Solo 401(k)"
          : top.bucket === "sep_ira"
            ? "SEP-IRA"
            : "Traditional IRA";
      retirementSummary = `Contribute another $${(usable / 100).toLocaleString()} to your ${bucketLabel} and save about $${(retirementSavingsRecCents / 100).toLocaleString()} in federal tax this year (your ${Math.round(marginal * 100)}% marginal rate × the deduction).`;
    }
  } else if (!isSeEntity && traditionalIraRemaining > 0 && marginal > 0) {
    // W-2-only filers: surface the Traditional IRA option even though
    // Solo 401(k) / SEP don't apply.
    const usable = Math.min(traditionalIraRemaining, deductibleHeadroom);
    if (usable > 0) {
      retirementBucket = "traditional_ira";
      retirementAddCents = usable;
      retirementSavingsRecCents = Math.round(usable * marginal);
      retirementSummary = `Contribute another $${(usable / 100).toLocaleString()} to a Traditional IRA and save about $${(retirementSavingsRecCents / 100).toLocaleString()} in federal tax this year (your ${Math.round(marginal * 100)}% marginal rate × the deduction). Deductibility may phase out if you or your spouse is covered by an employer retirement plan and your AGI is high - confirm before contributing the full amount.`;
    }
  }

  // ---------- W-4 withholding-adjustment recommendation (item #15) ----------
  //
  // For W-2 filers, the most useful actionable output is "what should
  // you do with your W-4 to land at zero next year." We translate the
  // current balance into a per-paycheck adjustment assuming bi-weekly
  // pay (26 paychecks/year). Threshold of $500 keeps us from nagging
  // every user with a tiny rounding-error refund. SE-only filers get
  // direction="ok" because they don't have a W-4.
  const hasW2Wages =
    input.ownerW2WagesCents > 0 || input.spouseW2WagesCents > 0;
  let w4Direction: "increase" | "decrease" | "ok" = "ok";
  let w4PerPaycheckDeltaCents = 0;
  let w4AnnualDeltaCents = 0;
  if (hasW2Wages) {
    const balanceForW4 = balance; // positive = under-withheld
    if (Math.abs(balanceForW4) > 500 * 100) {
      w4AnnualDeltaCents = Math.abs(balanceForW4);
      w4PerPaycheckDeltaCents = Math.round(w4AnnualDeltaCents / 26);
      if (balanceForW4 > 0) {
        w4Direction = "increase";
        hints.push(
          `W-4 nudge: you're projecting to owe $${(balanceForW4 / 100).toLocaleString()} at filing. Add $${(w4PerPaycheckDeltaCents / 100).toLocaleString()} to "Extra withholding" on Form W-4 step 4(c) for each remaining paycheck this year and you'll land near zero.`,
        );
      } else {
        w4Direction = "decrease";
        hints.push(
          `W-4 nudge: you're projecting a $${(Math.abs(balanceForW4) / 100).toLocaleString()} refund - that's your money the IRS is holding without interest. Reduce withholding by ~$${(w4PerPaycheckDeltaCents / 100).toLocaleString()} per paycheck (or adjust dependents on W-4 step 3) to get that cash flowing through the year instead.`,
        );
      }
    }
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
    overallEffectiveRate: effective,
    federalIncomeTaxEffectiveRate,
    marginalRate: marginal,
    quarterlyEstimates,
    underpaymentRisk,
    ytdIncomeCents: input.ytdIncomeCents,
    ytdDeductibleExpensesCents: ytdDeductibleExpenses,
    ytdNetBusinessIncomeCents: ytdNetBiz,
    assumptions,
    hints,
    // New fields for items #1-#15.
    amtAddOnCents,
    capitalGainsTaxCents: capitalGainsTax,
    retirementContributionTotalCents,
    retirementTaxSavingsCents,
    foreignEarnedIncomeExcludedCents,
    studentLoanInterestDeductionCents,
    w4Recommendation: {
      direction: w4Direction,
      perPaycheckDeltaCents: w4PerPaycheckDeltaCents,
      annualDeltaCents: w4AnnualDeltaCents,
    },
    retirementRecommendation: {
      bucket: retirementBucket,
      addCents: retirementAddCents,
      taxSavingsCents: retirementSavingsRecCents,
      summary: retirementSummary,
    },
    eitcCents,
    eitcReasonZero,
    saversCreditCents,
    saversCreditRate,
    saversCreditReasonZero,
    educationCreditRefundableCents,
    educationCreditNonRefundableCents,
    educationCreditKind,
    educationCreditReasonZero,
  };
}

