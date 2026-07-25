/**
 * Subscription detection + double-count protection for synced /
 * imported transactions.
 *
 * The bug this kills: a user forecasts a subscription by hand (a
 * monthly-recurring income or expense row — the forecast projects it
 * into future months), then a Stripe/bank sync or CSV upload delivers
 * the REAL charge for one of those projected months as a brand-new
 * row. Two rows now cover the same dollars in the same month, and the
 * forecast counts the money twice.
 *
 * Three pure tools, shared by every ingest path (Stripe, Plaid, CSV):
 *
 *  1. isSubscriptionLike(description)     — the line item says it's a
 *     subscription, so mark it monthly at ingest instead of one_off.
 *  2. findCoveringRecurringRow(rows, probe) — is this incoming charge
 *     ALREADY represented by an existing recurring row's projection
 *     for that month? If yes, don't create a second countable row;
 *     link the bank transaction to the covering row instead.
 *  3. chargeFingerprint(...)              — exact-charge identity
 *     (posted date + amount + normalized description) so re-uploads /
 *     re-syncs of the very same charge are recognized as such.
 *
 * Pure functions, no I/O. Callers fetch candidates and persist.
 */

export type Recurrence =
  | "one_off"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "annual"
  | string;

/** "subscription", "subscr.", "subscribe" — the user's rule: if the
 *  line item says subscription, treat it as monthly. Case-insensitive. */
export function isSubscriptionLike(
  description: string | null | undefined,
): boolean {
  if (!description) return false;
  // Any word starting with "subscr": subscription, subscribe, "subscr."
  return /\bsubscr/i.test(description);
}

/** Normalize free-text description into a stable stream token. */
function normalizeDesc(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

/**
 * Fallback recurring_key for subscription-like charges that DIDN'T come
 * through Stripe's subscription-invoice shape (Plaid rows, CSV rows,
 * plain Stripe payments whose description says "subscription"). Keyed on
 * normalized description + whole-dollar amount so the same vendor's
 * monthly charge lands in one stream, and two different subscriptions
 * that happen to share a price stay separate streams.
 */
export function subscriptionFallbackKey(
  description: string,
  amountCents: number,
): string {
  return `sub:${normalizeDesc(description)}|${Math.round(Math.abs(amountCents) / 100)}`;
}

/** Whole-dollar bucket — mirrors lib/banking/recurring.ts so streams
 *  group the same way everywhere. */
function dollarBucket(amountCents: number): number {
  return Math.round(Math.abs(amountCents) / 100);
}

export type CoverCandidate = {
  id: string;
  tax_year: number;
  month: number;
  amount_cents: number;
  recurrence: Recurrence | null;
  recurrence_end_month?: number | null;
  /** Income stream id (Stripe sub_… or sub:… fallback). */
  recurring_key?: string | null;
  /** Expense stream bucket. */
  category_code?: string | null;
};

export type CoverProbe = {
  tax_year: number;
  month: number;
  amount_cents: number;
  /** Incoming charge's stream id, when known. */
  recurring_key?: string | null;
  /** Incoming expense's category. */
  category_code?: string | null;
};

/** Does `row`'s recurrence projection include `month`? Mirrors
 *  lib/tax/recurrence.ts expandRowToMonthly's coverage. */
function projectionCovers(row: CoverCandidate, month: number): boolean {
  if (row.month > month) return false;
  const end = row.recurrence_end_month ?? 12;
  if (month > Math.max(end, row.month)) return false;
  switch (row.recurrence) {
    case "monthly":
    case "weekly": // weekly hits every month from its start
      return true;
    case "quarterly":
      return (month - row.month) % 3 === 0;
    case "annual":
      return month === row.month;
    default:
      return false; // one_off / null never "covers" a future month
  }
}

/**
 * Find an existing recurring row whose projection already accounts for
 * this incoming charge — same tax year, same whole-dollar amount, same
 * stream, projection covering the charge's month.
 *
 * Stream matching:
 *  - Expenses: category_code must match (that's how the recurring
 *    detector groups expense streams).
 *  - Income: if BOTH sides carry a recurring_key and they differ, they
 *    are different subscriptions — never covered. A manual forecast row
 *    has no key, so amount + cadence coverage is the link (exactly the
 *    user's double-count case: hand-forecast $X/mo, then the real $X
 *    subscription charge arrives).
 */
/** Stable key for "this row already absorbed a charge for this month". */
export function coverageKey(rowId: string, month: number): string {
  return `${rowId}:${month}`;
}

export function findCoveringRecurringRow(
  rows: readonly CoverCandidate[],
  probe: CoverProbe,
  /** Coverage keys already used in this sync run. Callers mutate their
   *  own Set after each absorption so one recurring row can't cover two
   *  charges in the same month. */
  consumed?: ReadonlySet<string>,
): CoverCandidate | null {
  const bucket = dollarBucket(probe.amount_cents);
  for (const row of rows) {
    if (row.tax_year !== probe.tax_year) continue;
    if ((row.recurrence ?? "one_off") === "one_off") continue;
    if (dollarBucket(row.amount_cents) !== bucket) continue;
    if (probe.category_code !== undefined || row.category_code != null) {
      // Expense probe: categories must line up.
      if ((row.category_code ?? null) !== (probe.category_code ?? null))
        continue;
    }
    if (
      probe.recurring_key != null &&
      row.recurring_key != null &&
      probe.recurring_key !== row.recurring_key
    )
      continue; // two distinct subscriptions at the same price

    if (!projectionCovers(row, probe.month)) continue;
    // A recurring row projects ONE charge per covered month, so it can
    // absorb at most one charge per month. Without this, a keyless
    // match (amount + month only) let a single row swallow EVERY
    // same-dollar deposit in every covered month, silently deleting
    // real revenue from the forecast (audit #26).
    if (consumed?.has(coverageKey(row.id, probe.month))) continue;
    return row;
  }
  return null;
}

/**
 * Exact-charge identity for "is this the very same charge we already
 * have?" — day-precision posted date + exact cents + normalized
 * description. Used to skip duplicates on CSV re-uploads (Stripe and
 * Plaid already dedupe on their own external transaction ids).
 */
export function chargeFingerprint(
  postedDateIso: string,
  amountCents: number,
  description: string | null | undefined,
): string {
  const day = postedDateIso.slice(0, 10);
  return `${day}|${amountCents}|${description ? normalizeDesc(description) : ""}`;
}
