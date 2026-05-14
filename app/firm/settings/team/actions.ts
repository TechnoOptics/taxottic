"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";
import { invitationToken } from "@/lib/ids";
import { logFirmActivity } from "@/lib/firm/activity";
import { sendEmail } from "@/lib/email/transport";
import { renderFirmMemberInviteEmail } from "@/lib/email/templates/firm-member-invite";

// Team-management actions.
//
// Three operations:
//   1. inviteFirmMember — owner/manager invites someone by email +
//      role. Drops a firm_invitations row with a fresh token,
//      sends a branded email pointing at /invite/<token>.
//   2. revokeInvitation — cancels a pending invite before it's
//      accepted.
//   3. removeMember — owner/manager removes a member from the
//      firm (the row in firm_members, not their Taxottic account).
//
// All three log to firm_activity_log so the audit trail captures
// who did what.

const VALID_ROLES = new Set(["owner", "manager", "preparer", "reviewer"]);

function clientOrigin(): string {
  // Members get the invite URL on the firm's own subdomain when
  // one's configured, so the experience is "join firmname.taxottic.com"
  // rather than the generic enterprise host.
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://taxottic.com";
}

export async function inviteFirmMember(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  // Only owners can invite other owners. Managers can invite
  // managers / preparers / reviewers.
  const requestedRole = String(formData.get("role") ?? "preparer");
  if (!VALID_ROLES.has(requestedRole)) {
    throw new Error("Invalid role.");
  }
  if (requestedRole === "owner" && ctx.membership.role !== "owner") {
    throw new Error("Only owners can invite other owners.");
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Provide a valid email.");
  }
  const fullName = String(formData.get("full_name") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim() || null;

  // Reject duplicates: if a non-revoked invitation already exists
  // for this email + firm, we don't create another one.
  const { data: existing } = await admin
    .from("firm_invitations")
    .select("id, accepted_at")
    .eq("firm_id", ctx.firm.id)
    .ilike("email", email)
    .is("accepted_at", null)
    .maybeSingle();
  if (existing) {
    throw new Error(
      "An invitation for that email is already pending. Revoke it before re-inviting.",
    );
  }
  // Also reject if the email already belongs to a firm member.
  const { data: alreadyMember } = await admin
    .from("firm_members")
    .select("user_id, profiles!inner(email)")
    .eq("firm_id", ctx.firm.id);
  const alreadyEmails = new Set(
    ((alreadyMember as unknown as { profiles: { email: string } }[]) ?? []).map(
      (r) => r.profiles.email.toLowerCase(),
    ),
  );
  if (alreadyEmails.has(email)) {
    throw new Error("That email is already a member of the firm.");
  }

  const token = invitationToken();
  // 7-day expiry is the same shape as the consumer company-member
  // invite (lib/ids.ts ships matching helpers).
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const { data: inv, error } = await admin
    .from("firm_invitations")
    .insert({
      firm_id: ctx.firm.id,
      email,
      full_name: fullName,
      title,
      role: requestedRole,
      token,
      invited_by: user.id,
      expires_at: expiresAt,
    })
    .select("id, token")
    .single();
  if (error || !inv) throw new Error(error?.message ?? "Insert failed.");

  // Resolve the destination origin. Use the firm's subdomain if it
  // has one (so the invitee lands on `smithcpa.taxottic.com/invite/...`),
  // otherwise the consumer host.
  const origin = ctx.firm.slug
    ? `https://${ctx.firm.slug}.taxottic.com`
    : clientOrigin();
  const inviteUrl = `${origin}/invite/${inv.token}`;

  const rendered = renderFirmMemberInviteEmail({
    firmName: ctx.firm.name,
    firmLogoUrl: ctx.firm.logo_url,
    firmAccentColor: ctx.firm.accent_color,
    inviterName: user.user_metadata?.full_name as string | undefined,
    recipientName: fullName,
    role: requestedRole as "owner" | "manager" | "preparer" | "reviewer",
    title,
    inviteUrl,
  });
  await sendEmail({
    to: email,
    fromName: rendered.fromName,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tags: {
      kind: "firm-member-invite",
      firm_slug: ctx.firm.slug ?? "no-slug",
      role: requestedRole,
    },
  });

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    kind: "firm.member_invited",
    summary: `Invited ${email} to join as ${requestedRole}.`,
    payload: {
      invitation_id: inv.id,
      email,
      role: requestedRole,
      title,
    },
  });

  revalidatePath("/firm/settings/team");
}

export async function revokeInvitation(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing invitation id.");

  const { data: inv } = await admin
    .from("firm_invitations")
    .select("email, role")
    .eq("id", id)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!inv) throw new Error("Invitation not found.");

  const { error } = await admin
    .from("firm_invitations")
    .delete()
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);
  if (error) throw new Error(error.message);

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    kind: "firm.member_invited",
    summary: `Revoked invitation for ${inv.email}.`,
    payload: { email: inv.email, role: inv.role, source: "revoke" },
  });

  revalidatePath("/firm/settings/team");
}

export async function removeMember(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const memberUserId = String(formData.get("user_id") ?? "");
  if (!memberUserId) throw new Error("Missing user id.");
  if (memberUserId === user.id) {
    throw new Error("Use 'leave firm' to remove yourself.");
  }

  // Owner-removing-owner needs careful handling — leaving zero
  // owners would orphan the firm. Block if we'd be deleting the
  // last owner.
  const { data: target } = await admin
    .from("firm_members")
    .select("role, profiles!inner(email)")
    .eq("firm_id", ctx.firm.id)
    .eq("user_id", memberUserId)
    .maybeSingle();
  if (!target) throw new Error("Member not found.");
  const targetRole = (target as { role: string }).role;
  const targetEmail =
    (target as unknown as { profiles: { email: string } }).profiles.email;

  if (targetRole === "owner") {
    if (ctx.membership.role !== "owner") {
      throw new Error("Only an owner can remove another owner.");
    }
    const { count } = await admin
      .from("firm_members")
      .select("user_id", { count: "exact", head: true })
      .eq("firm_id", ctx.firm.id)
      .eq("role", "owner");
    if ((count ?? 0) <= 1) {
      throw new Error("Can't remove the last owner.");
    }
  }

  const { error } = await admin
    .from("firm_members")
    .delete()
    .eq("firm_id", ctx.firm.id)
    .eq("user_id", memberUserId);
  if (error) throw new Error(error.message);

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    kind: "firm.member_removed",
    summary: `Removed ${targetEmail} (${targetRole}) from the firm.`,
    payload: { user_id: memberUserId, role: targetRole },
  });

  revalidatePath("/firm/settings/team");
}
