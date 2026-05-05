/**
 * Year-end suggestions engine.
 *
 * Given a forecast result + the inputs that produced it, surface concrete
 * actions a user can still take to lower their tax bill or stay ahead of
 * the IRS. These are personalized — we only show the move when the user's
 * actual numbers say it'll help, and when possible we attach an estimated
 * dollar impact at their marginal rate.
 *
 * Pure function. The caller renders the result.
 */

import { formatCents, type EntityType, type ForecastResult } from "./forecast";
import {
  STANDARD_DEDUCTION_2025,
  type FilingStatus,
} from "./constants-2025";

export type SuggestionTone = "high" | "medium" | "low";

export type Suggestion = {
  id: string;
  title: string;
  body: string;
  tone: SuggestionTone;
  /** Optional impact estimate (cents). Rendered as "Could save ~$X". */
  estimatedSavingsCents?: number;
  /** Optional CTA — link the user to the page that fixes it. */
  cta?: { label: string; href: string };
};

export type SuggestionInput = {
  result: ForecastResult;
  filingStatus: FilingStatus;
  entityType: EntityType;
  publicId: string;
  // Did the user log retirement contributions this year? Comes from the
  // monthly_expenses bucket where category_code === "retirement_self".
  ytdRetirementContributionsCents: number;
  ytdSelfEmployedHealthCents: number;
  // Business profile flags (null if not set yet).
  hasVehicle: boolean | null;
  vehicleBusinessMiles: number | null;
  vehicleMethod: "standard" | "actual" | null;
  hasHomeOffice: boolean | null;
  homeOfficeSqft: number | null;
  // Tax profile flags.
  itemize: boolean;
  ytdItemizedCents: number;
  // Effective Jan 1 of the tax year, so suggestions know "how much of
  // the year is left." Defaults to the current month if absent.
  currentMonth: number;
};

const SE_ENTITY_TYPES: ReadonlySet<EntityType> = new Set([
  "sole_prop",
  "single_llc",
  "self_employed_1099",
  "multi_llc",
  "partnership",
]);

const SEP_IRA_RATE = 0.2;
const SEP_IRA_CAP_2025 = 7_000_000;

