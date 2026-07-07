import type { SupabaseClient } from "@supabase/supabase-js";

// Idempotency for the bank-feed auto-apply.
//
// The auto-apply paths (lib/plaid/sync, lib/stripe-connect/sync) read pending
// account_transactions, insert a monthly_income/monthly_expenses row, then
// mark the transaction applied. If two syncs run concurrently (a webhook + a
// "Sync now", a double-click, or overlapping cron + manual), both could read
// the same pending row and insert TWICE, doubling the user's tax numbers.
//
// Fix: claim the transaction BEFORE inserting. The conditional UPDATE ...
// WHERE user_action = 'pending' row-locks atomically, only one runner flips
// it; the other matches zero rows and skips. The monthly row is inserted only
// by the winner. If that insert fails, releasePendingTransaction() returns the
// row to pending so a later sync retries it (failure direction is undercount,
// which is safe and recoverable, never a double-count).

export async function claimPendingTransaction(
  admin: SupabaseClient,
  txId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("account_transactions")
    .update({
      user_action: "applied",
      applied_at: new Date().toISOString(),
      applied_by: userId,
    })
    .eq("id", txId)
    .eq("user_action", "pending")
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

export async function releasePendingTransaction(
  admin: SupabaseClient,
  txId: string,
): Promise<void> {
  await admin
    .from("account_transactions")
    .update({ user_action: "pending", applied_at: null, applied_by: null })
    .eq("id", txId);
}

// Resolve a pending transaction as "not a deduction / not income" - the user
// reviewed it and it books nothing to the forecast. Terminal state, so it
// leaves the review queue (account_transactions.user_action check allows
// 'dismissed'). There are no dismiss-specific audit columns, so we reuse
// applied_at/applied_by to record who resolved it and when, same as a claim.
//
// Guarded on user_action='pending' like claimPendingTransaction: race-safe
// against a concurrent sync/claim (only one runner flips a given row) and
// idempotent (a second dismiss of an already-resolved row is a no-op). Returns
// true if THIS call moved the row, false if it was already resolved.
export async function dismissPendingTransaction(
  admin: SupabaseClient,
  txId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("account_transactions")
    .update({
      user_action: "dismissed",
      applied_at: new Date().toISOString(),
      applied_by: userId,
    })
    .eq("id", txId)
    .eq("user_action", "pending")
    .select("id")
    .maybeSingle();
  return Boolean(data);
}
