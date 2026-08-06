// Detect refund/charge pairs in an import and net them.
//
// User feedback (May 24 2026): "if a user bought 10 items and returned 2,
// bella would see that and based on the timeline, merchant id and number,
// only apply the difference or cancel them out completely and mark it
// as refunded."
//
// Scope of this v1: exact-amount pairs only. A $11.20 Delta charge on
// May 16 and a $11.20 Delta refund on May 19 is a textbook auto-net.
// Partial returns (10 items charged at $25 each, 2 returned at $50)
// would need item-level data we don't have, so they stay in the
// candidates list with a soft hint for the user.
//
// Matching:
//   - same normalized merchant key, FIRST 3 WHITESPACE-SEPARATED
//     TOKENS of the uppercased description. The
//     "DELTA AIR LINES" / "DELTA AIR LINES ATLANTA" pair (same
//     statement, one row carries the city, the other doesn't)
//     wouldn't match with a fixed-length prefix; first-3-tokens
//     handles it cleanly because both share the brand name. Two
//     tokens also worked but matched too loose ("BEST BUY 006114"
//     wanted at least three tokens to stay deterministic).
//   - opposite signs (one positive, one negative)
//   - SAME absolute amount_cents
//   - within MATCH_DAYS of each other
//   - both rows currently untouched (no applied_category_code,
//     no applied_expense_id, not ignored). Auto-netting a row the
//     user already touched would be confusing.
//
// One charge can only pair with one refund, once paired, both are
// removed from the candidate pool so a single $11.20 charge can't
// satisfy two unrelated $11.20 refunds.

import { interpretAmount, type SignConvention } from "./sign-convention";

const MATCH_DAYS = 120; // Most refund windows are 30-90 days; 120 buys slack.
const MERCHANT_KEY_TOKENS = 3;

export type NettableTx = {
  id: string;
  description: string | null;
  amount_cents: number;
  posted_at: string | null;
  applied_category_code: string | null;
  applied_expense_id: string | null;
  applied_income_id: string | null;
  ignored: boolean;
};

export type RefundPair = {
  chargeId: string;
  refundId: string;
  merchant: string;
  amountCents: number;
  daysApart: number;
};

function normalizeMerchant(desc: string | null): string {
  if (!desc) return "";
  return desc
    .toUpperCase()
    .replace(/[#]+/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MERCHANT_KEY_TOKENS)
    .join(" ");
}

function daysBetween(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const ta = Date.parse(a + "T00:00:00Z");
  const tb = Date.parse(b + "T00:00:00Z");
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.abs(ta - tb) / 86_400_000;
}

/**
 * Find refund/charge pairs in the given transaction list. Returns
 * an array of pair descriptors. The caller decides what to do with
 * them (typically: update both rows with ignored=true +
 * applied_category_code='refunded').
 *
 * Pure function, no DB I/O. Easy to unit-test.
 */
export function findRefundPairs(
  txs: NettableTx[],
  convention: SignConvention = "charges_negative",
): RefundPair[] {
  const eligible = txs.filter(
    (t) =>
      !t.ignored &&
      !t.applied_category_code &&
      !t.applied_expense_id &&
      !t.applied_income_id &&
      t.amount_cents !== 0,
  );

  // Group by (merchant, abs amount). For each bucket, walk both
  // sides and pair closest-by-date. A row's direction under the
  // import's convention decides which side it's on: expense goes
  // to charges, refund goes to refunds. Income (a chequing deposit
  // under charges_negative, for example) goes to neither, so it can
  // never pair against a charge.
  type Bucket = { charges: NettableTx[]; refunds: NettableTx[] };
  const buckets = new Map<string, Bucket>();
  for (const t of eligible) {
    const key = `${normalizeMerchant(t.description)}|${Math.abs(t.amount_cents)}`;
    const b = buckets.get(key) ?? { charges: [], refunds: [] };
    const direction = interpretAmount(t.amount_cents, convention).direction;
    if (direction === "expense") b.charges.push(t);
    else if (direction === "refund") b.refunds.push(t);
    buckets.set(key, b);
  }

  const pairs: RefundPair[] = [];
  for (const [key, b] of buckets) {
    if (b.charges.length === 0 || b.refunds.length === 0) continue;
    // Sort by date so we greedily pair closest-in-time first.
    const cs = [...b.charges].sort((a, c) =>
      (a.posted_at ?? "").localeCompare(c.posted_at ?? ""),
    );
    const rs = [...b.refunds].sort((a, c) =>
      (a.posted_at ?? "").localeCompare(c.posted_at ?? ""),
    );
    const usedCharges = new Set<string>();
    for (const refund of rs) {
      // Pick the closest-in-time, still-unused charge within window.
      let bestIdx = -1;
      let bestDays = Infinity;
      for (let i = 0; i < cs.length; i++) {
        const charge = cs[i];
        if (usedCharges.has(charge.id)) continue;
        const days = daysBetween(charge.posted_at, refund.posted_at);
        if (days > MATCH_DAYS) continue;
        if (days < bestDays) {
          bestDays = days;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        const charge = cs[bestIdx];
        usedCharges.add(charge.id);
        const [merchant] = key.split("|");
        pairs.push({
          chargeId: charge.id,
          refundId: refund.id,
          merchant,
          amountCents: Math.abs(refund.amount_cents),
          daysApart: bestDays,
        });
      }
    }
  }
  return pairs;
}
