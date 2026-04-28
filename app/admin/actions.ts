"use server";

import { revalidatePath } from "next/cache";
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
