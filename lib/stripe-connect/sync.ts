import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripeForAccount } from "./client";
import {
  applyRecurringExpenseDetection,
  applyRecurringIncomeDetection,
} from "@/lib/banking/recurring";
import {
  claimPendingTransaction,
  releasePendingTransaction,
} from "@/lib/banking/claim";

/**
 * Pull balance_transactions for a Stripe Connect connection and write
 * each one into account_transactions (the same table used by Plaid
 * sync). The existing review-and-apply flow on /c/[publicId]/banks
 * then lets the user categorize Stripe charges as income, Stripe fees
 * as expenses, refunds as adjustments, etc., without any
 * Stripe-specific UI code.
 *
 * Cursor model: we store `bank_connections.cursor` = the last
 * balance_transaction.id we successfully wrote. Stripe's
 * /v1/balance_transactions accepts `starting_after=<id>` for cursor
 * pagination, so the next sync picks up exactly where we left off.
 * Idempotent because account_transactions.external_transaction_id is
 * UNIQUE, re-syncing the same window inserts zero new rows.
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
// inside Stripe's books (or between Stripe and the user's bank) -
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
  // counted. The disconnect is the canonical signal of intent -
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
  const cursor = (conn.cursor as string | null) ?? null;

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
  // One-shot recovery: if Stripe rejects the stored cursor, we re-list
  // once from the year start (see the catch in the loop below).
  let retriedWithoutCursor = false;
  // Only import transactions from the current calendar year, anything
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
    // When paginating from a stored cursor, let `starting_after` bound
    // the window and DON'T also send `created`. Stripe rejects the
    // `created` + `starting_after` combination for some connected
    // accounts with a 400, which wedged every incremental sync (cron,
    // manual, and the realtime webhook) and left the connection stuck
    // at status=error pulling nothing. The Jan-1 cutoff is only needed
    // for the initial, cursor-less pull (to avoid importing last year).
    const listParams: {
      limit: number;
      starting_after?: string;
      expand?: string[];
      created?: { gte?: number };
    } = lastSeen
      ? {
          limit: PAGE,
          // data.source.invoice: lets us see whether a charge came from
          // a subscription invoice (recurring revenue) vs a one-off
          // payment, so the auto-apply can set recurrence (see
          // subscriptionRecurrence) and the forecast projects it.
          expand: ["data.source", "data.source.invoice"],
          starting_after: lastSeen,
        }
      : {
          limit: PAGE,
          expand: ["data.source", "data.source.invoice"],
          created: { gte: yearStartUnix },
        };

    const listClient = stripe as unknown as {
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
    };

    let list: ListResp;
    try {
      list = (await listClient.balanceTransactions.list(listParams, {
        stripeAccount: stripeUserId,
      })) as ListResp;
    } catch (err) {
      // Safety net: if a cursor page still fails (e.g. a stale cursor
      // Stripe can't paginate from), recover ONCE by dropping the cursor
      // and re-listing from the year start. The UNIQUE index on
      // external_transaction_id makes the re-list idempotent, no
      // duplicates, so this favours correctness over a wasted call.
      if (lastSeen && !retriedWithoutCursor) {
        retriedWithoutCursor = true;
        lastSeen = null;
        added = 0;
        pageIdx = -1; // loop's ++ takes the next iteration back to page 0
        continue;
      }
      throw err;
    }

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
      // ON CONFLICT (external_transaction_id) DO NOTHING, the unique
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

  // Auto-apply pass, bring Stripe into parity with the Plaid sync.
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

  // Auto-detect recurring expense streams (subscriptions / SaaS) among
  // what we just applied and mark their cadence, so the forecast projects
  // them instead of treating each charge as one-off. Idempotent + cheap.
  await applyRecurringExpenseDetection(
    admin,
    companyId,
    new Date().getUTCFullYear(),
  );

  // Subscription REVENUE syncs as one row per charge, each tagged with the
  // invoice's billing cadence. Collapse each subscription (recurring_key) so
  // only its latest charge projects forward, otherwise the same sub is
  // counted once per month it has billed. Idempotent.
  await applyRecurringIncomeDetection(
    admin,
    companyId,
    new Date().getUTCFullYear(),
  );

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
 * monthly_income / monthly_expenses tables the Plaid sync feeds -
 * so the income page and the forecast actually reflect the data.
 *
 * Classification follows the user's rule:
 *   +  inflow (charge / payment)              → monthly_income (source="sales")
 *   -  withdrawal (payout/transfer)           → SKIPPED upstream in SKIP_TYPES
 *   -  refund                                 → leave pending for human review
 *   -  anything else (stripe_fee, application_fee, chargeback, network_cost,
 *      tax, adjustment, etc.)                 → monthly_expenses, code mapped
 *
 * Catch-all "other_business" handles unknown Stripe outflow types so
 * the forecast reflects them; the notes carry the original Stripe
 * type so the user can refine in the Recent transactions UI.
 *
 * We only touch rows still in user_action='pending', so re-runs are
 * idempotent. Includes existing pending rows from older syncs, not
 * just freshly-inserted ones, that means a single sync click after
 * deploying this feature back-fills everything that was sitting
 * un-applied.
 *
 * NOTE: monthly_expenses.category_code is FK-constrained to
 * deduction_categories(code). The valid codes are the Schedule-C
 * buckets seeded in 20260428000005_seed_deduction_categories.sql
 * ("bank_fees", "taxes_licenses", "other_business", etc.), NOT the
 * T-codes from lib/deductions/master.ts. An earlier version of this
 * function wrote "T048" and the FK silently rejected every row, so
 * expenses never showed up. Keep this mapping aligned with the seed.
 */
