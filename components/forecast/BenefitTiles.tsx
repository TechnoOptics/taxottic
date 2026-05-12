import { formatCents, type ForecastResult } from "@/lib/tax/forecast";

/**
 * Tiles that render the new forecast outputs the gap-audit work
 * added: AMT add-on, qualified-gains separate tax, retirement
 * savings tracker + personalized recommendation, foreign-earned
 * exclusion, student-loan deduction, and the W-4 nudge.
 *
 * Each tile renders nothing when the underlying value is zero, so
 * dropping them into a forecast page is safe regardless of which
 * benefits a given user has triggered.
 *
 * Components are deliberately small and presentational - all the
 * tax logic lives in the engine and arrives as ForecastResult
 * fields, so a copy change here doesn't risk re-deriving math.
 */

type Props = { result: ForecastResult };

/**
 * Retirement savings tile - rendered whenever the user has
 * contributed something to a deductible retirement bucket. Shows
 * the marginal-rate value of their contribution so they see the
 * payoff of what they've already done.
 */
export function RetirementSavingsTile({ result }: Props) {
  if (result.retirementTaxSavingsCents <= 0) return null;
  return (
    <div className="card p-6 sm:p-7 border-emerald-200/60 bg-emerald-50/40">
      <div className="text-[10px] uppercase tracking-[0.32em] text-emerald-800 font-medium">
        Retirement — you're saving
      </div>
      <h3 className="display mt-1.5 text-2xl text-forest-900">
        {formatCents(result.retirementTaxSavingsCents)} in federal tax
      </h3>
      <p className="mt-2 text-sm text-ink-soft leading-relaxed">
        You contributed{" "}
        <strong className="text-forest-900">
          {formatCents(result.retirementContributionTotalCents)}
        </strong>{" "}
        across your retirement accounts this year. The deductible
        portion lowered your taxable income enough to save about{" "}
        <strong className="text-forest-900">
          {formatCents(result.retirementTaxSavingsCents)}
        </strong>{" "}
        in federal tax at your marginal rate. Roth contributions
        don&apos;t deduct now but still grow tax-free — they
        don&apos;t show up in this savings number.
      </p>
    </div>
  );
}

/**
 * Personalized retirement recommendation. The engine picks the
 * highest-headroom deductible bucket and computes the marginal-rate
 * value of filling more of it. We render the tile when there's a
 * real bucket to fill - "none" means the user is already maxed or
 * has no taxable income left to shelter, and we omit the tile
 * rather than show a no-op.
 */
export function RetirementRecommendationTile({ result }: Props) {
  if (
    result.retirementRecommendation.bucket === "none" ||
    result.retirementRecommendation.addCents <= 0 ||
    result.retirementRecommendation.taxSavingsCents <= 0
  ) {
    return null;
  }
  return (
    <div className="card p-6 sm:p-7 border-gold-300/70 bg-gold-50/30">
      <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
        Want to save more this year?
      </div>
      <h3 className="display mt-1.5 text-2xl text-forest-900">
        Contribute {formatCents(result.retirementRecommendation.addCents)},
        save {formatCents(result.retirementRecommendation.taxSavingsCents)}
      </h3>
      <p className="mt-2 text-sm text-ink-soft leading-relaxed">
        {result.retirementRecommendation.summary}
      </p>
      <p className="mt-3 text-[11px] text-ink-muted italic leading-relaxed">
        Numbers are best-case assuming you make the contribution before
        the deadline (April 15 of next year for IRA / SEP; the same year
        for Solo 401(k) employee deferrals, with employer profit-sharing
        until your tax-filing deadline). The deduction is capped by your
        taxable income; we&apos;ve already clamped the recommendation
        to what will actually move the needle.
      </p>
    </div>
  );
}

/**
 * AMT add-on tile - only renders when the engine determined the
 * Alternative Minimum Tax (§ 55) exceeded the regular tax.
 */
