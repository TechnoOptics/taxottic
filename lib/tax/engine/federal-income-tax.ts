import type { FilingStatus } from "../constants-2025";
import type { TaxYearConstants } from "../constants";
import type { ForecastInput } from "../forecast";

// Federal income-tax math: standard deduction, bracket tax, marginal rate.
// Extracted from forecast.ts; forecast() orchestrates these.

export function computeStandardDeduction(
  input: ForecastInput,
  k: TaxYearConstants,
): number {
  let base = k.STANDARD_DEDUCTION[input.filingStatus];
  const isMarried =
    input.filingStatus === "married_filing_jointly" ||
    input.filingStatus === "married_filing_separately" ||
    input.filingStatus === "qualifying_widow";
  const additional = isMarried
    ? k.ADDITIONAL_STD_DEDUCTION.married
    : k.ADDITIONAL_STD_DEDUCTION.single;
  if (input.age !== null && input.age >= 65) base += additional;
  if (input.isBlind) base += additional;
  return base;
}

export function computeFederalIncomeTax(
  taxableIncomeCents: number,
  filingStatus: FilingStatus,
  k: TaxYearConstants,
): number {
  const brackets = k.FEDERAL_BRACKETS[filingStatus];
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

export function marginalFederalRate(
  taxableIncomeCents: number,
  filingStatus: FilingStatus,
  k: TaxYearConstants,
): number {
  const brackets = k.FEDERAL_BRACKETS[filingStatus];
  for (const b of brackets) {
    if (b.upTo === null || taxableIncomeCents < b.upTo) return b.rate;
  }
  return brackets[brackets.length - 1].rate;
}
