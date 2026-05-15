"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { logFirmActivity } from "@/lib/firm/activity";
import { sendEmail } from "@/lib/email/transport";
import { renderFirmInviteClientEmail } from "@/lib/email/templates/firm-invite-client";

// Server actions for `/firm/clients/new`.
//
// Two flows in one route:
//
//   A. The email belongs to an existing Taxottic user who already
//      has at least one company. We create a `firm_engagements` row
//      directly against the chosen company, status = 'pending_client'
//      (the client still has to accept). Realtime + email
//      notification goes out from the client side.
//
//   B. The email is not yet a Taxottic user. We drop a row into
//      `firm_client_outreach` and email the prospect a magic-link
//      sign-up. When they sign up + create a company, the existing
//      `convert_firm_outreach()` RPC promotes the outreach into an
//      active engagement.
//
// We don't ask the firm to choose between flows. The action sniffs
// the email against the `profiles` table and picks the right path.
//
// Phase 5 will add a follow-up "send engagement letter" action that
// stamps a Documenso envelope onto the new engagement automatically.

const VALID_KINDS = new Set([
  "tax_prep",
  "audit_support",
  "bookkeeping",
  "advisory",
]);

export async function inviteClient(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "manager") {
    throw new Error("Only firm owners or managers can invite clients.");
  }

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim() || null;
  const businessName =
    String(formData.get("business_name") ?? "").trim() || null;
  const taxYearRaw = Number(formData.get("tax_year"));
  const kindRaw = String(formData.get("kind") ?? "tax_prep");
  const message = String(formData.get("message") ?? "").trim() || null;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Provide a valid client email address.");
  }
  const taxYear =
    Number.isFinite(taxYearRaw) && taxYearRaw >= 2020 && taxYearRaw <= 2100
      ? Math.floor(taxYearRaw)
      : new Date().getUTCFullYear();
  const kind = VALID_KINDS.has(kindRaw) ? kindRaw : "tax_prep";

  // Existing Taxottic user?
  const { data: existing } = await admin
    .from("profiles")
    .select("id, email")
    .ilike("email", email)
    .maybeSingle();

  if (existing?.id) {
    // Look for one of their companies. If they have multiple, we'll
    // have to ask them which one — for Phase 1 we pick the most
    // recently joined-as-manager company and surface it on the next
    // page. If they have zero companies we fall through to the
    // outreach path.
    const { data: managerMembership } = await admin
      .from("company_members")
      .select(
        "company_id, joined_at, company:companies!inner(id, name, public_id, deleted_at)",
      )
      .eq("user_id", existing.id)
      .eq("role", "manager")
      .is("company.deleted_at", null)
      .order("joined_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (managerMembership?.company_id) {
      // Direct firm_engagements insert. Conflict on
      // (firm_id, company_id, tax_year, kind) → revive the row.
      const { data: eng, error } = await admin
        .from("firm_engagements")
        .upsert(
          {
            firm_id: ctx.firm.id,
            company_id: managerMembership.company_id,
            tax_year: taxYear,
            kind,
            status: "pending_client",
            requested_by: user.id,
            requested_by_side: "firm",
            scope_summary: message,
          },
          { onConflict: "firm_id,company_id,tax_year,kind" },
        )
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      await logFirmActivity({
        client: admin,
        firmId: ctx.firm.id,
        companyId: managerMembership.company_id,
        engagementId: eng?.id ?? null,
        kind: "firm.engagement_created",
        summary: `Invited ${email} to a ${prettyKind(kind)} engagement for tax year ${taxYear}.`,
        payload: { email, full_name: fullName, business_name: businessName },
      });

      // Send the firm-branded email. Accept URL deep-links into the
      // engagement so the existing client lands directly on the
      // engagement details rather than the generic dashboard.
      const companyPublicId =
        (managerMembership as unknown as {
          company: { public_id: string } | null;
        }).company?.public_id ?? "";
      const acceptUrl = `https://taxottic.com/login?next=${encodeURIComponent(
        `/c/${companyPublicId}/preparer?engagementId=${eng?.id ?? ""}`,
      )}`;
      const rendered = renderFirmInviteClientEmail({
        firmName: ctx.firm.name,
        firmSlug: ctx.firm.slug ?? "enterprise",
        firmLogoUrl: ctx.firm.logo_url,
        firmAccentColor: ctx.firm.accent_color,
        recipientName: fullName,
        engagementKindLabel: prettyKind(kind),
        taxYear,
        message,
        inviterName: user.user_metadata?.full_name as string | undefined,
        inviterEmail: user.email ?? null,
        acceptUrl,
      });
      await sendEmail({
        to: email,
        fromName: rendered.fromName,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        replyTo: rendered.replyTo,
        tags: {
          kind: "firm-invite-existing-user",
          firm_slug: ctx.firm.slug ?? "no-slug",
        },
      });

      revalidatePath("/firm");
      if (eng?.id) {
        redirect(`/firm/clients/${eng.id}`);
      } else {
        redirect("/firm");
      }
    }
  }

  // Outreach path — email is not on Taxottic yet OR doesn't manage
  // any company. Drop a `firm_client_outreach` row; the existing
  // `convert_firm_outreach()` RPC will promote it once they sign up.
  const { error: outreachError, data: outreach } = await admin
    .from("firm_client_outreach")
    .insert({
      firm_id: ctx.firm.id,
      email,
      full_name: fullName,
      business_name: businessName,
      tax_year: taxYear,
      kind,
      message,
      invited_by: user.id,
    })
    .select("id")
    .single();
  if (outreachError) throw new Error(outreachError.message);

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    kind: "firm.engagement_created",
    summary: `Outreach to ${email} (not on Taxottic yet) for ${prettyKind(kind)} ${taxYear}.`,
    payload: {
      outreach_id: outreach?.id,
      email,
      full_name: fullName,
      business_name: businessName,
    },
  });

  // Phase 3: send the firm-branded invitation email. We render the
  // body with the firm's logo + accent color, set the firm name as
  // the from-display-name, and point the accept URL at the
  // taxottic.com/login path so an account is created on first
  // click. The `pending_firm_outreach_for_me()` RPC surfaces this
  // outreach once the prospect signs up.
  const acceptUrl = `https://taxottic.com/login?next=${encodeURIComponent(
    "/dashboard?from=firm-invite",
  )}`;
  const rendered = renderFirmInviteClientEmail({
    firmName: ctx.firm.name,
    firmSlug: ctx.firm.slug ?? "enterprise",
    firmLogoUrl: ctx.firm.logo_url,
    firmAccentColor: ctx.firm.accent_color,
    recipientName: fullName,
    engagementKindLabel: prettyKind(kind),
    taxYear,
    message,
    inviterName: user.user_metadata?.full_name as string | undefined,
    inviterEmail: user.email ?? null,
    acceptUrl,
  });
  await sendEmail({
    to: email,
    fromName: rendered.fromName,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    replyTo: rendered.replyTo,
    tags: {
      kind: "firm-invite-client",
      firm_slug: ctx.firm.slug ?? "no-slug",
    },
  });

  revalidatePath("/firm");
  redirect("/firm");
}

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