export function AmtTile({ result }: Props) {
  if (result.amtAddOnCents <= 0) return null;
  return (
    <div className="card p-5 border-red-200/60 bg-red-50/40">
      <div className="text-[10px] uppercase tracking-[0.32em] text-red-800 font-medium">
        AMT add-on
      </div>
      <div className="display mt-1 text-xl text-forest-900">
        {formatCents(result.amtAddOnCents)}
      </div>
      <p className="mt-2 text-xs text-ink-soft leading-relaxed">
        Your Alternative Minimum Tax (§ 55) is higher than your regular
        tax this year, so the AMT amount applies instead. Common
        triggers: large long-term capital gains stacked on high
        ordinary income, or sizable state-and-local + miscellaneous
        itemized deductions hitting the SALT cap. Confirm on Form 6251.
      </p>
    </div>
  );
}

/**
 * Qualified-gains tile - shows the dollar amount of LTCG + qualified
 * dividends taxed at the preferential 0/15/20% brackets, so the user
 * understands why their effective rate on those gains looks lower
 * than their marginal rate on ordinary income.
 */
export function CapitalGainsTile({ result }: Props) {
  if (result.capitalGainsTaxCents <= 0) return null;
  return (
    <div className="card p-5">
      <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
        Qualified gains tax
      </div>
      <div className="display mt-1 text-xl text-forest-900">
        {formatCents(result.capitalGainsTaxCents)}
      </div>
      <p className="mt-2 text-xs text-ink-soft leading-relaxed">
        Long-term capital gains + qualified dividends are taxed at
        preferential 0% / 15% / 20% brackets rather than ordinary
        rates. We&apos;ve stacked them on top of your ordinary income
        so the right slice falls in each bracket.
      </p>
    </div>
  );
}

/**
 * Foreign-earned-income exclusion tile - shows the amount excluded
 * under § 911 so the user can confirm we got it right.
 */
export function ForeignExclusionTile({ result }: Props) {
  if (result.foreignEarnedIncomeExcludedCents <= 0) return null;
  return (
    <div className="card p-5">
      <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
        Foreign earned income excluded
      </div>
      <div className="display mt-1 text-xl text-forest-900">
        {formatCents(result.foreignEarnedIncomeExcludedCents)}
      </div>
      <p className="mt-2 text-xs text-ink-soft leading-relaxed">
        § 911 exclusion applied. Requires the bona-fide-residence or
        physical-presence test (330 days in a qualifying 12-month
        window). Filed on Form 2555.
      </p>
    </div>
  );
}

/**
 * Student-loan-interest deduction tile.
 */
export function StudentLoanInterestTile({ result }: Props) {
  if (result.studentLoanInterestDeductionCents <= 0) return null;
  return (
    <div className="card p-5">
      <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
        Student loan interest deduction
      </div>
      <div className="display mt-1 text-xl text-forest-900">
        {formatCents(result.studentLoanInterestDeductionCents)}
      </div>
      <p className="mt-2 text-xs text-ink-soft leading-relaxed">
        § 221 deduction applied above-the-line (capped at $2,500 and
        phased out by AGI). Helps even if you don&apos;t itemize.
      </p>
    </div>
  );
}

/**
 * Earned Income Tax Credit tile - the credit is refundable, so this
 * is often the most consequential single line for an eligible filer.
 * Renders the dollar amount when the engine computed a nonzero credit,
 * or a friendly explanation when the user looks close to eligibility
 * but didn't quite make it (e.g., investment income over the
 * disqualifier, or MFS without § 32(d)).
 */
export function EitcTile({ result }: Props) {
  if (result.eitcCents > 0) {
    return (
      <div className="card p-6 sm:p-7 border-emerald-200/60 bg-emerald-50/40">
        <div className="text-[10px] uppercase tracking-[0.32em] text-emerald-800 font-medium">
          Earned Income Tax Credit
        </div>
        <h3 className="display mt-1.5 text-2xl text-forest-900">
          {formatCents(result.eitcCents)} refundable
        </h3>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed">
          The EITC (IRC § 32) is a refundable credit for working
          filers - it reduces your tax owed dollar-for-dollar, and if
          the credit exceeds your tax, the IRS sends you the
          difference as a cash refund. This forecast assumes your
          dependents meet the qualifying-child tests; confirm against
          IRS Pub 596 Table 1.
        </p>
      </div>
    );
  }
  // No credit but a worth-explaining reason - surface the engine's
  // copy so a near-miss user understands what would unlock it.
  if (result.eitcReasonZero) {
    return (
      <div className="card p-5 border-forest-100 bg-cream/40">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          EITC eligibility note
        </div>
        <p className="mt-2 text-xs text-ink-soft leading-relaxed">
          {result.eitcReasonZero}
        </p>
      </div>
    );
  }
  return null;
}

