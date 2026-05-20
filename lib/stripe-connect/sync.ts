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
// Internal Stripe accounting events that don't represent real
// economic activity for the user. Every type here is a movement
// inside Stripe's books (or between Stripe and the user's bank) —
// importing them either double-counts revenue or creates
// equal-and-opposite noise pairs in the review queue.
//
// The *_minimum_balance_hold / *_release pair is what tripped the
// May 2026 "why so many duplicates" report: Stripe parks part of
// the balance overnight as a buffer and releases it the next day,
// so every hold has a matching release at the exact same magnitude.
// Net effect on revenue: zero. Tax effect: zero. Importing them
// just polluted the review queue with fake "Schedule C expense"
// rows + matching "inflow" rows. Skip.
const SKIP_TYPES = new Set([
  "payout",
  "transfer",
  "topup",
  "topup_reversal",
  "payout_failure",
  "payout_cancel",
  "payout_minimum_balance_hold",
  "payout_minimum_balance_release",
]);

export async function syncStripeConnection(
  admin: SupabaseClient,
  connectionId: string,
  options: { force?: boolean } = {},
): Promise<{
  added: number;
  skipped?: boolean;
  appliedIncome?: number;
  appliedExpense?: number;
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
    .select("id, external_item_id, cursor, company_id, deleted_at, created_by")
    .eq("id", connectionId)
    .maybeSingle();
  if (!conn) throw new Error("Stripe connection not found");
  // Refuse to sync a soft-deleted connection. Without this guard a
  // stray sync click (or a cron) after Disconnect re-set
  // status="active" on the row, leaving a zombie connection that the
  // consumer page hid (deleted_at filter) but other surfaces still
  // counted. The disconnect is the canonical signal of intent —
  // honour it across every sync pathway.
  if (conn.deleted_at) {
    return { added: 0, skipped: true };
  }
  const stripeUserId = conn.external_item_id as string | null;
  if (!stripeUserId) {
    throw new Error("Stripe connection missing external_item_id (acct_…)");
  }
  const companyId = conn.company_id as string;
  const userId = (conn.created_by as string | null) ?? null;
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
  // Only import transactions from the current calendar year — anything
  // older would never roll into THIS year's forecast and is pure noise
  // in the review queue. The cutoff slides automatically each Jan 1.
  const yearStartUnix = Math.floor(
    Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000,
  );

  for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx++) {
    type ExpandedSource = {
      // Common shape across charge / payment / refund:
      description?: string | null;
      billing_details?: {
        name?: string | null;
        email?: string | null;
      } | null;
      statement_descriptor?: string | null;
      customer?: string | null;
      metadata?: Record<string, string> | null;
    } | null;
    type BalanceTx = {
      id: string;
      amount: number;
      currency: string;
      type: string;
      description?: string | null;
      net: number;
      fee: number;
      created: number;
      // With `expand: ["data.source"]` Stripe inflates this from a
      // bare id string into the full source object (charge, payment,
      // refund, etc.). Tax allocation needs the description + the
      // customer/billing details, not just "Stripe charge".
      source?: ExpandedSource | string | null;
    };
    type ListResp = {
      data: BalanceTx[];
      has_more: boolean;
    };
    const list = (await (
      stripe as unknown as {
        balanceTransactions: {
          list: (
            params: {
              limit: number;
              starting_after?: string;
              expand?: string[];
              created?: { gte?: number };
            },
            opts: { stripeAccount: string },
          ) => Promise<ListResp>;
        };
      }
    ).balanceTransactions.list(
      {
        limit: PAGE,
        expand: ["data.source"],
        // Server-side cutoff at Jan 1 (UTC) of the current year.
        created: { gte: yearStartUnix },
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
        // Pull the underlying charge/payment/refund object so the
        // description shows WHO this was rather than the bare
        // "Stripe charge". Falls back gracefully when source isn't
        // expanded (e.g. balance-only adjustments).
        const src =
          t.source && typeof t.source === "object"
            ? (t.source as ExpandedSource)
            : null;
        return {
          account_id: bankAccountId,
          external_transaction_id: t.id,
          posted_date: postedDate,
          amount_cents: signed,
          iso_currency_code: (t.currency ?? "usd").toUpperCase(),
          merchant_name: src?.billing_details?.name ?? "Stripe",
          description: enrichedDescription(t, src),
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

  // Auto-apply pass — bring Stripe into parity with the Plaid sync.
  // Without this, charge/payment rows sit in account_transactions
  // forever with user_action=null and the user's income page +
  // forecast show NOTHING. Mirror the Plaid pattern: for every
  // still-pending Stripe row under this connection, insert a
  // monthly_income / monthly_expenses row and flip user_action to
  // "applied". Refunds + adjustments stay pending for human review.
  const autoApplied = userId
    ? await autoApplyPendingStripe({
        admin,
        bankAccountId,
        companyId,
        userId,
      })
    : { income: 0, expense: 0 };

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

  return {
    added,
    appliedIncome: autoApplied.income,
    appliedExpense: autoApplied.expense,
  };
}

/**
 * Build a human-useful description for a Stripe balance_transaction,
 * preferring fields from its expanded source (the underlying charge
 * / payment / refund) over the bare "Stripe charge" label. This is
 * what shows up on the Recent transactions list AND what Bella's
 * matcher looks at, so the merchant/customer string matters for
 * deduction allocation, not just UX.
 */
function enrichedDescription(
  t: { type: string; description?: string | null },
  src: {
    description?: string | null;
    billing_details?: { name?: string | null; email?: string | null } | null;
    statement_descriptor?: string | null;
  } | null,
): string {
  const head = `Stripe ${t.type}`;
  if (src) {
    if (src.description && src.description.trim()) {
      return `${head} · ${src.description.trim()}`;
    }
    if (src.billing_details?.name && src.billing_details.name.trim()) {
      return `${head} · ${src.billing_details.name.trim()}`;
    }
    if (src.billing_details?.email && src.billing_details.email.trim()) {
      return `${head} · ${src.billing_details.email.trim()}`;
    }
    if (
      src.statement_descriptor &&
      src.statement_descriptor.trim()
    ) {
      return `${head} · ${src.statement_descriptor.trim()}`;
    }
  }
  if (t.description && t.description.trim()) {
    return `${head} · ${t.description.trim()}`;
  }
  return head;
}

/**
 * After a sync writes raw balance_transactions into
 * account_transactions, this pass routes them into the same
 * monthly_income / monthly_expenses tables the Plaid sync feeds —
 * so the income page and the forecast actually reflect the data.
 *
 * Mapping (mirrors lib/plaid/sync.ts's auto-apply behaviour):
 *   type=charge | payment   (inflow)   → monthly_income (source="sales")
 *   type=stripe_fee         (outflow)  → monthly_expenses (code T048 — "Stripe fees")
 *   type=refund | adjustment / other   → leave pending for human review
 *
 * We only touch rows still in user_action='pending', so re-runs are
 * idempotent. Includes existing pending rows from older syncs, not
 * just freshly-inserted ones — that means a single sync click after
 * deploying this feature back-fills everything that was sitting
 * un-applied.
 */
async function autoApplyPendingStripe(args: {
  admin: SupabaseClient;
  bankAccountId: string;
  companyId: string;
  userId: string;
}): Promise<{ income: number; expense: number }> {
  const { admin, bankAccountId, companyId, userId } = args;

  const { data: pending } = await admin
    .from("account_transactions")
    .select("id, posted_date, amount_cents, raw_payload")
    .eq("account_id", bankAccountId)
    .eq("user_action", "pending")
    .limit(500);

  let income = 0;
  let expense = 0;

  for (const tx of pending ?? []) {
    const raw = (tx.raw_payload ?? {}) as Record<string, unknown>;
    const type = String(raw.type ?? "");
    const cents = tx.amount_cents as number;
    const posted = new Date(String(tx.posted_date ?? ""));
    if (Number.isNaN(posted.getTime())) continue;
    const taxYear = posted.getUTCFullYear();
    const month = posted.getUTCMonth() + 1;

    // Inflow → income. account_transactions.amount_cents uses
    // negative=inflow (positive=expense) per the Plaid convention.
    if ((type === "charge" || type === "payment") && cents < 0) {
      const { data: row } = await admin
        .from("monthly_income")
        .insert({
          company_id: companyId,
          user_id: userId,
          tax_year: taxYear,
          month,
          amount_cents: Math.abs(cents),
          source: "sales",
          notes: "Auto-imported from Stripe",
        })
        .select("id")
        .maybeSingle();
      if (row) {
        await admin
          .from("account_transactions")
          .update({
            user_action: "applied",
            applied_to_income_id: row.id,
            applied_at: new Date().toISOString(),
            applied_by: userId,
          })
          .eq("id", tx.id);
        income++;
      }
    } else if (type === "stripe_fee" && cents > 0) {
      // Outflow → expense. T048 is the Stripe-fees deduction code
      // in lib/deductions/master.ts (Website/SaaS/digital tools).
      const { data: row } = await admin
        .from("monthly_expenses")
        .insert({
          company_id: companyId,
          user_id: userId,
          tax_year: taxYear,
          month,
          amount_cents: cents,
          category_code: "T048",
          notes: "Auto-imported from Stripe",
        })
        .select("id")
        .maybeSingle();
      if (row) {
        await admin
          .from("account_transactions")
          .update({
            user_action: "applied",
            applied_to_expense_id: row.id,
            applied_at: new Date().toISOString(),
            applied_by: userId,
          })
          .eq("id", tx.id);
        expense++;
      }
    }
    // refund / adjustment / application_fee / etc. → keep pending so
    // the user can categorise them in the Recent transactions UI.
  }

  return { income, expense };
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
