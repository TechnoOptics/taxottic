/**
 * Tier prices, formatted for a reader.
 *
 * Pulled out of app/pricing/page.tsx when the pricing page became one
 * ruled table: the page builds the rows and the table renders them, so
 * both sides needed the same formatter and neither owns it any more.
 *
 * Whole dollars lose the cents ($199, not $199.00) because a column of
 * ".00" is noise in a figure column; anything else keeps both digits.
 * Cents in, string out, no currency lookup: every plan is USD.
 */
export function formatTierPrice(cents: number): string {
  if (cents % 100 === 0) return `$${cents / 100}`;
  return `$${(cents / 100).toFixed(2)}`;
}
