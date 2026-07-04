/**
 * Saver's Credit, IRC § 25B.
 *
 * Non-refundable credit for low-/moderate-income filers who contribute
 * to qualifying retirement plans (Traditional or Roth IRA, 401(k),
 * 403(b), 457(b), SEP, SIMPLE, etc.). Worth 10%, 20%, or 50% of up to
 * $2,000 of contributions ($4,000 if MFJ), based on AGI brackets.
 * Maximum credit: $1,000 / $2,000 respectively.
 *
 * "Non-refundable" means it can reduce tax to zero but the IRS won't
 * send the unused portion back. The engine layers it in alongside
 * the family credit + energy/EV credits, all clamped against fed tax.
 *
 * Eligibility (we can only check the ones we have data for; hint the
 * user about the rest):
 *   - Age 18 or older                                 ← we check
 *   - Not a full-time student                         ← can't check, hint
 *   - Not claimed as a dependent on someone else's    ← can't check, hint
 *   - AGI below the filing-status threshold           ← we check
 *
 * 2026 AGI brackets (preliminary - the IRS publishes these alongside
 * the retirement-plan COLAs in early November; verify before tax
 * season). 2025 brackets shown for back-year forecasts.
 *
 *   2026:
 *     Single / MFS / Qualifying widow:
 *       50% if AGI <= $24,000
 *       20% if AGI <= $26,000
 *       10% if AGI <= $40,000
 *       0%  otherwise
 *     Head of household:
 *       50% if AGI <= $36,000
 *       20% if AGI <= $39,000
 *       10% if AGI <= $60,000
 *     MFJ:
 *       50% if AGI <= $48,000
 *       20% if AGI <= $52,000
 *       10% if AGI <= $80,000
 *
 *   2025:
 *     Single / MFS / Qualifying widow:  $23,000 / $25,000 / $39,500
 *     Head of household:                $34,500 / $37,500 / $59,250
 *     MFJ:                              $46,000 / $50,000 / $79,000
 */

import type { FilingStatus } from "../constants-2025";

type SaverBracket = {
  /** AGI cap for the 50% credit. */
  fifty: number;
  /** AGI cap for the 20% credit. */
  twenty: number;
  /** AGI cap for the 10% credit. Above this, no credit. */
  ten: number;
};

const SAVERS_2026: Record<"single" | "hoh" | "joint", SaverBracket> = {
  single: { fifty: 24_000 * 100, twenty: 26_000 * 100, ten: 40_000 * 100 },
  hoh: { fifty: 36_000 * 100, twenty: 39_000 * 100, ten: 60_000 * 100 },
  joint: { fifty: 48_000 * 100, twenty: 52_000 * 100, ten: 80_000 * 100 },
};

const SAVERS_2025: Record<"single" | "hoh" | "joint", SaverBracket> = {
  single: { fifty: 23_000 * 100, twenty: 25_000 * 100, ten: 39_500 * 100 },
  hoh: { fifty: 34_500 * 100, twenty: 37_500 * 100, ten: 59_250 * 100 },
  joint: { fifty: 46_000 * 100, twenty: 50_000 * 100, ten: 79_000 * 100 },
};

function bracketFor(
  year: number,
  filingStatus: FilingStatus,
): SaverBracket {
  const table = year >= 2026 ? SAVERS_2026 : SAVERS_2025;
  if (
    filingStatus === "married_filing_jointly" ||
    filingStatus === "qualifying_widow"
  ) {
    return table.joint;
  }
  if (filingStatus === "head_of_household") return table.hoh;
  // Single and MFS share the single column.
  return table.single;
}

/**
 * Compute the Saver's Credit in cents.
 *
 * retirementContributionsCents - total of Traditional + Roth IRA +
 *   Solo 401(k) + SEP + HSA contributions for the year. Capped at
 *   $2,000 single / $4,000 MFJ before applying the bracket %.
 * agiCents                     - filer's AGI.
 * filingStatus                 - drives the AGI bracket.
 * age                          - must be 18+; we approximate that the
 *   user is an adult when age is null (most onboarding flows set it).
 * taxYear                      - drives the per-year bracket table.
 *
 * Returns 0 with a `reasonZero` when the user is over the AGI
 * threshold, contributed nothing, or appears under 18. The engine
 * surfaces that reason via the Saver's Credit tile so a near-miss
 * filer knows why.
 */
export function computeSaversCreditCents(args: {
  retirementContributionsCents: number;
  agiCents: number;
  filingStatus: FilingStatus;
  age: number | null;
  taxYear: number;
}): {
  creditCents: number;
  rate: 0 | 0.1 | 0.2 | 0.5;
  reasonZero: string | null;
} {
  if (args.retirementContributionsCents <= 0) {
    return {
      creditCents: 0,
      rate: 0,
      reasonZero: null, // no contribution = nothing to credit, no need to nag
    };
  }
  if (args.age !== null && args.age < 18) {
    return {
      creditCents: 0,
      rate: 0,
      reasonZero:
        "Saver's Credit requires the filer to be 18 or older (and not a full-time student or claimed as a dependent).",
    };
  }

  const isJoint =
    args.filingStatus === "married_filing_jointly" ||
    args.filingStatus === "qualifying_widow";
  const contributionCap = isJoint ? 4_000 * 100 : 2_000 * 100;
  const contributionBase = Math.min(
    args.retirementContributionsCents,
    contributionCap,
  );
  const b = bracketFor(args.taxYear, args.filingStatus);
  let rate: 0 | 0.1 | 0.2 | 0.5 = 0;
  if (args.agiCents <= b.fifty) rate = 0.5;
  else if (args.agiCents <= b.twenty) rate = 0.2;
  else if (args.agiCents <= b.ten) rate = 0.1;

  if (rate === 0) {
    return {
      creditCents: 0,
      rate: 0,
      reasonZero: `Saver's Credit phases out at AGI above $${(b.ten / 100).toLocaleString()} for your filing status; you're at $${(args.agiCents / 100).toLocaleString()}.`,
    };
  }

  return {
    creditCents: Math.round(contributionBase * rate),
    rate,
    reasonZero: null,
  };
}
