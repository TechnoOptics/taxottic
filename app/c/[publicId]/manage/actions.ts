"use server";

import { cookies } from "next/headers";
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

// One-shot cookie used to ferry the freshly-minted invite link back to
// the manage page so we can show a "share this link" success card after
// the redirect, without making the URL itself part of the invite list
// (the link must stay private to people the manager hands it to).
const INVITE_LINK_COOKIE = "taxottic_last_invite_link";

export async function inviteMember(formData: FormData) {
  const { supabase, admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = String(formData.get("role") ?? "member") as "member" | "manager";
  const fullName = textOrNull(formData.get("full_name"));
  const title = textOrNull(formData.get("title"));
  const personalMessage = textOrNull(formData.get("personal_message"));
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

  const token = invitationToken();
  const { error } = await admin.from("invitations").insert({
    company_id: companyId,
    email,
    role,
    token,
    invited_by: user.id,
    full_name: fullName,
    title,
    personal_message: personalMessage,
  });

  if (error) throw new Error(error.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();

  // Stash the invite link in a short-lived cookie so the next render of
  // /manage can pop a "share this link" card. We deliberately don't make
  // this part of the URL: it would expose the token in the browser
  // history of anyone who clicks Back. Cookie is HttpOnly so no JS can
  // read it; cleared on next render.
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const inviteUrl = `${origin}/invite/${token}`;
  const cookieStore = await cookies();
  cookieStore.set(INVITE_LINK_COOKIE, inviteUrl, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 5, // 5 minutes - long enough to render once after redirect
  });

  if (company) revalidatePath(`/c/${company.public_id}/manage`);
}

/**
 * Read-and-clear: pulls the most recent invite link out of the cookie
 * (set by inviteMember) so the manage page can show a share card once,
 * then deletes the cookie so reloading the page doesn't keep showing it.
 */
export async function readAndClearLastInviteLink(): Promise<string | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(INVITE_LINK_COOKIE)?.value ?? null;
  if (value) cookieStore.delete(INVITE_LINK_COOKIE);
  return value;
}

function textOrNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
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
