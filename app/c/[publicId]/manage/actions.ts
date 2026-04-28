"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { invitationToken } from "@/lib/ids";
import { checkInviteLimit } from "@/lib/plans/usage";

async function isManagerOf(
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  userId: string,
  companyId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("company_members")
    .select("role")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();
  return data?.role === "manager";
}

export async function inviteMember(formData: FormData) {
  const { supabase, admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = String(formData.get("role") ?? "member") as "member" | "manager";

  if (!companyId || !email) throw new Error("Missing fields");
  if (!(await isManagerOf(admin, user.id, companyId))) {
    throw new Error("Only the company manager can invite teammates.");
  }

  const limit = await checkInviteLimit(supabase, user.id, companyId);
  if (!limit.ok) {
    throw new Error(
      "Free plan is solo-only. Upgrade to Pro at /billing to invite teammates.",
    );
  }

  const { error } = await admin.from("invitations").insert({
    company_id: companyId,
    email,
    role,
    token: invitationToken(),
    invited_by: user.id,
  });

  if (error) throw new Error(error.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();

  if (company) revalidatePath(`/c/${company.public_id}/manage`);
}

export async function removeMember(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");

  if (!(await isManagerOf(admin, user.id, companyId))) {
    throw new Error("Only the company manager can remove teammates.");
  }
  if (userId === user.id) {
    throw new Error("You cannot remove yourself.");
  }

  const { error } = await admin
    .from("company_members")
    .delete()
    .eq("company_id", companyId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();

  if (company) revalidatePath(`/c/${company.public_id}/manage`);
}

export async function revokeInvite(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const inviteId = String(formData.get("invite_id") ?? "");

  const { data: invite } = await admin
    .from("invitations")
    .select("company_id, companies(public_id)")
    .eq("id", inviteId)
    .single();

  if (!invite) return;
  if (!(await isManagerOf(admin, user.id, invite.company_id))) {
    throw new Error("Only the company manager can revoke invites.");
  }

  const { error } = await admin
    .from("invitations")
    .delete()
    .eq("id", inviteId);

  if (error) throw new Error(error.message);

  const publicId = (invite?.companies as unknown as { public_id?: string })
    ?.public_id;
  if (publicId) revalidatePath(`/c/${publicId}/manage`);
}
