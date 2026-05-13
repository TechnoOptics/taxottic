/**
 * Earned Income Tax Credit (EITC) — IRC § 32.
 *
 * The EITC is a REFUNDABLE credit for low-/moderate-income working
 * filers, sized by number of qualifying children. It can be sizable:
 * the 2026 maximum is $8,231 for filers with 3+ qualifying children.
 * Because it's refundable, an EITC-eligible filer with zero income
 * tax owed still gets the credit as a refund.
 *
 * 2026 parameters published in Rev. Proc. 2025-32 § 4.06:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │                       Number of qualifying children          │
 *   ├──────────────────────────────┬──────┬──────┬──────────┬──────┤
 *   │ Item                         │ None │ One  │ Two      │ 3+   │
 *   ├──────────────────────────────┼──────┼──────┼──────────┼──────┤
 *   │ Earned-income amount         │ 8,680│13,020│   18,290 │18,290│
 *   │ Maximum credit               │   664│ 4,427│    7,316 │ 8,231│
 *   │ Threshold phaseout (MFJ)     │18,140│31,160│   31,160 │31,160│
 *   │ Completed phaseout (MFJ)     │26,820│58,863│   65,899 │70,244│
 *   │ Threshold phaseout (other)   │10,860│23,890│   23,890 │23,890│
 *   │ Completed phaseout (other)   │19,540│51,593│   58,629 │62,974│
 *   └──────────────────────────────┴──────┴──────┴──────────┴──────┘
 *
 * Plus the investment-income disqualifier: aggregate investment
 * income > $12,200 (2026) zeros the credit entirely (§ 32(i)).
 *
 * Phase-in / plateau / phase-out math:
 *   credit_at_plateau = max_credit
 *   phase_in_value    = min(earned_income, earned_income_amount)
 *                          × (max_credit / earned_income_amount)
 *   phase_out_basis   = max(0, max(earned_income, agi) - threshold)
 *   phase_out_amount  = phase_out_basis × (max_credit / (completed - threshold))
 *   credit            = max(0, phase_in_value - phase_out_amount)
 *
 * Eligibility gates this module does NOT validate (we can't, with the
 * data we have - hint the user instead):
 *   - Valid SSN for filer, spouse (if MFJ), and each qualifying child
 *   - Filer is not a qualifying child of someone else
 *   - For no-children case: filer is between 25 and 64 inclusive
 *   - For no-children case: filer lived in US > half the year
 *   - Each qualifying child must meet the age + relationship +
 *     residency tests (Pub 596 Table 1)
 *   - MFS: only available under § 32(d) separated-spouse rules. We
 *     conservatively return 0 for MFS with an eligibility hint
 *     rather than compute the math.
 *
 * Returns 0 (no credit) when:
 *   - earnedIncome is 0
 *   - investmentIncome > $12,200
 *   - agi (or earned income, whichever is higher) >= completed phaseout
 *   - filingStatus is married_filing_separately
 */

import type { FilingStatus } from "../constants-2025";

type EitcBracket = {
  earnedIncomeAmount: number;
  maxCredit: number;
  thresholdPhaseoutMfj: number;
  completedPhaseoutMfj: number;
  thresholdPhaseoutOther: number;
  completedPhaseoutOther: number;
};

