import { LATEST_PUBLISHED_YEAR } from "@/lib/tax/constants";

/**
 * The year the spine can actually draw.
 *
 * `taxYearRunway` reads the four federal due dates from the per-year
 * bundles (lib/tax/constants-YYYY.ts) and throws for a year it has none
 * for. Today hands it the user's tax year, which rolls over on 1 January
 * while next year's dates are still unpublished, so on 1 January 2027 the
 * spine would throw and take the page with it.
 *
 * Clamp to the latest published year instead. The spine is a year's shape
 * and its four statutory dates sit within a day of each other year to
 * year, so last year's rail is the honest stand-in until the new dates
 * land, and the panel beside it still names the user's real tax year.
 */
export function spineYearFor(taxYear: number): number {
  return Math.min(taxYear, LATEST_PUBLISHED_YEAR);
}
