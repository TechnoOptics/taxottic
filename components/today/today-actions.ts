"use server";

import { createClient } from "@/lib/supabase/server";
import { dismissSyncedTransaction } from "@/app/c/[publicId]/banks/actions";

/**
 * The one in-place resolution Today offers: a synced transaction is not
 * business. `dismissSyncedTransaction` returns void on every guard (missing
 * ids, an ownership check that fails under RLS, a row already resolved), so
 * a void return cannot tell a real change from a silent no-op. Read the row
 * back and report true only when it has moved off "pending": that is the
 * one fact the caller needs to decide whether the row can hide itself.
 */
export async function notBusiness(formData: FormData): Promise<boolean> {
  await dismissSyncedTransaction(formData);
  const txId = String(formData.get("txId") ?? "");
  if (!txId) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("account_transactions")
    .select("user_action")
    .eq("id", txId)
    .maybeSingle();
  return !!data && data.user_action !== "pending";
}