const EITC_2026_BY_KIDS: Record<0 | 1 | 2 | 3, EitcBracket> = {
  0: {
    earnedIncomeAmount: 8_680 * 100,
    maxCredit: 664 * 100,
    thresholdPhaseoutMfj: 18_140 * 100,
    completedPhaseoutMfj: 26_820 * 100,
    thresholdPhaseoutOther: 10_860 * 100,
    completedPhaseoutOther: 19_540 * 100,
  },
  1: {
    earnedIncomeAmount: 13_020 * 100,
    maxCredit: 4_427 * 100,
    thresholdPhaseoutMfj: 31_160 * 100,
    completedPhaseoutMfj: 58_863 * 100,
    thresholdPhaseoutOther: 23_890 * 100,
    completedPhaseoutOther: 51_593 * 100,
  },
  2: {
    earnedIncomeAmount: 18_290 * 100,
    maxCredit: 7_316 * 100,
    thresholdPhaseoutMfj: 31_160 * 100,
    completedPhaseoutMfj: 65_899 * 100,
    thresholdPhaseoutOther: 23_890 * 100,
    completedPhaseoutOther: 58_629 * 100,
  },
  3: {
    earnedIncomeAmount: 18_290 * 100,
    maxCredit: 8_231 * 100,
    thresholdPhaseoutMfj: 31_160 * 100,
    completedPhaseoutMfj: 70_244 * 100,
    thresholdPhaseoutOther: 23_890 * 100,
    completedPhaseoutOther: 62_974 * 100,
  },
};

/** Investment-income disqualifier (§ 32(i)). */
const INVESTMENT_INCOME_DISQUALIFIER_2026_CENTS = 12_200 * 100;

/**
 * 2025 parameters from Rev. Proc. 2024-40 § 4.06. Mirroring the shape
 * so the calculator works for back-year forecasts too. Slightly older
 * caps than 2026.
 */
const EITC_2025_BY_KIDS: Record<0 | 1 | 2 | 3, EitcBracket> = {
  0: {
    earnedIncomeAmount: 8_490 * 100,
    maxCredit: 649 * 100,
    thresholdPhaseoutMfj: 17_730 * 100,
    completedPhaseoutMfj: 26_214 * 100,
    thresholdPhaseoutOther: 10_620 * 100,
    completedPhaseoutOther: 19_104 * 100,
  },
  1: {
    earnedIncomeAmount: 12_730 * 100,
    maxCredit: 4_328 * 100,
    thresholdPhaseoutMfj: 30_470 * 100,
    completedPhaseoutMfj: 57_554 * 100,
    thresholdPhaseoutOther: 23_350 * 100,
    completedPhaseoutOther: 50_434 * 100,
  },
  2: {
    earnedIncomeAmount: 17_880 * 100,
    maxCredit: 7_152 * 100,
    thresholdPhaseoutMfj: 30_470 * 100,
    completedPhaseoutMfj: 64_430 * 100,
    thresholdPhaseoutOther: 23_350 * 100,
    completedPhaseoutOther: 57_310 * 100,
  },
  3: {
    earnedIncomeAmount: 17_880 * 100,
    maxCredit: 8_046 * 100,
    thresholdPhaseoutMfj: 30_470 * 100,
    completedPhaseoutMfj: 68_675 * 100,
    thresholdPhaseoutOther: 23_350 * 100,
    completedPhaseoutOther: 61_555 * 100,
  },
};

const INVESTMENT_INCOME_DISQUALIFIER_2025_CENTS = 11_950 * 100;

function bracketsFor(year: number): {
  byKids: Record<0 | 1 | 2 | 3, EitcBracket>;
  investmentIncomeDisqualifier: number;
} {
  if (year >= 2026) {
    return {
      byKids: EITC_2026_BY_KIDS,
      investmentIncomeDisqualifier: INVESTMENT_INCOME_DISQUALIFIER_2026_CENTS,
    };
  }
  return {
    byKids: EITC_2025_BY_KIDS,
    investmentIncomeDisqualifier: INVESTMENT_INCOME_DISQUALIFIER_2025_CENTS,
  };
}

/**
 * Compute the EITC in cents.
 *
 * earnedIncomeCents - sum of W-2 wages + spouse W-2 wages + net SE
 *                     earnings. Investment income / pension / SS
 *                     are NOT earned income for this purpose.
 * agiCents          - the filer's adjusted gross income (post-
 *                     above-the-line deductions).
 * investmentIncomeCents - interest, dividends, capital gains, passive
 *                     rental. If this exceeds the disqualifier ($12,200
 *                     for 2026) the credit is zero, regardless of
 *                     earned income or AGI.
 * qualifyingChildren - number of children meeting the EITC qualifying-
 *                     child tests. We approximate with
 *                     `dependentsUnder17` from the tax profile; users
 *                     with older students or non-qualifying dependents
 *                     should over-/under-estimate accordingly.
 * filingStatus       - married_filing_separately returns 0 (special-
 *                     rule exceptions exist but require validation we
 *                     can't do).
 */
