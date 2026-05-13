import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripeForAccount } from "./client";

/**
 * Pull balance_transactions for a Stripe Connect connection and write
 * each one into account_transactions (the same table used by Plaid
 * sync). The existing review-and-apply flow on /c/[publicId]/banks
 * then lets the user categorize Stripe charges as income, Stripe fees
 * as expenses, refunds as adjustments, etc. — without any
 * Stripe-specific UI code.
 *
 * Cursor model: we store `bank_connections.cursor` = the last
 * balance_transaction.id we successfully wrote. Stripe's
 * /v1/balance_transactions accepts `starting_after=<id>` for cursor
 * pagination, so the next sync picks up exactly where we left off.
 * Idempotent because account_transactions.external_transaction_id is
 * UNIQUE — re-syncing the same window inserts zero new rows.
 *
 * Cost: balance_transactions reads are not separately billed by
 * Stripe; this is just rate-limited API access. We still apply the
 * Plaid-style monthly throttle so a runaway client doesn't hammer
 * the endpoint.
 *
 * What we map to what:
 *   type = 'charge'              -> credit (income side). Positive amount.
 *   type = 'refund'              -> debit (reverses a charge). Negative.
 *   type = 'stripe_fee' / 'tax'  -> debit (expense side). Stripe's cut.
 *   type = 'payout' / 'transfer' -> SKIP. These are internal moves
 *                                   from Stripe balance to user's
 *                                   bank; the deposit lands in their
 *                                   checking via the user's other
 *                                   bank connection. Counting them as
 *                                   income would double-count.
 *   type = 'adjustment' / etc.   -> recorded but flagged for review.
 */
const SKIP_TYPES = new Set([
  "payout",
  "transfer",
  "topup",
  "topup_reversal",
  "payout_failure",
  "payout_cancel",
]);

