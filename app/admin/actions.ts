"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

async function logAction(args: {
  adminUserId: string;
  targetUserId: string | null;
  action: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const admin = createServiceClient();
  await admin.from("admin_actions").insert({
    admin_user_id: args.adminUserId,
    target_user_id: args.targetUserId,
    action: args.action,
    reason: args.reason ?? null,
    metadata: args.metadata ?? null,
  });
}

export async function blockUser(formData: FormData) {
  const { user: adminUser } = await requireSuperAdmin();
  const targetId = String(formData.get("user_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!targetId) throw new Error("Missing user_id");

  // Forever-admin emails cannot be blocked even by another forever admin.
  const admin = createServiceClient();
  const { data: target } = await admin
    .from("profiles")
    .select("email")
    .eq("id", targetId)
    .maybeSingle();
  if (target?.email) {
    const { data: shielded } = await admin
      .from("super_admins")
      .select("email")
      .eq("email", target.email.toLowerCase())
      .maybeSingle();
    if (shielded) {
      throw new Error("This account is on the forever-admin allowlist.");
    }
  }

  await admin
    .from("profiles")
    .update({
      is_blocked: true,
      blocked_at: new Date().toISOString(),
      blocked_reason: reason,
    })
    .eq("id", targetId);

  await logAction({
    adminUserId: adminUser.id,
    targetUserId: targetId,
    action: "block_user",
    reason,
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/user/${targetId}`);
}

export async function unblockUser(formData: FormData) {
  const { user: adminUser } = await requireSuperAdmin();
  const targetId = String(formData.get("user_id") ?? "");
  if (!targetId) throw new Error("Missing user_id");

  const admin = createServiceClient();
  await admin
    .from("profiles")
    .update({
      is_blocked: false,
      blocked_at: null,
      blocked_reason: null,
    })
    .eq("id", targetId);

  await logAction({
    adminUserId: adminUser.id,
    targetUserId: targetId,
    action: "unblock_user",
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/user/${targetId}`);
}

/**
 * Permanently delete a user account — hard delete from auth.users.
 *
 * Safety rails (in order):
 *   1. Super-admin gate (requireSuperAdmin).
 *   2. Forever-admin shield — the super_admins allowlist cannot be deleted.
 *   3. Self-delete guard — you cannot delete the account you're signed in as.
 *   4. Typed-email confirmation — the form must include the target's email
 *      verbatim so a stray button click can't nuke an account.
 *
 * Cascades: the codebase pattern is `references auth.users(id) on delete
 * cascade` (profiles, company_members, device_tokens, etc.), so deleting
 * the auth user removes their owned rows automatically. Supabase's
 * auth.admin.deleteUser also revokes refresh tokens and identities.
 *
 * Recovery: NONE. The user must sign up afresh. This is the intended
 * "let me start fresh" affordance — there's no Undo. We log the action
 * to admin_actions for audit.
 */
export async function deleteUserHard(formData: FormData) {
  const { user: adminUser } = await requireSuperAdmin();
  const targetId = String(formData.get("user_id") ?? "");
  const confirmEmail = String(formData.get("confirm_email") ?? "")
    .trim()
    .toLowerCase();
  if (!targetId) throw new Error("Missing user_id");
  if (targetId === adminUser.id) {
    throw new Error("You cannot delete the account you're signed in as.");
  }

  const admin = createServiceClient();

  // Fetch target email for the confirmation match + the shield check.
  const { data: target } = await admin
    .from("profiles")
    .select("email")
    .eq("id", targetId)
    .maybeSingle();
  const targetEmail = target?.email?.toLowerCase() ?? null;
  if (!targetEmail) throw new Error("User not found.");

  // Forever-admin shield (mirror of blockUser).
  const { data: shielded } = await admin
    .from("super_admins")
    .select("email")
    .eq("email", targetEmail)
    .maybeSingle();
  if (shielded) {
    throw new Error("This account is on the forever-admin allowlist.");
  }

  // Typed-email confirmation — case-insensitive exact match.
  if (confirmEmail !== targetEmail) {
    throw new Error(
      "Confirmation email does not match. Re-type the user's email exactly.",
    );
  }

  // Hard delete via Supabase Auth admin API — cascades to public.profiles
  // and every other table with `references auth.users(id) on delete cascade`.
  const { error } = await admin.auth.admin.deleteUser(targetId);
  if (error) throw new Error(`Auth delete failed: ${error.message}`);

  await logAction({
    adminUserId: adminUser.id,
    targetUserId: null, // FK target row is gone
    action: "delete_user_hard",
    metadata: { deleted_user_id: targetId, deleted_email: targetEmail },
  });

  revalidatePath("/admin");
  // The target user record no longer exists — redirect away from /admin/user/[id].
  redirect("/admin");
}

/**
 * Permanently delete a company — and (via FK cascades) every row that
 * belongs to it (bank_transactions, mileage_trips, deductions, goals,
 * expenses, income, firm_invoices, firm_stripe_accounts, etc.).
 *
 * Safety rails:
 *   1. Super-admin gate.
 *   2. Typed-name confirmation — the form must include the company's
 *      name verbatim.
 *
 * Cascades: relies on the established `references public.companies(id)
 * on delete cascade` pattern. If a non-cascading FK exists for some
 * table, the DELETE errors with a clear FK-violation message and the
 * transaction rolls back (no half-deleted state).
 *
 * Recovery: NONE. Distinct from the soft-delete recycle bin
 * (deleted_at), which IS recoverable via /settings/recycle-bin. This
 * is the final, after-recycle-bin step.
 */
export async function deleteCompanyHard(formData: FormData) {
  const { user: adminUser } = await requireSuperAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const confirmName = String(formData.get("confirm_name") ?? "").trim();
  if (!companyId) throw new Error("Missing company_id");

  const admin = createServiceClient();
  const { data: company } = await admin
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) throw new Error("Company not found.");

  if (confirmName !== (company.name ?? "")) {
    throw new Error(
      "Confirmation name does not match. Re-type the company name exactly.",
    );
  }

  const { error } = await admin
    .from("companies")
    .delete()
    .eq("id", companyId);
  if (error) {
    throw new Error(
      `Delete failed (likely a missing ON DELETE CASCADE on a child table): ${error.message}`,
    );
  }

  await logAction({
    adminUserId: adminUser.id,
    targetUserId: null,
    action: "delete_company_hard",
    metadata: { deleted_company_id: companyId, deleted_name: company.name },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/companies");
}

export async function updateFeedbackStatus(formData: FormData) {
  const { user: adminUser } = await requireSuperAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("admin_note") ?? "").trim() || null;
  if (!id || !status) return;

  const admin = createServiceClient();
  await admin
    .from("feedback")
    .update({ status, admin_note: note })
    .eq("id", id);

  await logAction({
    adminUserId: adminUser.id,
    targetUserId: null,
    action: "feedback_status",
    metadata: { feedback_id: id, status },
  });

  revalidatePath("/admin/feedback");
}
