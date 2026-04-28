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
  // If the user opted in via "yes, raise my headcount", we'll bump the
  // business_profiles.employee_count to fit.
  const allowBumpHeadcount = formData.get("allow_bump_headcount") === "on";

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

  // Headcount enforcement against business_profiles.employee_count.
  const taxYear = new Date().getUTCFullYear();
  const { data: bp } = await admin
    .from("business_profiles")
    .select("employee_count")
    .eq("company_id", companyId)
    .eq("tax_year", taxYear)
    .maybeSingle();

  // Count current non-manager members + outstanding pending invites.
  const [{ count: memberCount }, { count: pendingInviteCount }] =
    await Promise.all([
      admin
        .from("company_members")
        .select("user_id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .neq("role", "manager"),
      admin
        .from("invitations")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .is("accepted_at", null),
    ]);
  const projectedHeadcount = (memberCount ?? 0) + (pendingInviteCount ?? 0) + 1;
  const declared = bp?.employee_count ?? 0;
  if (declared > 0 && projectedHeadcount > declared) {
    if (!allowBumpHeadcount) {
      throw new Error(
        `Adding this teammate would put your team at ${projectedHeadcount} employees, but your business profile says ${declared}. Confirm to bump your declared headcount, or update the business profile first.`,
      );
    }
    // Bump the declared headcount to match.
    await admin
      .from("business_profiles")
      .upsert({
        company_id: companyId,
        tax_year: taxYear,
        employee_count: projectedHeadcount,
        has_employees: true,
      });
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
