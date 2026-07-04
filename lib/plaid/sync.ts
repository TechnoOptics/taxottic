import type { PlaidApi, Transaction, RemovedTransaction } from "plaid";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlaidClient } from "./client";
import { categorizeExpense, categorizeIncome } from "./categorize";
import { decryptBankToken } from "@/lib/crypto/bankTokens";
import { applyRecurringExpenseDetection } from "@/lib/banking/recurring";
import {
  claimPendingTransaction,
  releasePendingTransaction,
} from "@/lib/banking/claim";

/**
 * Pull every change since the connection's stored cursor and apply
 * them to our tables. Plaid's /transactions/sync model is cursor-
 * based and incremental: each call returns added/modified/removed
 * transactions plus a new cursor we save. The first call (empty
 * cursor) returns the connection's whole history in chunks.
 *
 * Idempotent: external_transaction_id is unique so re-running is
 * safe. Account upserts happen first because transactions FK to
 * account rows.
 *
 * Cost throttle: by default we sync at most once per calendar month
 * per connection. This is a tax-forecasting product, not a real-time
 * balance app, so monthly granularity is enough for the user's needs
 * and keeps Plaid TRANSACTIONS:SYNC spend predictable. Pass
 * `{ force: true }` for user-initiated refreshes (the manual "Sync
 * now" button) and the very first sync after a new connection, both
 * legitimate cases where the throttle would otherwise be wrong.
 *
 * Returns counts for telemetry plus a `skipped` flag set when the
 * monthly throttle short-circuited the run.
 */
export async function syncPlaidConnection(
  admin: SupabaseClient,
  connectionId: string,
  options: { force?: boolean } = {},
): Promise<{
  added: number;
  modified: number;
  removed: number;
  accounts: number;
  applied: number;
  applied_income: number;
  applied_expense: number;
  skipped?: boolean;
}> {
  const plaid = getPlaidClient();
  if (!plaid) throw new Error("Plaid client not configured");

  // Monthly throttle. Skip the Plaid round-trip entirely if we already
  // synced this connection within the current calendar month, unless
  // the caller explicitly forces a refresh. The check happens before
  // any Plaid API call so a skipped run is genuinely free.
  if (!options.force) {
    const { data: existing } = await admin
      .from("bank_connections")
      .select("last_synced_at")
      .eq("id", connectionId)
      .maybeSingle();
    const lastSyncedAt = existing?.last_synced_at as string | null;
    if (lastSyncedAt && isSameCalendarMonthUtc(lastSyncedAt, new Date())) {
      return {
        added: 0,
        modified: 0,
        removed: 0,
        accounts: 0,
        applied: 0,
        applied_income: 0,
        applied_expense: 0,
        skipped: true,
      };
    }
  }

  const { data: secret } = await admin
    .from("bank_connection_secrets")
    .select("access_token, access_token_enc")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (!secret) throw new Error("No access token for connection");
  // Prefer the encrypted column; fall back to legacy plaintext for any
  // pre-encryption rows that haven't been backfilled yet. Once the
  // backfill runs and the cutover migration drops `access_token`,
  // this branch becomes a single decrypt call.
  const enc = secret.access_token_enc as string | null;
  const legacy = secret.access_token as string | null;
  let accessToken: string;
  if (enc) {
    accessToken = decryptBankToken(enc);
  } else if (legacy) {
    accessToken = legacy;
  } else {
    throw new Error("No access token for connection");
  }

  const { data: conn } = await admin
    .from("bank_connections")
    .select("cursor")
    .eq("id", connectionId)
    .maybeSingle();
  let cursor = (conn?.cursor as string | null) ?? "";

  // Make sure Plaid is pushing webhook updates for this Item to our
  // current endpoint. Idempotent: passing the same URL is a no-op,
  // and Items linked before PLAID_WEBHOOK_URL was configured get
  // their webhook backfilled on the next sync. Failures here are
  // non-fatal because polling cron picks up the slack.
  const desiredWebhook = process.env.PLAID_WEBHOOK_URL;
  if (desiredWebhook) {
    try {
      await plaid.itemWebhookUpdate({
        access_token: accessToken,
        webhook: desiredWebhook,
      });
    } catch {
      /* ignore - cron will sync regardless */
    }
  }

  // Refresh accounts first (balances, names) so transaction inserts
  // can resolve account_id.
  const { data: accountsResp } = await plaid.accountsGet({
    access_token: accessToken,
  });
  let accountsTouched = 0;
  for (const acc of accountsResp.accounts) {
    const { error } = await admin.from("bank_accounts").upsert(
      {
        connection_id: connectionId,
        external_account_id: acc.account_id,
        name: acc.name ?? null,
        official_name: acc.official_name ?? null,
        account_type: acc.type ?? null,
        account_subtype: acc.subtype ?? null,
        mask: acc.mask ?? null,
        current_balance_cents:
          acc.balances.current != null
            ? Math.round(acc.balances.current * 100)
            : null,
        available_balance_cents:
          acc.balances.available != null
            ? Math.round(acc.balances.available * 100)
            : null,
        iso_currency_code: acc.balances.iso_currency_code ?? "USD",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "external_account_id" },
    );
    if (!error) accountsTouched++;
  }

  // Build a map of external_account_id -> internal id for transaction
  // inserts.
  const { data: accountRows } = await admin
    .from("bank_accounts")
    .select("id, external_account_id")
    .eq("connection_id", connectionId);
  const accountMap = new Map(
    (accountRows ?? []).map((r) => [
      r.external_account_id as string,
      r.id as string,
    ]),
  );

  let added = 0;
  let modified = 0;
  let removed = 0;
  let hasMore = true;
  while (hasMore) {
    const { data } = await plaid.transactionsSync({
      access_token: accessToken,
      cursor: cursor || undefined,
      count: 500,
    });
    if (data.added.length) added += await upsertTx(admin, data.added, accountMap);
    if (data.modified.length)
      modified += await upsertTx(admin, data.modified, accountMap);
    if (data.removed.length)
      removed += await removeTx(admin, data.removed);
    cursor = data.next_cursor;
    hasMore = data.has_more;
  }

  // Apply unprocessed posted transactions into monthly_income /
  // monthly_expenses so the forecast updates immediately. The user can
  // still recategorize from the review queue later.
  const { applied: appliedCount, applied_income, applied_expense } =
    await applyPendingTransactions(admin, connectionId);

  await admin
    .from("bank_connections")
    .update({
      cursor,
      last_synced_at: new Date().toISOString(),
      status: "active",
      last_error: null,
    })
    .eq("id", connectionId);

  return {
    added,
    modified,
    removed,
    accounts: accountsTouched,
    applied: appliedCount,
    applied_income,
    applied_expense,
  };
}

