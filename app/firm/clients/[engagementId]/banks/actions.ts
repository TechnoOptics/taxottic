"use server";

import { revalidatePath } from "next/cache";
import { requireFirmContext } from "@/lib/firm/context";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Firm-side bulk delete of account_transactions for a client engagement.
 *
 * Auth: requireFirmContext (the firm member must be on the firm), then
 * the engagement must belong to that firm, then every passed tx_id is
 * inner-joined through bank_accounts → bank_connections.company_id
 * and only the ids whose company matches engagement.company_id are
 * deleted. Defence-in-depth identical to the consumer-side action;
 * the difference is the entrypoint authenticates via firm_engagements
 * instead of company_members.
 *
 * Confirmation: formData.confirm must be exactly "delete" (the same
 * literal the UI requires the user to type).
 */
export async function deleteAccountTransactionsForEngagement(
  formData: FormData,
): Promise<{ deleted: number }> {
  const ctx = await requireFirmContext();
  const engagementId = String(formData.get("engagement_id") ?? "");
  const confirm = String(formData.get("confirm") ?? "")
    .trim()
    .toLowerCase();
  const txIds = formData.getAll("tx_ids").map((v) => String(v));

  if (!engagementId) throw new Error("Missing engagement_id.");
  if (confirm !== "delete") {
    throw new Error('Confirmation text must be exactly "delete".');
  }
  if (txIds.length === 0) {
    throw new Error("No transactions selected.");
  }

  const admin = createServiceClient();

  // Engagement must belong to this firm; fetch its company id while
  // we're at it.
  const { data: eng } = await admin
    .from("firm_engagements")
    .select("id, firm_id, company_id")
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng || eng.firm_id !== ctx.firm.id) {
    throw new Error("Not authorised for this engagement.");
  }
  const companyId = eng.company_id as string;

  // Validate every id resolves to a bank_connection of THIS company.
  const { data: owned, error: selErr } = await admin
    .from("account_transactions")
    .select(
      "id, account:bank_accounts!inner(connection:bank_connections!inner(company_id))",
    )
    .in("id", txIds);
  if (selErr) throw new Error(selErr.message);
  const ownedIds = (owned ?? [])
    .filter((row) => {
      const acct = (row as unknown as {
        account: { connection: { company_id: string } };
      }).account;
      return acct?.connection?.company_id === companyId;
    })
    .map((r) => r.id as string);
  if (ownedIds.length === 0) {
    throw new Error("None of the selected transactions belong to this engagement.");
  }

  const { error: delErr, count } = await admin
    .from("account_transactions")
    .delete({ count: "exact" })
    .in("id", ownedIds);
  if (delErr) {
    throw new Error(
      `Delete failed (likely a child FK without ON DELETE CASCADE): ${delErr.message}`,
    );
  }

  revalidatePath(`/firm/clients/${engagementId}/banks`);
  revalidatePath(`/firm/clients/${engagementId}`);
  return { deleted: count ?? ownedIds.length };
}