export function computeEitcCents(args: {
  earnedIncomeCents: number;
  agiCents: number;
  investmentIncomeCents: number;
  qualifyingChildren: number;
  filingStatus: FilingStatus;
  taxYear: number;
}): {
  creditCents: number;
  /**
   * When zero, give the engine a one-line explanation so the UI can
   * surface an honest "you don't qualify because…" instead of silence.
   */
  reasonZero: string | null;
} {
  // MFS is mostly disqualified under § 32, except for separated-
  // spouse rules under § 32(d). We can't validate § 32(d) eligibility
  // without more profile data, so we conservatively return zero and
  // surface a hint at the engine layer.
  if (args.filingStatus === "married_filing_separately") {
    return {
      creditCents: 0,
      reasonZero:
        "EITC isn't available for married-filing-separately filers unless you qualify under the § 32(d) separated-spouse rules. If you live apart from your spouse and meet the conditions, claim it on Form 8862 directly.",
    };
  }

  if (args.earnedIncomeCents <= 0) {
    return { creditCents: 0, reasonZero: "EITC requires earned income (W-2 wages or net SE earnings). You don't have any reported." };
  }

  const tables = bracketsFor(args.taxYear);

  if (args.investmentIncomeCents > tables.investmentIncomeDisqualifier) {
    return {
      creditCents: 0,
      reasonZero: `Your investment income ($${(args.investmentIncomeCents / 100).toLocaleString()}) exceeds the EITC disqualifier of $${(tables.investmentIncomeDisqualifier / 100).toLocaleString()} for ${args.taxYear}. EITC is unavailable under § 32(i).`,
    };
  }

  const kidsKey = Math.min(3, Math.max(0, args.qualifyingChildren)) as
    | 0
    | 1
    | 2
    | 3;
  const b = tables.byKids[kidsKey];
  const isJoint =
    args.filingStatus === "married_filing_jointly" ||
    args.filingStatus === "qualifying_widow";

  // Phase-in: linear up to earned_income_amount, then plateau at max_credit.
  const phaseInRate = b.maxCredit / b.earnedIncomeAmount;
  const phaseInIncome = Math.min(
    args.earnedIncomeCents,
    b.earnedIncomeAmount,
  );
  const phaseInValue = Math.round(phaseInIncome * phaseInRate);

  // Phase-out: starts above the threshold (using max of earned_income
  // and AGI per § 32(a)(2)).
  const threshold = isJoint ? b.thresholdPhaseoutMfj : b.thresholdPhaseoutOther;
  const completed = isJoint ? b.completedPhaseoutMfj : b.completedPhaseoutOther;
  const phaseOutBasis = Math.max(
    args.agiCents - threshold,
    args.earnedIncomeCents - threshold,
  );

  if (phaseOutBasis <= 0) {
    return { creditCents: phaseInValue, reasonZero: null };
  }

  if (
    Math.max(args.agiCents, args.earnedIncomeCents) >= completed
  ) {
    return {
      creditCents: 0,
      reasonZero: `Your AGI / earned income exceeds the EITC completed-phaseout amount for your filing status + ${kidsKey === 3 ? "3+" : kidsKey} qualifying ${kidsKey === 1 ? "child" : "children"}.`,
    };
  }

  const phaseOutRate = b.maxCredit / (completed - threshold);
  const phaseOutAmount = Math.round(phaseOutBasis * phaseOutRate);
  const credit = Math.max(0, phaseInValue - phaseOutAmount);

  return { creditCents: credit, reasonZero: null };
}