/**
 * Walk every posted, not-yet-applied transaction belonging to this
 * connection and create a matching monthly_income or monthly_expense
 * row, then mark the source transaction as applied. Idempotent: rows
 * with applied_to_expense_id or applied_to_income_id already set are
 * skipped, so this is safe to re-run on every sync.
 *
 * Skips:
 *   - pending transactions (only post-settled tx flow into forecast)
 *   - internal transfers (TRANSFER_IN / TRANSFER_OUT)
 *   - tax refunds (not income)
 *
 * The user can dismiss or recategorize from the review queue without
 * breaking idempotency because the applied_to_* FK is the lock.
 */
async function applyPendingTransactions(
  admin: SupabaseClient,
  connectionId: string,
): Promise<{ applied: number; applied_income: number; applied_expense: number }> {
  // We need company_id + user_id (the connection creator) to insert
  // into monthly_*. Pull from bank_connections.
  const { data: conn } = await admin
    .from("bank_connections")
    .select("company_id, created_by")
    .eq("id", connectionId)
    .maybeSingle();
  if (!conn || !conn.created_by) {
    return { applied: 0, applied_income: 0, applied_expense: 0 };
  }
  const companyId = conn.company_id as string;
  const userId = conn.created_by as string;

  const { data: accountRows } = await admin
    .from("bank_accounts")
    .select("id")
    .eq("connection_id", connectionId)
    .eq("is_excluded", false);
  const accountIds = (accountRows ?? []).map((a) => a.id as string);
  if (!accountIds.length) {
    return { applied: 0, applied_income: 0, applied_expense: 0 };
  }

  // Pull all unprocessed posted tx for this connection's accounts.
  // Cap the page at 1000 to keep the function snappy; subsequent
  // syncs catch up.
  const { data: txs } = await admin
    .from("account_transactions")
    .select(
      "id, posted_date, amount_cents, personal_finance_category, raw_payload, is_pending",
    )
    .in("account_id", accountIds)
    .eq("user_action", "pending")
    .is("applied_to_expense_id", null)
    .is("applied_to_income_id", null)
    .eq("is_pending", false)
    .order("posted_date", { ascending: true })
    .limit(1000);

  if (!txs || !txs.length) {
    return { applied: 0, applied_income: 0, applied_expense: 0 };
  }

  let income = 0;
  let expense = 0;
  for (const tx of txs) {
    const date = new Date(tx.posted_date as string);
    const taxYear = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const cents = tx.amount_cents as number;
    const primary = (tx.personal_finance_category as string | null) ?? null;
    const detailed =
      ((tx.raw_payload as Record<string, unknown> | null)
        ?.personal_finance_category as { detailed?: string } | undefined)
        ?.detailed ?? null;

    // Plaid sign convention: positive = outflow (expense), negative
    // = inflow (income / refund / credit).
    if (cents > 0) {
      const code = categorizeExpense(primary);
      if (!code) continue;
      // Claim atomically before inserting so a concurrent sync can't apply
      // this transaction twice. Loser of the race skips.
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
          notes: "Auto-imported from bank feed",
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
    } else if (cents < 0) {
      const source = categorizeIncome(primary, detailed);
      if (!source) continue;
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
          source,
          notes: "Auto-imported from bank feed",
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
    }
  }

  // Auto-detect recurring expense streams (subscriptions / SaaS) among
  // what we just applied and mark their cadence, so the forecast projects
  // them instead of treating each charge as one-off. Idempotent + cheap.
  await applyRecurringExpenseDetection(
    admin,
    companyId,
    new Date().getUTCFullYear(),
  );

  return { applied: income + expense, applied_income: income, applied_expense: expense };
}

