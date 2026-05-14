"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { logFirmActivity } from "@/lib/firm/activity";
import { sendEmail } from "@/lib/email/transport";
import { renderFirmInviteClientEmail } from "@/lib/email/templates/firm-invite-client";

// Server actions for /firm/outreach — pending-invitation management.
//
// Three verbs:
//   - resend: refresh expires_at + re-fire the branded invitation
//     email. Common when the prospect didn't see the first email or
//     the initial send failed (Resend hiccup, bad address typo).
//   - cancel: flip status to 'declined' so it doesn't show up in
//     pending lists or get re-promoted by convert_firm_outreach.
//   - extend: bump expires_at by 60 days for a stale outreach the
//     firm still wants to honor.

function prettyKind(k: string): string {
  return (
    {
      tax_prep: "tax preparation",
      audit_support: "audit response",
      bookkeeping: "bookkeeping",
      advisory: "advisory",
    }[k] ?? k
  );
}

export async function resendOutreach(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "manager") {
    throw new Error("Only firm owners or managers can re-send outreach.");
  }
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing outreach id.");

  // Pull + reset expires_at so the prospect has another 60-day
  // window. RLS lets firm owners + managers update.
  const { data: outreach, error: readErr } = await admin
    .from("firm_client_outreach")
    .select("*")
    .eq("id", id)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!outreach) throw new Error("Outreach not found.");
  if (outreach.status !== "pending") {
    throw new Error("Only pending outreach can be re-sent.");
  }

  const newExpiry = new Date(Date.now() + 60 * 86_400_000).toISOString();
  const { error: updErr } = await admin
    .from("firm_client_outreach")
    .update({ expires_at: newExpiry })
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);
  if (updErr) throw new Error(updErr.message);

  const acceptUrl = `https://taxottic.com/login?next=${encodeURIComponent(
    "/dashboard?from=firm-invite",
  )}`;
  const rendered = renderFirmInviteClientEmail({
    firmName: ctx.firm.name,
    firmSlug: ctx.firm.slug ?? "enterprise",
    firmLogoUrl: ctx.firm.logo_url,
    firmAccentColor: ctx.firm.accent_color,
    recipientName: outreach.full_name,
    engagementKindLabel: prettyKind(outreach.kind),
    taxYear: outreach.tax_year,
    message: outreach.message,
    inviterName: user.user_metadata?.full_name as string | undefined,
    inviterEmail: user.email ?? null,
    acceptUrl,
  });
  await sendEmail({
    to: outreach.email,
    fromName: rendered.fromName,
    subject: `Reminder: ${rendered.subject}`,
    html: rendered.html,
    text: rendered.text,
    replyTo: rendered.replyTo,
    tags: {
      kind: "firm-invite-resend",
      firm_slug: ctx.firm.slug ?? "no-slug",
    },
  });

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    kind: "firm.engagement_created",
    summary: `Re-sent invitation to ${outreach.email}.`,
    payload: { outreach_id: id, email: outreach.email, source: "resend" },
  });

  revalidatePath("/firm/outreach");
}

export async function cancelOutreach(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "manager") {
    throw new Error("Only firm owners or managers can cancel outreach.");
  }
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing outreach id.");

  const { data: outreach, error: readErr } = await admin
    .from("firm_client_outreach")
    .select("email, status")
    .eq("id", id)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!outreach) throw new Error("Outreach not found.");
  if (outreach.status !== "pending") {
    throw new Error("Outreach is already resolved.");
  }

  const { error: updErr } = await admin
    .from("firm_client_outreach")
    .update({
      status: "declined",
      responded_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);
  if (updErr) throw new Error(updErr.message);

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    kind: "firm.engagement_created",
    summary: `Cancelled outreach to ${outreach.email}.`,
    payload: { outreach_id: id, email: outreach.email, source: "cancel" },
  });

  revalidatePath("/firm/outreach");
}

export async function extendOutreach(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "manager") {
    throw new Error("Only firm owners or managers can extend outreach.");
  }
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing outreach id.");

  const newExpiry = new Date(Date.now() + 60 * 86_400_000).toISOString();
  const { error } = await admin
    .from("firm_client_outreach")
    .update({ expires_at: newExpiry })
    .eq("id", id)
    .eq("firm_id", ctx.firm.id)
    .eq("status", "pending");
  if (error) throw new Error(error.message);

  revalidatePath("/firm/outreach");
}
