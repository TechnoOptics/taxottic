// Shared bank-transaction clarification core for the watch swipe deck.
//
// Single source of truth used by BOTH /api/watch/confirm (phone bridge
// or session) and /api/watch/action (watch bearer token), so a swipe
// takes the same authorised path whichever way it reaches the server.
// Mirrors the writes of import/actions.ts setTxCategory / ignoreTx:
// Business keeps the row staged with its suggested category, Personal
// ignores it.
//
// AUTHORISATION. Both routes write through the service-role client,
// which bypasses RLS, so the policy has to be restated here. It used to
// be a bare "is the caller a member of the transaction's company?"
// lookup, which let an expenser categorise or ignore transactions out
// of the owner's bank import. The boundary is the same one the
// "transactions: scoped update" policy enforces:
//
//   manager of the transaction's company, OR a member who uploaded the
//   import the transaction came from (bank_transactions.import_id ->
//   bank_imports.user_id; the transaction row itself has no user_id).

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ClarifyResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "not_found" | "forbidden" | "db" };

/**
 * Authorise and apply a business/personal call on one bank_transactions
 * row. `admin` is the service-role client; `userId` is the
 * already-authenticated caller. Returns a discriminated result rather
 * than throwing so HTTP callers map cleanly to status codes.
 */
export async function clarifyBankTransactionCore(
  admin: any,
  userId: string,
  txId: string,
  business: boolean,
): Promise<ClarifyResult> {
  if (!txId) return { ok: false, reason: "invalid" };

  const { data: tx } = await admin
    .from("bank_transactions")
    .select("id, company_id, import_id, suggested_category_code")
    .eq("id", txId)
    .maybeSingle();
  if (!tx) return { ok: false, reason: "not_found" };

  const { data: membership } = await admin
    .from("company_members")
    .select("role")
    .eq("company_id", tx.company_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return { ok: false, reason: "forbidden" };

  let authorized = membership.role === "manager";
  if (!authorized) {
    // Not a manager: the only rows they may touch are the ones inside
    // an import they uploaded themselves.
    const { data: imp } = await admin
      .from("bank_imports")
      .select("user_id")
      .eq("id", tx.import_id)
      .maybeSingle();
    authorized = !!imp && imp.user_id === userId;
  }
  if (!authorized) return { ok: false, reason: "forbidden" };

  const patch = business
    ? {
        // Keep it, staged with its suggested deduction category (null
        // is allowed, that leaves it for the in-app apply step, but
        // un-ignored).
        applied_category_code: tx.suggested_category_code ?? null,
        ignored: false,
      }
    : { ignored: true, applied_category_code: null };

  const { error } = await admin
    .from("bank_transactions")
    .update(patch)
    .eq("id", txId);
  if (error) return { ok: false, reason: "db" };

  return { ok: true };
}

/** HTTP status for a failed clarify, shared by both routes. */
export function clarifyStatus(reason: "invalid" | "not_found" | "forbidden" | "db"): number {
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  if (reason === "invalid") return 400;
  return 500;
}
