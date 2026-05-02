import type { PlaidApi, Transaction, RemovedTransaction } from "plaid";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlaidClient } from "./client";

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
 * Returns counts for telemetry. Caller is responsible for updating
 * `last_synced_at` and `status`.
 */
export async function syncPlaidConnection(
  admin: SupabaseClient,
  connectionId: string,
): Promise<{
  added: number;
  modified: number;
  removed: number;
  accounts: number;
}> {
  const plaid = getPlaidClient();
  if (!plaid) throw new Error("Plaid client not configured");

  const { data: secret } = await admin
    .from("bank_connection_secrets")
    .select("access_token")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (!secret) throw new Error("No access token for connection");
  const accessToken = secret.access_token as string;

  const { data: conn } = await admin
    .from("bank_connections")
    .select("cursor")
    .eq("id", connectionId)
    .maybeSingle();
  let cursor = (conn?.cursor as string | null) ?? "";

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

  await admin
    .from("bank_connections")
    .update({
      cursor,
      last_synced_at: new Date().toISOString(),
      status: "active",
      last_error: null,
    })
    .eq("id", connectionId);

  return { added, modified, removed, accounts: accountsTouched };
}

async function upsertTx(
  admin: SupabaseClient,
  txs: Transaction[],
  accountMap: Map<string, string>,
): Promise<number> {
  let n = 0;
  // Plaid returns positive amount for outflow; we store cents with
  // the same sign convention so income flows are negative. Keep this
  // consistent because the suggestion engine assumes it.
  const rows = txs
    .map((t) => {
      const accountId = accountMap.get(t.account_id);
      if (!accountId) return null;
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
