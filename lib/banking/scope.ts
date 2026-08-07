// Tenant scoping for the live bank feed.
//
// account_transactions carries no company_id: a row belongs to a
// company only through account -> connection. RLS expresses that as an
// EXISTS join ("acct_tx: manager read"), but any read that goes through
// the SERVICE-ROLE client bypasses RLS and has to walk the chain
// itself. Doing it in one place means a caller cannot forget the join
// and end up reading every tenant's transactions, which is exactly what
// /api/watch/snapshot did.

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Every bank_accounts.id belonging to `companyId`, for use as
 * `.in("account_id", ids)` on account_transactions. Returns an empty
 * array when the company has no connections or no accounts; callers
 * must treat that as "no rows" and skip the query rather than dropping
 * the filter.
 */
export async function companyAccountIds(
  admin: any,
  companyId: string,
): Promise<string[]> {
  const { data: connections } = await admin
    .from("bank_connections")
    .select("id")
    .eq("company_id", companyId);
  const connectionIds = (connections ?? []).map((c: { id: string }) => c.id);
  if (connectionIds.length === 0) return [];

  const { data: accounts } = await admin
    .from("bank_accounts")
    .select("id")
    .in("connection_id", connectionIds);
  return (accounts ?? []).map((a: { id: string }) => a.id);
}
