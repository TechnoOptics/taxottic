/**
 * Pay-stub → annual W-2 picture. Pure math, no I/O.
 *
 * Given 1-3 CONSECUTIVE stub reads (lib/ocr/extract-paystub.ts), infer
 * the pay frequency, annualize, and produce the tax-profile patch that
 * drives the personal forecast:
 *
 *   - Box-1-equivalent wages  = gross − pre-tax 401k − §125 health − HSA
 *   - Social-Security wages   = gross − §125 health − HSA
 *     (401k deferrals ARE FICA-taxable; cafeteria-plan health premiums
 *      and payroll HSA are exempt from both income tax and FICA)
 *   - Federal withholding, annualized
 *
 * Annualization basis: when a stub prints YTD figures + a pay date we
 * prefer YTD ÷ elapsed-year-fraction (it bakes in raises, bonuses, and
 * missed checks); otherwise per-period average × periods-per-year.
 */

import type { PaystubRead } from "@/lib/ocr/extract-paystub";

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

export type PaystubAnnualization = {
  frequency: PayFrequency;
  periodsPerYear: number;
  /** "ytd" when YTD figures anchored the math, else "per_period". */
  basis: "ytd" | "per_period";
  annualGrossCents: number;
  /** What Box 1 of the W-2 will roughly show — drives the forecast. */
  annualBox1WagesCents: number;
  annualSsWagesCents: number;
  annualFederalWithheldCents: number;
  annualPretaxRetirementCents: number;
  annualPretaxHealthCents: number;
  annualHsaCents: number;
  warnings: string[];
};

const DAY_MS = 86_400_000;

function daysBetween(aIso: string, bIso: string): number {
  return Math.round(
    (new Date(bIso + "T00:00:00Z").getTime() -
      new Date(aIso + "T00:00:00Z").getTime()) /
      DAY_MS,
  );
}

/** Fraction of the calendar year elapsed at `iso` (pay date), for
 *  YTD-based annualization. Clamped away from 0 so January stubs
 *  can't divide by ~nothing and explode. */
function yearFraction(iso: string): number {
  const d = new Date(iso + "T00:00:00Z");
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const frac = (d.getTime() - start + DAY_MS) / (365.25 * DAY_MS);
  return Math.max(frac, 1 / 26); // ≥ two weeks into the year
}

/** Semimonthly paydays cluster on 1st/15th/16th/EOM. */
function looksSemimonthly(payDates: string[]): boolean {
  const days = payDates.map((d) => Number(d.slice(8, 10)));
  return days.every((day) => day <= 2 || (day >= 14 && day <= 17) || day >= 28);
}

/**
 * Infer the pay frequency, in order of reliability:
 *  1. gaps between consecutive pay dates (2-3 stubs)
 *  2. printed period length (period_start → period_end)
 *  3. YTD ÷ per-period count vs elapsed year fraction (single stub)
 *  4. default biweekly (the most common US schedule) + warning
 */
export function inferPayFrequency(
  stubs: PaystubRead[],
  warnings: string[],
): PayFrequency {
  const payDates = stubs
    .map((s) => s.pay_date)
    .filter((d): d is string => !!d)
    .sort();

  if (payDates.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < payDates.length; i++) {
      gaps.push(daysBetween(payDates[i - 1], payDates[i]));
    }
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avg <= 9) return "weekly";
    if (avg <= 18) {
      // 14ish is ambiguous: biweekly (every other Friday) vs
      // semimonthly (15th + EOM). Day-of-month clustering decides.
      return looksSemimonthly(payDates) ? "semimonthly" : "biweekly";
    }
    return "monthly";
  }

  const withPeriod = stubs.find((s) => s.period_start && s.period_end);
  if (withPeriod) {
    const len =
      daysBetween(withPeriod.period_start!, withPeriod.period_end!) + 1;
    if (len <= 9) return "weekly";
    if (len <= 14) return "biweekly";
    if (len <= 20) return "semimonthly";
    return "monthly";
  }

  const anchor = stubs.find(
    (s) => s.ytd_gross_cents && s.gross_cents && s.pay_date,
  );
  if (anchor) {
    const periodsElapsed = anchor.ytd_gross_cents! / anchor.gross_cents!;
    const perYear = periodsElapsed / yearFraction(anchor.pay_date!);
    const candidates: PayFrequency[] = [
      "weekly",
      "biweekly",
      "semimonthly",
      "monthly",
    ];
    let best: PayFrequency = "biweekly";
    let bestDiff = Infinity;
    for (const c of candidates) {
      const diff = Math.abs(PERIODS_PER_YEAR[c] - perYear);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = c;
      }
    }
    return best;
  }

  warnings.push(
    "Couldn't tell the pay schedule from the stub — assumed biweekly (every two weeks). Correct it below if that's wrong.",
  );
  return "biweekly";
}