export function buildYearEndSuggestions(
  input: SuggestionInput,
): Suggestion[] {
  const out: Suggestion[] = [];
  const { result } = input;
  const month = clampMonth(input.currentMonth);

  const nextQuarterly = findNextDueQuarterly(result);
  if (nextQuarterly && nextQuarterly.amountCents > 0) {
    const daysUntil = daysFromNowTo(nextQuarterly.dueDate);
    if (daysUntil >= 0 && daysUntil <= 75) {
      out.push({
        id: "next_quarterly",
        title: `Q${nextQuarterly.quarter} estimate due ${prettyDate(nextQuarterly.dueDate)}`,
        body: `Send ~${formatCents(nextQuarterly.amountCents)} to the IRS by ${prettyDate(nextQuarterly.dueDate)} to stay on track for the year. ${daysUntil <= 14 ? "Close to the deadline — pay this week if you can." : `${daysUntil} days to go.`}`,
        tone: daysUntil <= 14 ? "high" : "medium",
      });
    }
  }

  const pastDue = result.quarterlyEstimates.filter(
    (q) => q.isPast && q.amountCents > 0,
  );
  if (pastDue.length > 0 && result.underpaymentRisk) {
    const totalPastDue = pastDue.reduce((a, q) => a + q.amountCents, 0);
    out.push({
      id: "past_due_quarterly",
      title: `Catch up ~${formatCents(totalPastDue)} in missed estimates`,
      body: `Q${pastDue.map((q) => q.quarter).join(", Q")} already passed without an estimate. Sending the catch-up before the next quarterly date trims the underpayment penalty.`,
      tone: "high",
    });
  }

  if (
    result.underpaymentRisk &&
    result.totalTaxCents > 0 &&
    pastDue.length === 0
  ) {
    const shortfall = Math.max(
      0,
      Math.round(result.totalTaxCents * 0.9) - result.alreadyPaidCents,
    );
    out.push({
      id: "underpayment_risk",
      title: `You're ~${formatCents(shortfall)} below the safe-harbor`,
      body: `If withholding + estimates stay where they are, the IRS will assess an underpayment penalty. Either bump your W-4 withholding for the rest of the year or send an estimate before the next quarterly date.`,
      tone: "medium",
    });
  }

  if (
    SE_ENTITY_TYPES.has(input.entityType) &&
    result.projectedNetBusinessIncomeCents >= 1_500_000 &&
    input.ytdRetirementContributionsCents === 0
  ) {
    const sepIraTarget = Math.min(
      Math.round(result.projectedNetBusinessIncomeCents * SEP_IRA_RATE),
      SEP_IRA_CAP_2025,
    );
    const estSavings = Math.round(sepIraTarget * (result.marginalRate || 0.22));
    out.push({
      id: "open_sep_ira",
      title: `Open a SEP-IRA — contribute up to ${formatCents(sepIraTarget)}`,
      body: `On ${formatCents(result.projectedNetBusinessIncomeCents)} of net business income you can stash about 20% in a SEP-IRA. Contributions reduce taxable income dollar-for-dollar. You have until the tax-filing deadline next April to fund it for ${result.quarterlyEstimates[0]?.dueDate.slice(0, 4) ?? "this year"}.`,
      tone: "medium",
      estimatedSavingsCents: estSavings,
      cta: {
        label: "Log a retirement contribution",
        href: `/c/${input.publicId}/expenses?category=retirement_self`,
      },
    });
  }

  if (
    input.hasVehicle &&
    input.vehicleMethod === "standard" &&
    (!input.vehicleBusinessMiles || input.vehicleBusinessMiles < 100)
  ) {
    out.push({
      id: "log_mileage",
      title: "Log your business miles before December 31",
      body: `Standard mileage is $0.70 per business mile this year. Even 5,000 miles is a $3,500 deduction — at your marginal rate that's roughly ${formatCents(Math.round(350_000 * (result.marginalRate || 0.22)))} in saved tax. Update your business profile with year-end miles.`,
      tone: "medium",
      cta: {
        label: "Update business profile",
        href: `/c/${input.publicId}/profile`,
      },
    });
  }

  if (
    input.hasVehicle === null ||
    (input.hasVehicle === true && !input.vehicleMethod)
  ) {
    out.push({
      id: "vehicle_method_set",
      title: "Pick a vehicle deduction method",
      body: "If you drive for the business, you can deduct either standard mileage ($0.70/mile) or actual expenses (gas, insurance, depreciation). Standard is simpler; actual sometimes wins. Set this once and we'll do the rest.",
      tone: "low",
      cta: {
        label: "Update business profile",
        href: `/c/${input.publicId}/profile`,
      },
    });
  }

  if (
    input.hasHomeOffice === null ||
    (input.hasHomeOffice === true &&
      (!input.homeOfficeSqft || input.homeOfficeSqft <= 0))
  ) {
    out.push({
      id: "home_office_setup",
      title: "Claim the home-office deduction",
      body: `If you have a dedicated workspace at home (used regularly + exclusively for the business), the simplified method gives you $5/sq ft up to 300 sq ft — that's a $1,500 deduction with no recordkeeping. Worth ~${formatCents(Math.round(150_000 * (result.marginalRate || 0.22)))} in saved tax at your bracket.`,
      tone: "low",
      cta: {
        label: "Update business profile",
        href: `/c/${input.publicId}/profile`,
      },
    });
  }

  if (
    SE_ENTITY_TYPES.has(input.entityType) &&
    input.ytdSelfEmployedHealthCents === 0 &&
    result.projectedNetBusinessIncomeCents > 0
  ) {
    out.push({
      id: "se_health_premium",
      title: "Deduct your self-employed health-insurance premiums",
      body: "Premiums you pay for yourself, your spouse, and your dependents are deductible above-the-line on Schedule 1 (IRC §162(l)) — they reduce your AGI. Log monthly premiums under \"Self-employed health insurance.\"",
      tone: "low",
      cta: {
        label: "Log a premium",
        href: `/c/${input.publicId}/expenses?category=self_employed_health`,
      },
    });
  }

  if (
    input.itemize &&
    input.ytdItemizedCents > 0 &&
    input.ytdItemizedCents < standardDeductionEstimate(input.filingStatus)
  ) {
    out.push({
      id: "switch_to_standard",
      title: "Switch to the standard deduction",
      body: `Your itemized total is ${formatCents(input.ytdItemizedCents)} but the standard deduction for your filing status is higher. Taking the standard cuts your taxable income by the difference.`,
      tone: "medium",
      cta: {
        label: "Update tax profile",
        href: `/onboarding/tax-profile`,
      },
    });
  }

  if (
    month >= 10 &&
    result.marginalRate >= 0.22 &&
    SE_ENTITY_TYPES.has(input.entityType)
  ) {
    out.push({
      id: "year_end_deferral",
      title: "Push December invoices into January",
      body: `You're projecting ${formatCents(result.totalTaxCents)} in total tax this year. Cash-basis sole props can defer income by waiting to invoice (and accelerate deductions by paying expenses now) — every $1,000 you defer at your bracket saves about ${formatCents(Math.round(100_000 * result.marginalRate))} this year. Only worth it if next year looks similar or smaller.`,
      tone: "low",
    });
  }

  out.sort(toneRank);
  return out;
}

function findNextDueQuarterly(
  result: ForecastResult,
): ForecastResult["quarterlyEstimates"][number] | null {
  const today = Date.now();
  for (const q of result.quarterlyEstimates) {
    const due = new Date(`${q.dueDate}T00:00:00Z`).getTime();
    if (due >= today) return q;
  }
  return null;
}

function daysFromNowTo(iso: string): number {
  const due = new Date(`${iso}T00:00:00Z`).getTime();
  const now = Date.now();
  return Math.round((due - now) / 86_400_000);
}

function prettyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function clampMonth(m: number): number {
  if (!Number.isFinite(m)) return 1;
  return Math.max(1, Math.min(12, Math.round(m)));
}

function toneRank(a: Suggestion, b: Suggestion): number {
  const order: Record<SuggestionTone, number> = { high: 0, medium: 1, low: 2 };
  const cmp = order[a.tone] - order[b.tone];
  if (cmp !== 0) return cmp;
  const aSav = a.estimatedSavingsCents ?? 0;
  const bSav = b.estimatedSavingsCents ?? 0;
  return bSav - aSav;
}

function standardDeductionEstimate(status: FilingStatus): number {
  return STANDARD_DEDUCTION_2025[status] ?? STANDARD_DEDUCTION_2025.single;
}
