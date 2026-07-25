/**
 * Map a Plaid personal_finance_category.primary value to one of the
 * deduction codes seeded in public.deduction_categories. The mapping
 * is intentionally conservative: when in doubt we point at "office"
 * (a Schedule C catchall) because the user can recategorize from the
 * review queue without breaking forecasts.
 *
 * Returns null for transactions we should NOT auto-apply (transfers
 * between own accounts, personal-care spend, retirement contributions
 * that aren't deductible from business income, etc.). The caller
 * leaves these in the pending review queue so the user can decide.
 *
 * Reference: https://plaid.com/docs/api/products/transactions/#personal_finance_category-taxonomy
 */

const EXPENSE_MAP: Record<string, string | null> = {
  // Definite business expenses
  TRAVEL: "travel",
  TRANSPORTATION: "travel",
  RENT_AND_UTILITIES: "utilities",
  HOME_IMPROVEMENT: "repairs",
  FOOD_AND_DRINK: "meals",
  GENERAL_SERVICES: "legal_pro",
  GENERAL_MERCHANDISE: "office",
  ENTERTAINMENT: "meals",
  BANK_FEES: "office",
  GOVERNMENT_AND_NON_PROFIT: "taxes_licenses",
  // A loan/credit-card payment is mostly PRINCIPAL, which is never
  // deductible; only the interest portion could be, and Plaid doesn't
  // split it. Auto-applying the whole bill as business interest both
  // inflated deductions and (via the card-side inflow) minted phantom
  // income (audit critical #11). Leave in the review queue.
  LOAN_PAYMENTS: null,
  MEDICAL: "benefits",

  // Skip: not a business expense or ambiguous
  PERSONAL_CARE: null,
  TRANSFER_IN: null,
  TRANSFER_OUT: null,
  INCOME: null,
};

export function categorizeExpense(plaidCategory: string | null): string | null {
  if (!plaidCategory) return "office";
  const mapped = EXPENSE_MAP[plaidCategory];
  return mapped === undefined ? "office" : mapped;
}

const INCOME_SOURCE_MAP: Record<string, string | null> = {
  INCOME_WAGES: "wages_w2",
  INCOME_DIVIDENDS: "dividends",
  INCOME_INTEREST_EARNED: "interest",
  INCOME_RETIREMENT_PENSION: "other",
  INCOME_TAX_REFUND: null, // not income
  INCOME_UNEMPLOYMENT: "other",
  INCOME_OTHER_INCOME: "other",
};

/**
 * Map a Plaid personal_finance_category.detailed (or primary) to one
 * of the public.income_source enum values. Returns null when the
 * inflow shouldn't be counted as income at all (e.g. tax refunds,
 * transfers between own accounts).
 *
 * For transactions categorized as TRANSFER_IN we return null - those
 * are user transferring their own money between accounts, not real
 * income. The user can override from the review queue if they're
 * actually external deposits.
 */
export function categorizeIncome(
  plaidPrimaryCategory: string | null,
  plaidDetailedCategory: string | null,
): string | null {
  // Transfers between own accounts are never income.
  if (plaidPrimaryCategory === "TRANSFER_IN") return null;
  // A credit-card/loan payment arriving on the card account is the
  // user's own money moving, not revenue — it used to fall through to
  // the 'sales' default and mint phantom business income.
  if (
    plaidPrimaryCategory === "LOAN_PAYMENTS" ||
    plaidDetailedCategory?.startsWith("LOAN_PAYMENTS")
  ) {
    return null;
  }

  // Try the detailed category first - it's the more specific INCOME_*
  // bucket. Fall back to the primary.
  const candidate = plaidDetailedCategory ?? plaidPrimaryCategory;
  if (!candidate) return "sales";
  const mapped = INCOME_SOURCE_MAP[candidate];
  if (mapped === null) return null;
  if (mapped) return mapped;
  // Unknown detailed code that starts with INCOME_ -> generic
  if (candidate.startsWith("INCOME_")) return "other";
  // Default: treat as business sales income
  return "sales";
}
