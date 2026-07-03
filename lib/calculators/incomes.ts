import { forecast } from "@/lib/tax/forecast";
import { neutralForecastInput, toCents } from "./base-input";

/**
 * Data for the programmatic "self-employment tax on $X" pages. Each page
 * answers a specific, high-volume query ("how much is self-employment
 * tax on 100k") with a REAL computed breakdown from the same forecast
 * engine as the calculators — so every page carries a unique, accurate
 * number rather than a templated shell.
 *
 * These are the national/federal baseline (no state), because the search
 * intent for "self-employment tax on $X" is almost always the universal
 * federal figure; the per-state nuance lives on the [state] pages, and
 * the embedded calculator lets a visitor add their state.
 */

const TAX_YEAR = 2026;

// Curated breakpoints a real self-employed person actually searches for —
// round numbers spanning side-hustle to high-earner. Kept deliberately
// finite (and dynamicParams=false on the route) so we generate a bounded
// set of substantive pages rather than an unbounded doorway-page farm.
export const CALC_INCOMES = [
  20000, 25000, 30000, 40000, 50000, 60000, 70000, 75000, 80000, 90000,
  100000, 120000, 150000, 175000, 200000, 250000,
];

const INCOME_SET = new Set(CALC_INCOMES);

export function isCalcIncome(n: number): boolean {
  return Number.isInteger(n) && INCOME_SET.has(n);
}

/** "100000" -> 100000, validated against the curated set (else null). */
export function parseIncomeSlug(slug: string): number | null {
  if (!/^\d+$/.test(slug)) return null;
  const n = Number(slug);
  return isCalcIncome(n) ? n : null;
}

/** $100,000 — for headings/copy. No cents; these are round figures. */
export function formatDollars(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export type IncomeSnapshot = {
  gross: number;
  totalTaxCents: number;
  selfEmploymentTaxCents: number;
  federalIncomeTaxCents: number;
  qbiDeductionCents: number;
  effectiveRate: number;
  afterTaxCents: number;
  /** The next unpaid quarterly estimate (falls back to total/4). */
  quarterlyCents: number;
  /** Share of gross to set aside for taxes, as a fraction. */
  setAsideFraction: number;
};

export function incomeSnapshot(gross: number): IncomeSnapshot {
  const cents = toCents(gross);
  const r = forecast({
    ...neutralForecastInput(TAX_YEAR, "single"),
    stateCode: null,
    ytdIncomeCents: cents,
  });
  const nextQ = r.quarterlyEstimates.find(
    (q) => !q.isPast && q.amountCents > 0,
  );
  return {
    gross,
    totalTaxCents: r.totalTaxCents,
    selfEmploymentTaxCents: r.selfEmploymentTaxCents,
    federalIncomeTaxCents: r.federalIncomeTaxCents,
    qbiDeductionCents: r.qbiDeductionCents,
    effectiveRate: cents > 0 ? r.totalTaxCents / cents : 0,
    afterTaxCents: cents - r.totalTaxCents,
    quarterlyCents: nextQ?.amountCents ?? Math.round(r.totalTaxCents / 4),
    setAsideFraction: cents > 0 ? r.totalTaxCents / cents : 0,
  };
}