function avgOf(
  stubs: PaystubRead[],
  pick: (s: PaystubRead) => number | null,
): number {
  const vals = stubs
    .map(pick)
    .filter((v): v is number => v != null && v >= 0);
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function annualizePaystubs(
  stubs: PaystubRead[],
): PaystubAnnualization {
  if (!stubs.length) {
    throw new Error("No stubs to annualize.");
  }
  const warnings: string[] = [];
  const frequency = inferPayFrequency(stubs, warnings);
  const periodsPerYear = PERIODS_PER_YEAR[frequency];

  const perGross = avgOf(stubs, (s) => s.gross_cents);
  const perFed = avgOf(stubs, (s) => s.federal_withheld_cents);
  const perRetirement = avgOf(stubs, (s) => s.pretax_retirement_cents);
  const perHealth = avgOf(stubs, (s) => s.pretax_health_cents);
  const perHsa = avgOf(stubs, (s) => s.hsa_cents);

  if (perGross <= 0) {
    throw new Error(
      "Couldn't read gross pay from the stub — try a clearer image.",
    );
  }

  // Per-period baseline.
  let annualGross = perGross * periodsPerYear;
  let annualFed = perFed * periodsPerYear;
  let basis: "ytd" | "per_period" = "per_period";

  // YTD anchor (latest stub carrying YTD + a pay date) wins when
  // present: it absorbs raises, bonuses, and unpaid gaps that a single
  // period × N would miss.
  const ytdAnchor = [...stubs]
    .reverse()
    .find((s) => s.ytd_gross_cents != null && s.pay_date);
  if (ytdAnchor) {
    const frac = yearFraction(ytdAnchor.pay_date!);
    const ytdAnnualGross = ytdAnchor.ytd_gross_cents! / frac;
    basis = "ytd";
    if (
      Math.abs(ytdAnnualGross - annualGross) / Math.max(annualGross, 1) >
      0.25
    ) {
      warnings.push(
        "This year's pace (YTD) differs noticeably from the latest paycheck × schedule — the projection uses the YTD pace. A raise, bonus, or job change usually explains it.",
      );
    }
    annualGross = ytdAnnualGross;
    if (ytdAnchor.ytd_federal_withheld_cents != null) {
      annualFed = ytdAnchor.ytd_federal_withheld_cents / frac;
    }
  }

  const annualRetirement = perRetirement * periodsPerYear;
  const annualHealth = perHealth * periodsPerYear;
  const annualHsa = perHsa * periodsPerYear;

  // Box 1 = gross − every pre-tax deduction; SS wages keep 401k in
  // (FICA applies to deferrals) but drop §125 health + payroll HSA.
  const annualBox1 = Math.max(
    0,
    Math.round(annualGross - annualRetirement - annualHealth - annualHsa),
  );
  const annualSs = Math.max(
    0,
    Math.round(annualGross - annualHealth - annualHsa),
  );

  return {
    frequency,
    periodsPerYear,
    basis,
    annualGrossCents: Math.round(annualGross),
    annualBox1WagesCents: annualBox1,
    annualSsWagesCents: annualSs,
    annualFederalWithheldCents: Math.max(0, Math.round(annualFed)),
    annualPretaxRetirementCents: Math.round(annualRetirement),
    annualPretaxHealthCents: Math.round(annualHealth),
    annualHsaCents: Math.round(annualHsa),
    warnings,
  };
}