/**
 * Saver's Credit tile (§ 25B). Non-refundable, but still meaningful
 * for filers whose retirement contributions and AGI both land it in
 * an eligible bracket - up to a $1,000 / $2,000 reduction in fed tax.
 * Renders an active credit when the engine computed one, or a
 * "why zero" note when there's an actionable reason.
 */
export function SaversCreditTile({ result }: Props) {
  if (result.saversCreditCents > 0) {
    return (
      <div className="card p-5 bg-cream/40 border-forest-100">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          Saver&apos;s Credit
        </div>
        <div className="display mt-1 text-xl text-forest-900">
          {formatCents(result.saversCreditCents)}
        </div>
        <p className="mt-2 text-xs text-ink-soft leading-relaxed">
          You&apos;re in the{" "}
          <strong className="text-forest-900">
            {Math.round(result.saversCreditRate * 100)}% bracket
          </strong>{" "}
          for the Saver&apos;s Credit (IRC § 25B). Non-refundable —
          reduces your fed tax dollar-for-dollar but the unused
          portion isn&apos;t refundable. Claim on Form 8880. Requires
          you to be 18+, not a full-time student, and not claimed as
          a dependent.
        </p>
      </div>
    );
  }
  if (result.saversCreditReasonZero) {
    return (
      <div className="card p-5 bg-cream/40 border-forest-100">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          Saver&apos;s Credit note
        </div>
        <p className="mt-2 text-xs text-ink-soft leading-relaxed">
          {result.saversCreditReasonZero}
        </p>
      </div>
    );
  }
  return null;
}

/**
 * W-4 nudge tile - actionable copy for W-2 filers who are either
 * substantially over- or under-withholding. SE-only filers get
 * direction="ok" from the engine and the tile renders nothing.
 */
export function W4NudgeTile({ result }: Props) {
  if (result.w4Recommendation.direction === "ok") return null;
  const isIncrease = result.w4Recommendation.direction === "increase";
  return (
    <div
      className={
        "card p-6 sm:p-7 " +
        (isIncrease
          ? "border-amber-200/60 bg-amber-50/40"
          : "border-emerald-200/60 bg-emerald-50/40")
      }
    >
      <div
        className={
          "text-[10px] uppercase tracking-[0.32em] font-medium " +
          (isIncrease ? "text-amber-800" : "text-emerald-800")
        }
      >
        W-4 nudge
      </div>
      <h3 className="display mt-1.5 text-xl text-forest-900">
        {isIncrease
          ? `Add ${formatCents(result.w4Recommendation.perPaycheckDeltaCents)} per paycheck to your withholding`
          : `Drop your withholding by ${formatCents(result.w4Recommendation.perPaycheckDeltaCents)} per paycheck`}
      </h3>
      <p className="mt-2 text-sm text-ink-soft leading-relaxed">
        {isIncrease ? (
          <>
            You&apos;re currently projecting to owe{" "}
            <strong className="text-forest-900">
              {formatCents(result.w4Recommendation.annualDeltaCents)}
            </strong>{" "}
            at filing. Adding{" "}
            <strong className="text-forest-900">
              {formatCents(result.w4Recommendation.perPaycheckDeltaCents)}
            </strong>{" "}
            to box 4(c) of Form W-4 (extra withholding) for each
            remaining bi-weekly paycheck lands you near zero next
            April.
          </>
        ) : (
          <>
            You&apos;re projecting a{" "}
            <strong className="text-forest-900">
              {formatCents(result.w4Recommendation.annualDeltaCents)}
            </strong>{" "}
            refund — that&apos;s your money the IRS is holding without
            interest. Reducing withholding by about{" "}
            <strong className="text-forest-900">
              {formatCents(result.w4Recommendation.perPaycheckDeltaCents)}
            </strong>{" "}
            per paycheck gets the cash flowing through your year
            instead of waiting for April. Adjust dependents on Form
            W-4 step 3, or zero out box 4(c) if you&apos;ve added
            extra withholding before.
          </>
        )}
      </p>
    </div>
  );
}
