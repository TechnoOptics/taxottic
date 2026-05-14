"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";
import { invitationToken } from "@/lib/ids";
import { logFirmActivity } from "@/lib/firm/activity";
import { sendEmail } from "@/lib/email/transport";
import { renderW9RequestEmail } from "@/lib/email/templates/w9-request";

// W-9 lifecycle from the firm side:
//   - requestW9 → email goes out + row created in 'requested'
//   - markVerified → preparer reviews + flags ok
//   - markInvalid → preparer rejects with a reason; firm follows
//     up out of band

export async function requestW9(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const engagementId = String(formData.get("engagement_id") ?? "");
  const recipientEmail = String(formData.get("recipient_email") ?? "")
    .trim()
    .toLowerCase();
  const recipientName =
    String(formData.get("recipient_name") ?? "").trim() || null;
  if (!engagementId) throw new Error("Missing engagement.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipientEmail)) {
    throw new Error("Provide a valid recipient email.");
  }

  // Upsert: re-requesting from the same email overwrites the
  // request_token + resets expiry, but keeps the (firm_id, email)
  // unique constraint clean.
  const token = invitationToken();
  const expiresAt = new Date(Date.now() + 90 * 86_400_000).toISOString();
  const { data: row, error } = await admin
    .from("firm_w9_forms")
    .upsert(
      {
        firm_id: ctx.firm.id,
        engagement_id: engagementId,
        recipient_email: recipientEmail,
        request_token: token,
        requested_by: user.id,
        expires_at: expiresAt,
        status: "requested",
      },
      { onConflict: "firm_id,recipient_email" },
    )
    .select("id, request_token")
    .single();
  if (error || !row) throw new Error(error?.message ?? "Insert failed.");

  // Build the fill URL on the firm's subdomain if configured.
  const origin = ctx.firm.slug
    ? `https://${ctx.firm.slug}.taxottic.com`
    : process.env.NEXT_PUBLIC_SITE_URL ?? "https://taxottic.com";
  const fillUrl = `${origin}/w9/${row.request_token}`;

  const rendered = renderW9RequestEmail({
    firmName: ctx.firm.name,
    firmLogoUrl: ctx.firm.logo_url,
    firmAccentColor: ctx.firm.accent_color,
    inviterName: (user.user_metadata?.full_name as string) ?? null,
    inviterEmail: user.email ?? null,
    recipientName,
    fillUrl,
    expiresAt,
  });
  await sendEmail({
    to: recipientEmail,
    fromName: rendered.fromName,
    replyTo: rendered.replyTo,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tags: {
      kind: "firm-w9-request",
      firm_slug: ctx.firm.slug ?? "no-slug",
    },
  });

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    engagementId,
    kind: "firm.signature_requested",
    summary: `Requested W-9 from ${recipientEmail}.`,
    payload: {
      w9_id: row.id,
      recipient_email: recipientEmail,
    },
  });

  revalidatePath(`/firm/clients/${engagementId}/w9`);
  redirect(`/firm/clients/${engagementId}/w9`);
}

export async function markW9Verified(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const id = String(formData.get("id") ?? "");
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!id) throw new Error("Missing W-9 id.");

  const { data: row } = await admin
    .from("firm_w9_forms")
    .select("recipient_email, status")
    .eq("id", id)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!row) throw new Error("W-9 not found.");
  if (row.status !== "received") {
    throw new Error(`Cannot verify a W-9 in status '${row.status}'.`);
  }

  await admin
    .from("firm_w9_forms")
    .update({
      status: "verified",
      verified_by: user.id,
      verified_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    engagementId,
    kind: "firm.note_added",
    summary: `Verified W-9 for ${row.recipient_email}.`,
    payload: { w9_id: id, recipient_email: row.recipient_email },
  });

  revalidatePath(`/firm/clients/${engagementId}/w9`);
}

export async function markW9Invalid(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const id = String(formData.get("id") ?? "");
  const engagementId = String(formData.get("engagement_id") ?? "");
  const reason = String(formData.get("notes") ?? "").trim() || null;
  if (!id) throw new Error("Missing W-9 id.");

  await admin
    .from("firm_w9_forms")
    .update({
      status: "invalid",
      notes: reason,
    })
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);

  revalidatePath(`/firm/clients/${engagementId}/w9`);
}
