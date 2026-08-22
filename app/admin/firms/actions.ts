"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth";
import { createSandboxExcludingClient } from "@/lib/hq/elevated-client";
import { invitationToken } from "@/lib/ids";
import {
  enterpriseSiteOrigin,
  sendFirmInviteMagicLink,
} from "@/lib/email/send-firm-invite";
import { logFirmActivity } from "@/lib/firm/activity";
import { isValidSlugFormat, pickAvailableSlug } from "@/lib/firm/slug";

/**
 * Approve a firm access request:
 *   1. Insert a firms row (status='active', starter tier).
 *   2. Mint a firm_invitations row for the contact email with role
 *      'owner' so the requester can sign in to the enterprise app
 *      and become the firm's first owner.
 *   3. Mark the request as 'approved'.
 *
 * The actual welcome email is sent out-of-band; for now we expose the
 * invite token + URL to the super-admin via a server-side console log
 * + cookie ferry pattern (similar to the company invite flow). The
 * enterprise app reads `/invite/<token>` which calls the
 * lookup_firm_invitation RPC to render the landing page.
 */
export async function approveFirmRequest(formData: FormData) {
  await requireSuperAdmin();
  const admin = createSandboxExcludingClient();
  const requestId = String(formData.get("request_id") ?? "");
  // Optional operator-supplied slug. We validate against the
  // firms_slug_format_check + reserved-words list; if invalid we
  // fall through to auto-derivation from the firm name.
  const manualSlugRaw = String(formData.get("slug") ?? "")
    .trim()
    .toLowerCase();
  if (!requestId) throw new Error("Missing request id");

  const { data: req } = await admin
    .from("firm_access_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) throw new Error("Request not found");
  if (req.status !== "pending") throw new Error("Already reviewed");

  // Mint a slug FIRST so we can include it in the firm insert. If
  // the operator supplied a manual slug we honor it (after format
  // check); otherwise derive from firm_name and let
  // pickAvailableSlug() handle uniqueness.
  if (manualSlugRaw && !isValidSlugFormat(manualSlugRaw)) {
    throw new Error(
      "Slug must be 3-32 chars, lowercase alphanumeric + hyphens, no reserved words (admin, hq, www, etc.).",
    );
  }
  const slug = await pickAvailableSlug(
    admin,
    req.firm_name,
    manualSlugRaw || undefined,
  );

  // 1. Create the firm. Status active so the firm can sign in
  //    immediately when the invitee accepts.
  const { data: firm, error: firmError } = await admin
    .from("firms")
    .insert({
      name: req.firm_name,
      slug,
      email: req.contact_email,
      phone: req.contact_phone,
      status: "active",
      tier: "starter",
    })
    .select("id, public_id, slug")
    .single();
  if (firmError || !firm) throw new Error(firmError?.message ?? "Insert failed");

  // 2. Owner invitation
  const token = invitationToken();
  const { error: invErr } = await admin.from("firm_invitations").insert({
    firm_id: firm.id,
    email: req.contact_email,
    full_name: req.contact_full_name,
    role: "owner",
    token,
  });
  if (invErr) throw new Error(invErr.message);

  // 3. Mark request approved
  await admin
    .from("firm_access_requests")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  // Send the welcome email via Supabase's OTP infra. The user clicks
  // the magic link, lands on enterprise /auth/callback?next=/invite/<token>,
  // gets signed in, and bounces to the invite landing where
  // accept_firm_invitation runs. If the email send fails (e.g.,
  // Supabase email provider down, redirect URL not allowlisted), we
  // log the URL to the server console as a fallback so the super
  // admin can hand the link off manually.
  const sendResult = await sendFirmInviteMagicLink(admin, {
    email: req.contact_email,
    invitePath: `/invite/${token}`,
    destinationOrigin: enterpriseSiteOrigin(),
  });
  if (!sendResult.ok) {
    console.error(
      `[firm-invite] email send FAILED for "${req.firm_name}" (${req.contact_email}): ${sendResult.reason}. Manual fallback URL: ${sendResult.inviteUrl}`,
    );
  } else {
    console.log(
      `[firm-invite] welcome email sent to ${req.contact_email} for "${req.firm_name}" -> ${sendResult.inviteUrl}`,
    );
  }

  // Activity log: the firm itself doesn't have any members yet
  // (invitation hasn't been accepted) so the firm-side activity
  // stream stays empty until that lands. We log the approval
  // anyway as a system-side event so the audit trail captures
  // who approved which request.
  await logFirmActivity({
    client: admin,
    firmId: firm.id,
    kind: "firm.member_invited",
    summary: `Firm provisioned at ${slug}.taxottic.com, owner invitation sent to ${req.contact_email}.`,
    payload: {
      request_id: requestId,
      slug,
      owner_email: req.contact_email,
      owner_name: req.contact_full_name,
    },
    actorSide: "system",
  });

  revalidatePath(`/admin/firms`);
}

/**
 * Provision a firm directly, without going through the public access
 * request → approve flow. Super-admin only. Same end-state as
 * approveFirmRequest (active firm + owner invitation + welcome email
 * via Supabase OTP), but accepts the firm details inline so the
 * operator doesn't have to file a request to themselves first.
 *
 * Form fields:
 *   firm_name         (required)
 *   contact_email     (required)
 *   contact_full_name (optional)
 *   slug              (optional, auto-derived from firm_name otherwise)
 */
export async function createFirmDirect(formData: FormData) {
  await requireSuperAdmin();
  const admin = createSandboxExcludingClient();

  const firmName = String(formData.get("firm_name") ?? "").trim();
  const contactEmail = String(formData.get("contact_email") ?? "")
    .trim()
    .toLowerCase();
  const contactName =
    String(formData.get("contact_full_name") ?? "").trim() || null;
  const manualSlugRaw = String(formData.get("slug") ?? "")
    .trim()
    .toLowerCase();

  if (!firmName) throw new Error("Firm name is required.");
  // Minimal email shape check, Supabase + RLS catch the rest.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw new Error("A valid contact email is required.");
  }
  if (manualSlugRaw && !isValidSlugFormat(manualSlugRaw)) {
    throw new Error(
      "Slug must be 3-32 chars, lowercase alphanumeric + hyphens, no reserved words (admin, hq, www, etc.).",
    );
  }
  const slug = await pickAvailableSlug(
    admin,
    firmName,
    manualSlugRaw || undefined,
  );

  const { data: firm, error: firmError } = await admin
    .from("firms")
    .insert({
      name: firmName,
      slug,
      email: contactEmail,
      status: "active",
      tier: "starter",
    })
    .select("id, public_id, slug")
    .single();
  if (firmError || !firm) {
    throw new Error(firmError?.message ?? "Insert failed");
  }

  const token = invitationToken();
  const { error: invErr } = await admin.from("firm_invitations").insert({
    firm_id: firm.id,
    email: contactEmail,
    full_name: contactName,
    role: "owner",
    token,
  });
  if (invErr) throw new Error(invErr.message);

  const sendResult = await sendFirmInviteMagicLink(admin, {
    email: contactEmail,
    invitePath: `/invite/${token}`,
    destinationOrigin: enterpriseSiteOrigin(),
  });
  if (!sendResult.ok) {
    console.error(
      `[firm-invite] (direct) email send FAILED for "${firmName}" (${contactEmail}): ${sendResult.reason}. Manual fallback URL: ${sendResult.inviteUrl}`,
    );
  } else {
    console.log(
      `[firm-invite] (direct) welcome email sent to ${contactEmail} for "${firmName}" -> ${sendResult.inviteUrl}`,
    );
  }

  await logFirmActivity({
    client: admin,
    firmId: firm.id,
    kind: "firm.member_invited",
    summary: `Firm provisioned directly at ${slug}.taxottic.com, owner invitation sent to ${contactEmail}.`,
    payload: {
      direct: true,
      slug,
      owner_email: contactEmail,
      owner_name: contactName,
    },
    actorSide: "system",
  });

  revalidatePath(`/admin/firms`);
}

export async function rejectFirmRequest(formData: FormData) {
  await requireSuperAdmin();
  const admin = createSandboxExcludingClient();
  const requestId = String(formData.get("request_id") ?? "");
  if (!requestId) throw new Error("Missing request id");

  await admin
    .from("firm_access_requests")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  revalidatePath(`/admin/firms`);
}
