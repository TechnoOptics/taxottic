// Currency + rounding utilities for the forecast engine. Extracted from
// forecast.ts so the money-formatting concerns live apart from the tax math.

/** Consistent integer-cents rounding used throughout the engine. */
export function round(n: number): number {
  return Math.round(n);
}

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

// Upper bound on a single entered amount. JS integers are exact only below
// ~9e15, so an absurd input (e.g. "9999999999999999") would lose precision
// once converted to cents and later render as "$NaN" / corrupt the forecast.
// $1T is orders of magnitude beyond any real small-business figure and keeps
// amount_cents safely exact. Callers treat null as "invalid input".
const MAX_ENTRY_DOLLARS = 1_000_000_000_000;

export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0 || n > MAX_ENTRY_DOLLARS) return null;
  return Math.round(n * 100);
}
