"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { getPlaidClient } from "@/lib/plaid/client";
import { logCompanyActivity } from "@/lib/activity/log";

// Recycle-bin actions: soft-delete with a 30-day grace period, plus
// restore and immediate purge. Companies and bank connections each get
// `deleted_at` (migration 20260513000001). Active reads filter
// `.is('deleted_at', null)`; the /settings/recycle-bin page reads from
// the `recycle_bin` view to show what's pending purge.
//
// Authorization rule: only the company's manager (which on every
// existing tenant is the user who created the company) can move it to
// the bin. For bank connections, same, the manager of the connection's
// owning company.

const RECYCLE_BIN_PATH = "/settings/recycle-bin";

async function assertCompanyManager(
  admin: ReturnType<
    typeof import("@/lib/supabase/server").createServiceClient
  >,
  userId: string,
  companyId: string,
) {
  const { data } = await admin
    .from("company_members")
    .select("role")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (data?.role !== "manager") {
    throw new Error(
      "Only the company manager can move this to the recycle bin.",
    );
  }
}

// -------------------------------------------------------------------
// Bank disconnect
// -------------------------------------------------------------------

/**
 * Disconnect a bank: revoke Plaid's access token (best-effort) and
 * soft-delete the connection. The 30-day clock starts now; until then
 * the user can Restore it from /settings/recycle-bin.
 *
 * Reading transactions, accounts, and balance history all filter on
 * the connection's `deleted_at` via the connection FK cascade, so the
 * Banks page stops showing it immediately. The historical
 * transactions remain in the database during the grace window; if the
 * user restores within 30 days they're back. If the user permanently
 * deletes (or the cron does, after 30 days), the bank_connections row
 * goes away and ON DELETE CASCADE drops accounts + transactions.
 */
export async function disconnectBank(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const connectionId = String(formData.get("connection_id") ?? "");
  if (!connectionId) throw new Error("Missing connection_id");

  // Verify the user manages the connection's company.
  const { data: conn } = await admin
    .from("bank_connections")
    .select("id, provider, company_id, deleted_at")
    .eq("id", connectionId)
    .maybeSingle();
  if (!conn) throw new Error("Bank connection not found");
  if (conn.deleted_at) {
    // Idempotent, clicking Disconnect again on an already-disconnected
    // connection is fine. Send the user to the recycle bin.
    redirect(RECYCLE_BIN_PATH);
  }
  await assertCompanyManager(admin, user.id, conn.company_id);

  // Best-effort upstream revocation. We don't gate the soft-delete on
  // this, even if Plaid returns an error, the user's view of "this
  // bank is disconnected from Taxottic" should still take effect. The
  // last_error column captures the upstream failure so support can
  // retry later.
  let plaidError: string | null = null;
  if (conn.provider === "plaid") {
    try {
      const plaid = getPlaidClient();
      if (plaid) {
        const { data: secret } = await admin
          .from("bank_connection_secrets")
          .select("access_token")
          .eq("connection_id", connectionId)
          .maybeSingle();
        if (secret?.access_token) {
          await plaid.itemRemove({ access_token: secret.access_token });
        }
      }
    } catch (err) {
      plaidError = err instanceof Error ? err.message : String(err);
    }
  }

  // Soft-delete + clear the upstream secret. The secret is the
  // sensitive bit; even though the cascade will eventually delete it,
  // we wipe it now so a 30-day-window leak doesn't expose a live
  // token. Keep the rest of the row (institution_name, etc.) so the
  // recycle bin can render a useful label.
  await admin
    .from("bank_connection_secrets")
    .delete()
    .eq("connection_id", connectionId);

  await admin
    .from("bank_connections")
    .update({
      deleted_at: new Date().toISOString(),
      status: "revoked",
      last_error: plaidError,
    })
    .eq("id", connectionId);

  await logCompanyActivity(admin, {
    companyId: conn.company_id,
    actorUserId: user.id,
    kind: "bank.disconnected",
    summary: `Disconnected a ${conn.provider} bank connection`,
    payload: { connection_id: connectionId, provider: conn.provider },
  });

  // Get the company public_id so we can revalidate the right page.
  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", conn.company_id)
    .maybeSingle();
  if (company?.public_id) {
    revalidatePath(`/c/${company.public_id}/banks`);
    revalidatePath(`/c/${company.public_id}/forecast`);
  }
  revalidatePath(RECYCLE_BIN_PATH);
  revalidatePath("/dashboard");
  revalidatePath("/firm");
}

/**
 * Restore a soft-deleted bank connection. Clears `deleted_at` and
 * marks status `needs_reauth` because the upstream Plaid token was
 * revoked when we disconnected, the user will need to re-link the
 * institution to resume syncing. The restored row keeps its historical
 * transactions so they don't have to re-categorize.
 */
