"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import {
  claimPendingTransaction,
  releasePendingTransaction,
} from "@/lib/banking/claim";

/**
 * Manually resolve a SYNCED bank/Stripe transaction.
 *
 * Why this exists: the outstanding-task list counts
 * account_transactions rows still at user_action='pending' and links the
 * user here — but this page had no actions file at all. The only
 * categorize/ignore actions in the app (setTxCategory, ignoreTx) operate
 * on `bank_transactions`, the CSV-import table, NOT on
 * `account_transactions`, where Plaid and Stripe rows live. So a synced
 * Stripe charge the auto-apply could not classify was a permanent
 * action item: it was shown, it was counted, and nothing in the product
 * could clear it. The page even advertised "one-tap categorization"
 * that did not exist.
 *
 * These mirror what the sync's auto-apply does, so a manual decision
 * produces exactly the same ledger rows as an automatic one.
 */

/** Positive cents = money out (expense); negative = money in (income).
 *  Same convention the Plaid and Stripe writers use. */
function monthOf(postedDate: string): number {
  return Number(postedDate.slice(5, 7));
}
function yearOf(postedDate: string): number {
  return Number(postedDate.slice(0, 4));
}

export async function applySyncedTransaction(formData: FormData) {
  const publicId = String(formData.get("publicId") ?? "");
  const txId = String(formData.get("txId") ?? "");
  const categoryCode = String(formData.get("categoryCode") ?? "");
  if (!publicId || !txId || !categoryCode) return;

  const { supabase, user, company } = await loadCompanyByPublicId(publicId);
  if (!user || !company) return;

  // Ownership is enforced by RLS: reading through the USER-scoped client
  // means a transaction belonging to another company simply isn't
  // visible, so a forged id returns nothing. The page itself relies on
  // the same policy. Writes below use the service client because they
  // touch ledger tables.
  const { data: tx } = await supabase
    .from("account_transactions")
    .select(
      "id, posted_date, amount_cents, description, merchant_name, user_action",
    )
    .eq("id", txId)
    .maybeSingle();
  if (!tx) return;
  if (tx.user_action !== "pending") return; // already resolved

  const admin = createServiceClient();

  // Claim atomically so a concurrent sync can't apply the same row too.
  if (!(await claimPendingTransaction(admin, txId, user.id))) return;

  const cents = Number(tx.amount_cents ?? 0);
  const posted = String(tx.posted_date);
  const label =
    (tx.merchant_name as string | null) ??
    (tx.description as string | null) ??
    "Bank transaction";
  const note = `Manually categorized from the bank feed · ${label}`.slice(0, 500);

  try {
    if (cents >= 0) {
      const { data: row } = await admin
        .from("monthly_expenses")
        .insert({
          company_id: company.id,
          user_id: user.id,
          tax_year: yearOf(posted),
          month: monthOf(posted),
          amount_cents: Math.abs(cents),
          category_code: categoryCode,
          recurrence: "one_off",
          notes: note,
        })
        .select("id")
        .maybeSingle();
      if (!row) throw new Error("expense insert failed");
      await admin
        .from("account_transactions")
        .update({ applied_to_expense_id: row.id })
        .eq("id", txId);
    } else {
      const { data: row } = await admin
        .from("monthly_income")
        .insert({
          company_id: company.id,
          user_id: user.id,
          tax_year: yearOf(posted),
          month: monthOf(posted),
          amount_cents: Math.abs(cents),
          source: categoryCode,
          recurrence: "one_off",
          notes: note,
        })
        .select("id")
        .maybeSingle();
      if (!row) throw new Error("income insert failed");
      await admin
        .from("account_transactions")
        .update({ applied_to_income_id: row.id })
        .eq("id", txId);
    }
  } catch {
    // Put it back in the queue rather than marking it applied with no
    // ledger row behind it — undercounting is recoverable, a phantom
    // "applied" is not.
    await releasePendingTransaction(admin, txId);
    return;
  }

  revalidatePath("/c/[publicId]/banks", "page");
  revalidatePath("/c/[publicId]/expenses", "page");
  revalidatePath("/c/[publicId]/forecast", "page");
  revalidatePath("/dashboard");
}

/** Not a business transaction — clear it from the queue without
 *  creating any ledger row. */
export async function dismissSyncedTransaction(formData: FormData) {
  const publicId = String(formData.get("publicId") ?? "");
  const txId = String(formData.get("txId") ?? "");
  if (!publicId || !txId) return;

  const { supabase, user, company } = await loadCompanyByPublicId(publicId);
  if (!user || !company) return;

  // RLS-scoped read = ownership check (see applySyncedTransaction).
  const { data: tx } = await supabase
    .from("account_transactions")
    .select("id, user_action")
    .eq("id", txId)
    .maybeSingle();
  if (!tx) return;
  if (tx.user_action !== "pending") return;

  const admin = createServiceClient();

  await admin
    .from("account_transactions")
    .update({
      user_action: "dismissed",
      applied_at: new Date().toISOString(),
      applied_by: user.id,
    })
    .eq("id", txId)
    .eq("user_action", "pending");

  revalidatePath("/c/[publicId]/banks", "page");
  revalidatePath("/dashboard");
}