async function upsertTx(
  admin: SupabaseClient,
  txs: Transaction[],
  accountMap: Map<string, string>,
): Promise<number> {
  let n = 0;
  // Plaid /transactions/sync streams everything historical Plaid has
  // for the item; we only want the current calendar year. Anything
  // older won't roll into THIS year's forecast and just clutters the
  // review queue. Auto-slides on Jan 1 of each year.
  //
  // Plaid's t.date is "yyyy-mm-dd" (ISO date-only) so lexicographic
  // comparison is correct here. We do this client-side because
  // /transactions/sync doesn't accept a start_date, the date window
  // is implicit in the cursor.
  const yearStartIso = `${new Date().getUTCFullYear()}-01-01`;
  // Plaid returns positive amount for outflow; we store cents with
  // the same sign convention so income flows are negative. Keep this
  // consistent because the suggestion engine assumes it.
  const rows = txs
    .map((t) => {
      const accountId = accountMap.get(t.account_id);
      if (!accountId) return null;
      // Skip anything dated before Jan 1 of the current year.
      if (typeof t.date === "string" && t.date < yearStartIso) return null;
      return {
        account_id: accountId,
        external_transaction_id: t.transaction_id,
        posted_date: t.date,
        authorized_date: t.authorized_date ?? null,
        amount_cents: Math.round((t.amount ?? 0) * 100),
        iso_currency_code: t.iso_currency_code ?? "USD",
        merchant_name: t.merchant_name ?? null,
        description: t.name ?? null,
        payment_channel: t.payment_channel ?? null,
        category_path: t.category ?? null,
        personal_finance_category:
          t.personal_finance_category?.primary ?? null,
        is_pending: t.pending ?? false,
        raw_payload: t as unknown as Record<string, unknown>,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (!rows.length) return 0;
  const { error, count } = await admin
    .from("account_transactions")
    .upsert(rows, {
      onConflict: "external_transaction_id",
      count: "exact",
    });
  if (!error) n = count ?? rows.length;
  return n;
}

function isSameCalendarMonthUtc(iso: string, now: Date): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth()
  );
}

async function removeTx(
  admin: SupabaseClient,
  removed: RemovedTransaction[],
): Promise<number> {
  const ids = removed
    .map((r) => r.transaction_id)
    .filter((x): x is string => !!x);
  if (!ids.length) return 0;
  const { count } = await admin
    .from("account_transactions")
    .delete({ count: "exact" })
    .in("external_transaction_id", ids);
  return count ?? 0;
}