/**
 * Detect whether a Stripe income charge is recurring subscription
 * revenue, and at what cadence, from the expanded balance-transaction
 * payload (we expand data.source.invoice for exactly this). Reads the
 * charge's invoice → subscription link + the billing interval.
 *
 * Conservative on purpose: returns "one_off" unless it can read a clear
 * weekly / monthly / quarterly interval. An annual subscription (one
 * hit per tax year) and any unreadable shape both stay "one_off", so a
 * mis-read can never OVER-project the forecast, the worst case is we
 * miss a recurrence, which the user can still set by hand.
 */
function subscriptionRecurrence(
  raw: Record<string, unknown>,
): "one_off" | "weekly" | "monthly" | "quarterly" {
  const src = raw.source;
  if (!src || typeof src !== "object") return "one_off";
  const inv = (src as Record<string, unknown>).invoice;
  if (!inv || typeof inv !== "object") return "one_off";
  const invoice = inv as Record<string, unknown>;
  const billingReason = String(invoice.billing_reason ?? "");
  const isSubscription =
    Boolean(invoice.subscription) || billingReason.startsWith("subscription");
  if (!isSubscription) return "one_off";
  // Cadence from the first recurring line's price (or legacy plan).
  const linesData = (invoice.lines as Record<string, unknown> | undefined)
    ?.data;
  const line = Array.isArray(linesData)
    ? (linesData[0] as Record<string, unknown>)
    : null;
  const recurring =
    ((line?.price as Record<string, unknown> | undefined)?.recurring as
      | Record<string, unknown>
      | undefined) ?? (line?.plan as Record<string, unknown> | undefined);
  const interval = String(recurring?.interval ?? "");
  const count = Number(recurring?.interval_count ?? 1);
  if (interval === "week") return "weekly";
  if (interval === "month" && count === 3) return "quarterly";
  if (interval === "month") return "monthly";
  // "year" (once per tax year) or unknown → leave as a single occurrence.
  return "one_off";
}

/**
 * Stable identity of the subscription behind a charge, used as
 * monthly_income.recurring_key so the forecast anchors each subscription to
 * a single projecting row. Returns the Stripe subscription id (sub_…) when
 * the charge came from a subscription invoice, else null. Falls back to the
 * invoice's customer id for the rare subscription-invoice shape that omits
 * the subscription field, so two of a customer's subscriptions still don't
 * over-project beyond a single stream.
 */
function subscriptionKey(raw: Record<string, unknown>): string | null {
  const src = raw.source;
  if (!src || typeof src !== "object") return null;
  const inv = (src as Record<string, unknown>).invoice;
  if (!inv || typeof inv !== "object") return null;
  const invoice = inv as Record<string, unknown>;
  const sub = invoice.subscription;
  if (typeof sub === "string" && sub) return sub;
  if (sub && typeof sub === "object") {
    const id = (sub as Record<string, unknown>).id;
    if (typeof id === "string" && id) return id;
  }
  const customer = invoice.customer;
  if (typeof customer === "string" && customer) return customer;
  return null;
}

