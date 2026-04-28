"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { invitationToken } from "@/lib/ids";
import { checkInviteLimit } from "@/lib/plans/usage";

export async function inviteMember(formData: FormData) {
  const { supabase, user } = await requireUser();
  const companyId = String(formData.get("company_id") ?? "");
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = String(formData.get("role") ?? "member") as "member" | "manager";

  if (!companyId || !email) throw new Error("Missing fields");

  const limit = await checkInviteLimit(supabase, user.id, companyId);
  if (!limit.ok) {
    throw new Error(
      "Free plan is solo-only. Upgrade to Pro at /billing to invite teammates.",
    );
  }

  const { error } = await supabase.from("invitations").insert({
    company_id: companyId,
    email,
    role,
    token: invitationToken(),
    invited_by: user.id,
  });

  if (error) throw new Error(error.message);

  const { data: company } = await supabase
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();

  if (company) revalidatePath(`/c/${company.public_id}/manage`);
}

export async function removeMember(formData: FormData) {
  const { supabase } = await requireUser();
  const companyId = String(formData.get("company_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");

  const { error } = await supabase
    .from("company_members")
    .delete()
    .eq("company_id", companyId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);

  const { data: company } = await supabase
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();

  if (company) revalidatePath(`/c/${company.public_id}/manage`);
}

export async function revokeInvite(formData: FormData) {
  const { supabase } = await requireUser();
  const inviteId = String(formData.get("invite_id") ?? "");

  const { data: invite } = await supabase
    .from("invitations")
    .select("company_id, companies(public_id)")
    .eq("id", inviteId)
    .single();

  const { error } = await supabase
    .from("invitations")
    .delete()
    .eq("id", inviteId);

  if (error) throw new Error(error.message);

  const publicId = (invite?.companies as unknown as { public_id?: string })
    ?.public_id;
  if (publicId) revalidatePath(`/c/${publicId}/manage`);
}
