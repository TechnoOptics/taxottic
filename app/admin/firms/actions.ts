"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { invitationToken } from "@/lib/ids";

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
  const admin = createServiceClient();
  const requestId = String(formData.get("request_id") ?? "");
  if (!requestId) throw new Error("Missing request id");

  const { data: req } = await admin
    .from("firm_access_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) throw new Error("Request not found");
  if (req.status !== "pending") throw new Error("Already reviewed");

  // 1. Create the firm. Status active so the firm can sign in
  //    immediately when the invitee accepts.
  const { data: firm, error: firmError } = await admin
    .from("firms")
    .insert({
      name: req.firm_name,
      email: req.contact_email,
      phone: req.contact_phone,
      status: "active",
      tier: "starter",
    })
    .select("id, public_id")
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

  // Server-side console log so the super-admin can grab the invite
  // URL until proper outbound email is wired up.
  const enterpriseSite =
    process.env.ENTERPRISE_SITE_URL ?? "https://enterprise.taxottic.com";
  const inviteUrl = `${enterpriseSite}/invite/${token}`;
  console.log(
    `[firm-invite] approved firm "${req.firm_name}" -> invite url: ${inviteUrl}`,
  );

  revalidatePath(`/admin/firms`);
}

export async function rejectFirmRequest(formData: FormData) {
  await requireSuperAdmin();
  const admin = createServiceClient();
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
