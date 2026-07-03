"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { invitationToken } from "@/lib/ids";
import { checkInviteLimit } from "@/lib/plans/usage";
import { sendEmail } from "@/lib/email/transport";
import { renderCompanyMemberInviteEmail } from "@/lib/email/templates/company-member-invite";

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
  if (data?.role === "manager") return true;

  // Safety net: the person who created the company is always treated as a
  // manager, so the account creator can never be locked out of inviting or
  // managing teammates — even if their membership row is somehow missing or
  // got demoted. This is what guarantees "whoever creates the account is the
  // account manager". (Only runs when the membership check above didn't
  // already confirm manager, so the common path stays a single query.)
  const { data: company } = await admin
    .from("companies")
    .select("created_by")
    .eq("id", companyId)
    .maybeSingle();
  return company?.created_by === userId;
}

// One-shot cookie used to ferry the freshly-minted invite link back to
// the manage page so we can show a "share this link" success card after
// the redirect, without making the URL itself part of the invite list
// (the link must stay private to people the manager hands it to).
const INVITE_LINK_COOKIE = "taxottic_last_invite_link";
// Paired one-shot cookie: whether the invite email actually went out.
// sendEmail() never throws (best-effort transport) and previously its
// result was discarded entirely, so a manager had no way to tell "the
// invitee will get an email" from "nothing was sent, share the link
// yourself" — both looked like an identical success screen. "1" = sent
// via a real provider; absent/anything else = not sent (no provider
// configured, or the provider call failed).
const INVITE_EMAIL_STATUS_COOKIE = "taxottic_last_invite_email_status";

export async function inviteMember(formData: FormData) {
  const { supabase, admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = String(formData.get("role") ?? "member") as
    | "member"
    | "lead"
    | "manager"
    | "expenser";
  const fullName = textOrNull(formData.get("full_name"));
  const title = textOrNull(formData.get("title"));
  const personalMessage = textOrNull(formData.get("personal_message"));
  const departmentId = textOrNull(formData.get("department_id"));
  // If the user opted in via "yes, raise my headcount", we'll bump the
  // business_profiles.employee_count to fit.
  const allowBumpHeadcount = formData.get("allow_bump_headcount") === "on";

  if (!companyId || !email) throw new Error("Missing fields");
  if (!(await isManagerOf(admin, user.id, companyId))) {
    throw new Error("Only the company manager can invite teammates.");
  }

  // Confirm the chosen department actually belongs to this company before
  // it ever reaches the invitations row — a stray/forged id from another
  // company should silently drop rather than cross-link departments.
  let verifiedDepartmentId: string | null = null;
  if (departmentId) {
    const { data: dept } = await admin
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .eq("company_id", companyId)
      .maybeSingle();
    verifiedDepartmentId = dept?.id ?? null;
  }

  // A department lead without a department can't review anything —
  // the role only means something scoped to one department.
  if (role === "lead" && !verifiedDepartmentId) {
    throw new Error(
      "Pick a department for a department lead — their review rights are scoped to it.",
    );
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
    department_id: verifiedDepartmentId,
  });

  if (error) throw new Error(error.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id, name")
    .eq("id", companyId)
    .single();

  // Stash the invite link in a short-lived cookie so the next render of
  // /manage can pop a "share this link" card. We deliberately don't make
  // this part of the URL: it would expose the token in the browser
  // history of anyone who clicks Back. Cookie is HttpOnly so no JS can
  // read it; cleared on next render.
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const inviteUrl = `${origin}/invite/${token}`;

  // Actually email the invitee. Previously this function only wrote the
  // invitations row and handed the manager a link to copy/share — no
  // email ever went out, so invitees never learned they'd been added
  // unless the manager separately sent them the link by hand.
  let emailSent = false;
  if (company) {
    const rendered = renderCompanyMemberInviteEmail({
      companyName: company.name,
      inviterName: (user.user_metadata?.full_name as string | undefined) ?? null,
      recipientName: fullName,
      role,
      title,
      personalMessage,
      inviteUrl,
    });
    const result = await sendEmail({
      to: email,
      fromName: rendered.fromName,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: { kind: "company-member-invite", role },
    });
    // "noop" means no provider was configured at all — that's not a
    // real send, regardless of the ok:true it returns for callers that
    // just want "did this throw." A failed Resend call also isn't sent.
    emailSent = result.ok && result.provider !== "noop";
    if (!emailSent) {
      console.error(
        `[invite] email not sent to ${email} (provider=${result.provider}${result.reason ? `, reason=${result.reason}` : ""})`,
      );
    }
  }

  const cookieStore = await cookies();
  cookieStore.set(INVITE_LINK_COOKIE, inviteUrl, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 5, // 5 minutes - long enough to render once after redirect
  });
  cookieStore.set(INVITE_EMAIL_STATUS_COOKIE, emailSent ? "1" : "0", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 5,
  });

  if (company) revalidatePath(`/c/${company.public_id}/manage`);
}