export async function restoreBank(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const connectionId = String(formData.get("connection_id") ?? "");
  if (!connectionId) throw new Error("Missing connection_id");

  const { data: conn } = await admin
    .from("bank_connections")
    .select("company_id, deleted_at")
    .eq("id", connectionId)
    .maybeSingle();
  if (!conn) throw new Error("Bank connection not found");
  if (!conn.deleted_at) return; // already active
  await assertCompanyManager(admin, user.id, conn.company_id);

  await admin
    .from("bank_connections")
    .update({
      deleted_at: null,
      status: "needs_reauth",
    })
    .eq("id", connectionId);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", conn.company_id)
    .maybeSingle();
  if (company?.public_id) {
    revalidatePath(`/c/${company.public_id}/banks`);
  }
  revalidatePath(RECYCLE_BIN_PATH);
}

/**
 * Permanently delete a bank connection NOW, bypassing the 30-day
 * wait. Cascades to accounts + transactions via the connection FK.
 * Requires the connection to already be soft-deleted (you can't
 * skip the recycle-bin step from active state, UI defends against
 * misclick, this is the second layer).
 */
export async function purgeBank(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const connectionId = String(formData.get("connection_id") ?? "");
  if (!connectionId) throw new Error("Missing connection_id");

  const { data: conn } = await admin
    .from("bank_connections")
    .select("company_id, deleted_at")
    .eq("id", connectionId)
    .maybeSingle();
  if (!conn) throw new Error("Bank connection not found");
  if (!conn.deleted_at) {
    throw new Error(
      "Disconnect first, permanent delete is only available from the recycle bin.",
    );
  }
  await assertCompanyManager(admin, user.id, conn.company_id);

  await admin.from("bank_connections").delete().eq("id", connectionId);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", conn.company_id)
    .maybeSingle();
  if (company?.public_id) {
    revalidatePath(`/c/${company.public_id}/banks`);
  }
  revalidatePath(RECYCLE_BIN_PATH);
}

// -------------------------------------------------------------------
// Company close / restore / purge
// -------------------------------------------------------------------

/**
 * Close a company: soft-delete it. The dashboard, firm cockpit, and
 * /c/[publicId]/* pages all filter on `.is('deleted_at', null)`, so the
 * company disappears from active views immediately. It surfaces in
 * /settings/recycle-bin with a 30-day countdown.
 *
 * NOTE: bank connections attached to the company are NOT disconnected
 * by this action. We deliberately keep them active for the grace
 * window so a Restore one-clicks back to working state. If the company
 * is permanently purged (manual or by the cron), the bank_connections
 * cascade-delete via the FK on companies(id).
 */
export async function closeCompany(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  if (!companyId) throw new Error("Missing company_id");

  await assertCompanyManager(admin, user.id, companyId);

  const { data: company } = await admin
    .from("companies")
    .select("public_id, deleted_at")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) throw new Error("Company not found");
  if (company.deleted_at) {
    redirect(RECYCLE_BIN_PATH);
  }

  await admin
    .from("companies")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", companyId);

  revalidatePath("/dashboard");
  revalidatePath("/firm");
  revalidatePath(RECYCLE_BIN_PATH);
  redirect(RECYCLE_BIN_PATH);
}

/**
 * Restore a soft-deleted company. Clears `deleted_at`. Any bank
 * connections that were also soft-deleted remain so, restore those
 * separately from the recycle bin.
 */
export async function restoreCompany(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  if (!companyId) throw new Error("Missing company_id");

  await assertCompanyManager(admin, user.id, companyId);

  await admin
    .from("companies")
    .update({ deleted_at: null })
    .eq("id", companyId);

  revalidatePath("/dashboard");
  revalidatePath("/firm");
  revalidatePath(RECYCLE_BIN_PATH);
}

/**
 * Permanently delete a company NOW. Cascades to every dependent row
 * via the FK chains. Requires the company to already be soft-deleted.
 */
export async function purgeCompany(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  if (!companyId) throw new Error("Missing company_id");

  await assertCompanyManager(admin, user.id, companyId);

  const { data: company } = await admin
    .from("companies")
    .select("deleted_at")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) throw new Error("Company not found");
  if (!company.deleted_at) {
    throw new Error(
      "Close the company first, permanent delete is only available from the recycle bin.",
    );
  }

  await admin.from("companies").delete().eq("id", companyId);

  revalidatePath("/dashboard");
  revalidatePath("/firm");
  revalidatePath(RECYCLE_BIN_PATH);
}

// -------------------------------------------------------------------
// Lazy purge sweep: hard-delete anything past 30 days.
// -------------------------------------------------------------------

/**
 * Hard-delete every soft-deleted item whose grace window has expired.
 * Safe to call repeatedly, the 30-day cutoff is enforced inside the
 * SQL function. The dashboard render calls this lazily on every load
 * so even without a real cron the recycle bin stays accurate. A real
 * cron (Supabase pg_cron or Vercel Cron) should call this nightly as
 * a backstop for accounts that haven't logged in.
 */
export async function purgeExpiredRecycleBin(): Promise<{
  companies: number;
  bankConnections: number;
}> {
  const { admin } = await requireUserWithAdmin();
  const { data, error } = await admin.rpc("purge_expired_recycle_bin");
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    companies: row?.purged_companies ?? 0,
    bankConnections: row?.purged_bank_connections ?? 0,
  };
}