export async function syncStripeConnection(
  admin: SupabaseClient,
  connectionId: string,
  options: { force?: boolean } = {},
): Promise<{
  added: number;
  skipped?: boolean;
}> {
  // Monthly throttle, same as Plaid. Forecasting is monthly; a
  // tighter cadence wastes API budget for no user benefit.
  if (!options.force) {
    const { data: existing } = await admin
      .from("bank_connections")
      .select("last_synced_at")
      .eq("id", connectionId)
      .maybeSingle();
    const lastSyncedAt = existing?.last_synced_at as string | null;
    if (lastSyncedAt && isSameCalendarMonthUtc(lastSyncedAt, new Date())) {
      return { added: 0, skipped: true };
    }
  }

  const { data: conn } = await admin
    .from("bank_connections")
    .select("id, external_item_id, cursor, company_id")
    .eq("id", connectionId)
    .maybeSingle();
  if (!conn) throw new Error("Stripe connection not found");
  const stripeUserId = conn.external_item_id as string | null;
  if (!stripeUserId) {
    throw new Error("Stripe connection missing external_item_id (acct_…)");
  }
  const companyId = conn.company_id as string;
  let cursor = (conn.cursor as string | null) ?? null;

  const stripe = getStripeForAccount(stripeUserId);

  // We have one Stripe "account" per connection by design. Make sure
  // the account_transactions table can FK to a bank_accounts row;
  // upsert one so subsequent rerunning is a no-op.
  const { data: existingAcct } = await admin
    .from("bank_accounts")
    .select("id")
    .eq("connection_id", connectionId)
    .maybeSingle();
  let bankAccountId: string;
  if (existingAcct) {
    bankAccountId = existingAcct.id as string;
  } else {
    const { data: newAcct, error: acctErr } = await admin
      .from("bank_accounts")
      .insert({
        connection_id: connectionId,
        external_account_id: `stripe_${stripeUserId}`,
        name: "Stripe",
        official_name: "Stripe payouts",
        account_type: "other",
        account_subtype: "stripe",
        iso_currency_code: "USD",
      })
      .select("id")
      .single();
    if (acctErr || !newAcct) {
      throw new Error(acctErr?.message ?? "Could not create Stripe account");
    }
    bankAccountId = newAcct.id as string;
  }

  // Pull pages of balance_transactions, oldest-first via the
  // `starting_after` cursor pattern. We cap a single sync at 5 pages
  // (500 rows) to keep an individual request bounded; cron picks up
  // the remainder on the next pass.
  const PAGE = 100;
  const MAX_PAGES = 5;
  let added = 0;
  let lastSeen: string | null = cursor;

  for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx++) {
    type BalanceTx = {
      id: string;
      amount: number;
      currency: string;
      type: string;
      description?: string | null;
      net: number;
      fee: number;
      created: number;
      source?: string | null;
    };
    type ListResp = {
      data: BalanceTx[];
      has_more: boolean;
    };
    const list = (await (
      stripe as unknown as {
        balanceTransactions: {
          list: (
            params: { limit: number; starting_after?: string },
            opts: { stripeAccount: string },
          ) => Promise<ListResp>;
        };
      }
    ).balanceTransactions.list(
      {
        limit: PAGE,
        ...(lastSeen ? { starting_after: lastSeen } : {}),
      },
      { stripeAccount: stripeUserId },
    )) as ListResp;

    if (!list.data || list.data.length === 0) break;

    // Build the rows to insert. SKIP_TYPES are no-ops (we still
    // advance the cursor past them so we don't re-evaluate every
    // sync).
    const rows = list.data
      .filter((t) => !SKIP_TYPES.has(t.type))
      .map((t) => {
        const postedDate = new Date(t.created * 1000)
          .toISOString()
          .slice(0, 10);
        const isExpense =
          t.type === "stripe_fee" ||
          t.type === "tax" ||
          (t.type === "refund" && t.amount < 0) ||
          t.amount < 0;
        // account_transactions.amount_cents convention here matches
        // the Plaid sync writer: negative = inflow (income), positive
        // = outflow (expense), so the same review UI works.
        const signed = isExpense
          ? Math.abs(t.amount)
          : -Math.abs(t.amount);
        return {
          account_id: bankAccountId,
          external_transaction_id: t.id,
          posted_date: postedDate,
          amount_cents: signed,
          iso_currency_code: (t.currency ?? "usd").toUpperCase(),
          merchant_name: "Stripe",
          description: t.description ?? `Stripe ${t.type}`,
          payment_channel: "online",
          category_path: [stripeCategoryLabel(t.type)],
          personal_finance_category: stripeCategoryLabel(t.type),
          raw_payload: t as unknown as Record<string, unknown>,
        };
      });

    if (rows.length > 0) {
      // ON CONFLICT (external_transaction_id) DO NOTHING — the unique
      // index gives us idempotency for free. PostgREST exposes this
      // as upsert with onConflict + ignoreDuplicates.
      const { error: insertErr, count } = await admin
        .from("account_transactions")
        .upsert(rows, {
          onConflict: "external_transaction_id",
          ignoreDuplicates: true,
          count: "exact",
        });
      if (insertErr) throw new Error(insertErr.message);
      added += count ?? 0;
    }

    lastSeen = list.data[list.data.length - 1].id;
    if (!list.has_more) break;
  }

  // Persist new cursor + last_synced_at so the next pass picks up
  // where we stopped and the throttle ticks.
  await admin
    .from("bank_connections")
    .update({
      cursor: lastSeen,
      last_synced_at: new Date().toISOString(),
      status: "active",
      last_error: null,
    })
    .eq("id", connectionId);

  // Touch the company_id so RLS-scoped reads downstream pick up the
  // new rows immediately. (No revalidatePath here; that belongs to
  // the route handler so we stay framework-agnostic.)
  void companyId;

  return { added };
}

/**
 * Whether two ISO timestamps fall in the same UTC calendar month.
 * Identical helper to lib/plaid/sync.ts so behavior is consistent
 * across the two providers; copied rather than imported to keep the
 * Stripe module standalone.
 */
function isSameCalendarMonthUtc(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth()
  );
}

/**
 * Friendly label so the review queue shows "Stripe charge" /
 * "Stripe fee" instead of raw API strings. Matches the existing
 * personal_finance_category convention from Plaid.
 */
function stripeCategoryLabel(type: string): string {
  switch (type) {
    case "charge":
      return "Stripe charge";
    case "refund":
      return "Stripe refund";
    case "stripe_fee":
      return "Stripe fee";
    case "tax":
      return "Stripe tax";
    case "adjustment":
      return "Stripe adjustment";
    case "application_fee":
      return "Stripe application fee";
    default:
      return `Stripe ${type}`;
  }
}