/**
 * Read-only peek: pulls the most recent invite link + whether its email
 * actually sent out of cookies (set by inviteMember) so the manage page
 * can show a share card once. Never mutates cookies — Next.js only allows
 * cookies().set()/delete() during a Server Action or Route Handler
 * response, not a plain page render (this page also renders on a normal
 * GET navigation, where the cookie store is read-only). Clearing happens
 * separately via clearLastInviteLinkCookie, called from a client component
 * after mount.
 */
export async function peekLastInviteLink(): Promise<{
  url: string;
  emailSent: boolean;
} | null> {
  const cookieStore = await cookies();
  const url = cookieStore.get(INVITE_LINK_COOKIE)?.value ?? null;
  const emailSent = cookieStore.get(INVITE_EMAIL_STATUS_COOKIE)?.value === "1";
  return url ? { url, emailSent } : null;
}

/**
 * Clears the invite-link cookies. This is a Server Action, so — unlike
 * peekLastInviteLink — it's allowed to mutate cookies. Call it from a
 * client component once the share card has been shown, so a page reload
 * doesn't keep re-displaying the same invite.
 */
export async function clearLastInviteLinkCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(INVITE_LINK_COOKIE);
  cookieStore.delete(INVITE_EMAIL_STATUS_COOKIE);
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

async function revalidateManageForCompany(
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  companyId: string,
) {
  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .maybeSingle();
  if (company) revalidatePath(`/c/${company.public_id}/manage`);
}

export async function createDepartment(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const name = textOrNull(formData.get("name"));

  if (!companyId || !name) throw new Error("Missing fields");
  if (!(await isManagerOf(admin, user.id, companyId))) {
    throw new Error("Only the company manager can create departments.");
  }

  const { error } = await admin.from("departments").insert({
    company_id: companyId,
    name,
    created_by: user.id,
  });
  // Unique (company_id, lower(name)) — surface a friendly message on
  // conflict instead of the raw Postgres constraint error.
  if (error) {
    throw new Error(
      error.code === "23505"
        ? `A department named "${name}" already exists.`
        : error.message,
    );
  }

  await revalidateManageForCompany(admin, companyId);
}

export async function renameDepartment(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const departmentId = String(formData.get("department_id") ?? "");
  const name = textOrNull(formData.get("name"));
  if (!departmentId || !name) throw new Error("Missing fields");

  const { data: dept } = await admin
    .from("departments")
    .select("company_id")
    .eq("id", departmentId)
    .maybeSingle();
  if (!dept) throw new Error("Department not found.");
  if (!(await isManagerOf(admin, user.id, dept.company_id))) {
    throw new Error("Only the company manager can rename departments.");
  }

  const { error } = await admin
    .from("departments")
    .update({ name })
    .eq("id", departmentId);
  if (error) {
    throw new Error(
      error.code === "23505"
        ? `A department named "${name}" already exists.`
        : error.message,
    );
  }

  await revalidateManageForCompany(admin, dept.company_id);
}

export async function deleteDepartment(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const departmentId = String(formData.get("department_id") ?? "");
  if (!departmentId) throw new Error("Missing fields");

  const { data: dept } = await admin
    .from("departments")
    .select("company_id")
    .eq("id", departmentId)
    .maybeSingle();
  if (!dept) return;
  if (!(await isManagerOf(admin, user.id, dept.company_id))) {
    throw new Error("Only the company manager can delete departments.");
  }

  // Members in this department fall back to "no department" (the fk is
  // on delete set null) rather than being blocked or removed from the team.
  const { error } = await admin
    .from("departments")
    .delete()
    .eq("id", departmentId);
  if (error) throw new Error(error.message);

  await revalidateManageForCompany(admin, dept.company_id);
}

export async function assignMemberDepartment(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const memberUserId = String(formData.get("user_id") ?? "");
  // Empty string = unassign (department_id column goes back to null).
  const departmentId = textOrNull(formData.get("department_id"));

  if (!companyId || !memberUserId) throw new Error("Missing fields");
  if (!(await isManagerOf(admin, user.id, companyId))) {
    throw new Error("Only the company manager can assign departments.");
  }

  if (departmentId) {
    const { data: dept } = await admin
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!dept) throw new Error("Department not found for this company.");
  }

  const { error } = await admin
    .from("company_members")
    .update({ department_id: departmentId })
    .eq("company_id", companyId)
    .eq("user_id", memberUserId);
  if (error) throw new Error(error.message);

  await revalidateManageForCompany(admin, companyId);
}
