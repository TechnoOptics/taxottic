/**
 * Parse a marginal-tax-rate query parameter from a shared calculator URL.
 *
 * The calculators put their inputs in the URL so a result can be shared,
 * which also means anyone can type anything into that URL and the page
 * will render it. The rate was being read with a bare
 * `initial?.rate ? parseFloat(initial.rate) : fallback`, so:
 *
 *   ?rate=abc   ->  NaN   ->  "Tax saved: $NaN"
 *   ?rate=5     ->  500%  ->  "Net cost after tax: -$71,280.00"
 *
 * Those are public, indexable, OG-imaged URLs on a product that computes
 * United States tax. A nonsense number rendered confidently is worse
 * than no number, and a NEGATIVE cost is worse still, because it reads
 * like a finding rather than a bug.
 *
 * A rate here is always a fraction of 1 (0.22 is the 22 percent bracket),
 * never a percentage, and never above 100 percent. Anything outside that
 * is not a rate, so the fallback wins rather than the page rendering it.
 */

/** Highest plausible combined marginal rate. Above this is a typo, not a bracket. */
const MAX_RATE = 1;

export function parseRateParam(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = parseFloat(raw);
  // Number.isFinite rejects NaN and both infinities in one check.
  if (!Number.isFinite(n)) return fallback;
  if (n <= 0 || n > MAX_RATE) return fallback;
  return n;
}