async function autoApplyPendingStripe(args: {
  admin: SupabaseClient;
  bankAccountId: string;
  companyId: string;
  userId: string;
}): Promise<{ income: number; expense: number }> {
  const { admin, bankAccountId, companyId, userId } = args;

  const { data: pending } = await admin
    .from("account_transactions")
    .select("id, posted_date, amount_cents, description, raw_payload")
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

    // Pull the (already-expanded) source object out of raw_payload so
    // notes can record who paid / what was sold without a second API
    // round-trip. Falls back to whatever we stored in description.
    const src = extractSource(raw);

    // Refunds stay pending: the user wants to decide whether they
    // erase the matched charge (cleaner books) or stand alone as a
    // discount expense. We never auto-apply them.
    if (type === "refund" || type === "payment_refund") continue;

    // Inflow → income. account_transactions.amount_cents uses
    // negative=inflow (positive=expense) per the Plaid convention.
    if (cents < 0) {
      // Only treat known revenue-bearing types as income. An unknown
      // inflow type (e.g. adjustment with positive amount) is left
      // pending so the user can confirm it's actually revenue.
      if (type !== "charge" && type !== "payment") continue;
      // Claim atomically before inserting (idempotency under concurrent syncs).
      if (!(await claimPendingTransaction(admin, tx.id as string, userId)))
        continue;
      const { data: row } = await admin
        .from("monthly_income")
        .insert({
          company_id: companyId,
          user_id: userId,
          tax_year: taxYear,
          month,
          amount_cents: Math.abs(cents),
          source: "sales",
          // Recurring subscription revenue → mark it so the forecast
          // projects it across the year instead of treating it one-off.
          recurrence: subscriptionRecurrence(raw),
          // Stable subscription identity so the anchor pass keeps only the
          // latest charge of each subscription projecting forward.
          recurring_key: subscriptionKey(raw),
          notes: buildIncomeNote({
            description: tx.description as string | null,
            src,
          }),
        })
        .select("id")
        .maybeSingle();
      if (row) {
        await admin
          .from("account_transactions")
          .update({ applied_to_income_id: row.id })
          .eq("id", tx.id);
        income++;
      } else {
        await releasePendingTransaction(admin, tx.id as string);
      }
      continue;
    }

    // cents > 0 here, outflow. Per the user's classification rule,
    // any non-refund, non-withdrawal outflow is an expense. Map to
    // the best-matching Schedule-C bucket.
    if (cents > 0) {
      const code = stripeExpenseCode(type);
      if (!(await claimPendingTransaction(admin, tx.id as string, userId)))
        continue;
      const { data: row } = await admin
        .from("monthly_expenses")
        .insert({
          company_id: companyId,
          user_id: userId,
          tax_year: taxYear,
          month,
          amount_cents: cents,
          category_code: code,
          notes: buildExpenseNote({
            type,
            description: tx.description as string | null,
            src,
          }),
        })
        .select("id")
        .maybeSingle();
      if (row) {
        await admin
          .from("account_transactions")
          .update({ applied_to_expense_id: row.id })
          .eq("id", tx.id);
        expense++;
      } else {
        await releasePendingTransaction(admin, tx.id as string);
      }
    }
  }

  return { income, expense };
}

/**
 * Map a Stripe balance_transaction.type to a Schedule-C deduction
 * code that's actually present in public.deduction_categories. Stays
 * conservative: known Stripe-fee shapes go to "bank_fees", tax goes
 * to "taxes_licenses", and unknown outflow types fall through to
 * "other_business" so the forecast still reflects them. Note: do NOT
 * return T-codes here, those aren't in the FK target table.
 */
function stripeExpenseCode(type: string): string {
  switch (type) {
    case "stripe_fee":
    case "application_fee":
    case "application_fee_refund":
    case "chargeback":
    case "chargeback_fee":
    case "dispute":
    case "dispute_fee":
    case "network_cost":
      return "bank_fees";
    case "tax":
      // Sales tax remitted through Stripe is a deductible business
      // tax payment. Schedule C line 23.
      return "taxes_licenses";
    default:
      // adjustment / connect_collection_transfer / issuing_* / etc.
      // The note carries the original type so the user can refine.
      return "other_business";
  }
}

/**
 * Pull the inflated `source` (charge / payment / refund) off a raw
 * balance_transaction payload, if Stripe expanded it. Returns null
 * for the bare-id case so callers can fall back cleanly.
 */
function extractSource(
  raw: Record<string, unknown>,
): {
  description?: string | null;
  statement_descriptor?: string | null;
  billing_details?: { name?: string | null; email?: string | null } | null;
  metadata?: Record<string, string> | null;
} | null {
  const s = raw.source;
  if (!s || typeof s !== "object") return null;
  return s as ReturnType<typeof extractSource>;
}

/**
 * Build a human-readable note for a monthly_income row coming from
 * Stripe. The note has to tell the user WHO paid (so they can audit
 * a Schedule C line back to a real customer) and WHAT for (so the
 * detection of services vs sales income is reviewable later). Falls
 * through gracefully when the source wasn't expanded.
 */
function buildIncomeNote(args: {
  description: string | null;
  src: ReturnType<typeof extractSource>;
}): string {
  const { description, src } = args;
  const parts: string[] = ["Stripe charge"];
  const who =
    src?.billing_details?.name?.trim() ||
    src?.billing_details?.email?.trim() ||
    null;
  if (who) parts.push(`from ${who}`);
  const what =
    src?.description?.trim() ||
    src?.statement_descriptor?.trim() ||
    (description && !description.startsWith("Stripe ")
      ? description.trim()
      : null);
  if (what) parts.push(`- ${what}`);
  return parts.join(" ");
}

/**
 * Build a human-readable note for a monthly_expenses row. Carries
 * the underlying Stripe type so the user can spot misallocations
 * (e.g. an "adjustment" lumped into other_business) and recategorise.
 */
function buildExpenseNote(args: {
  type: string;
  description: string | null;
  src: ReturnType<typeof extractSource>;
}): string {
  const { type, description, src } = args;
  const parts: string[] = [`Stripe ${type}`];
  const what =
    src?.description?.trim() ||
    src?.statement_descriptor?.trim() ||
    (description && !description.startsWith("Stripe ")
      ? description.trim()
      : null);
  if (what) parts.push(`- ${what}`);
  return parts.join(" ");
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
