"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";
import { logFirmActivity } from "@/lib/firm/activity";
import {
  createInvoiceCheckoutSession,
  platformFeeCents,
} from "@/lib/firm/payments/stripe-connect";
import { sendEmail } from "@/lib/email/transport";

// Two server actions:
//   1. createInvoice, draft an invoice. Line items + recipient
//      are validated; we DON'T touch Stripe yet. Status = draft.
//   2. sendInvoice, mint a Stripe Checkout Session on the firm's
//      Connected Account, email the hosted URL to the recipient,
//      flip status to 'sent'.
//
// Splitting create + send means an invoice can be saved as a
// draft, reviewed by a partner, and only then dispatched.

type LineItem = { description: string; quantity: number; unit_amount_cents: number };

function origin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://taxottic.com";
}

function parseLineItems(formData: FormData): LineItem[] {
  // The form posts repeating fields: line_desc[], line_qty[], line_amount[].
  // FormData.getAll preserves order so we walk them as parallel arrays.
  const descs = formData.getAll("line_desc").map((v) => String(v ?? "").trim());
  const qtys = formData.getAll("line_qty").map((v) => Number(v));
  const amts = formData.getAll("line_amount").map((v) => parseAmountCents(String(v ?? "")));
  const items: LineItem[] = [];
  for (let i = 0; i < descs.length; i++) {
    const desc = descs[i];
    const qty = qtys[i];
    const amt = amts[i];
    if (!desc || !Number.isFinite(qty) || qty <= 0 || amt === null || amt <= 0) {
      continue;
    }
    items.push({
      description: desc.slice(0, 200),
      quantity: Math.min(Math.floor(qty), 9999),
      unit_amount_cents: amt,
    });
  }
  return items;
}

function parseAmountCents(s: string): number | null {
  const cleaned = s.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export async function createInvoice(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!engagementId) throw new Error("Missing engagement.");

  const recipientEmail = String(formData.get("recipient_email") ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipientEmail)) {
    throw new Error("Provide a valid recipient email.");
  }
  const recipientName = String(formData.get("recipient_name") ?? "").trim() || null;
  const invoiceNumber =
    String(formData.get("invoice_number") ?? "").trim() ||
    `INV-${new Date().getUTCFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`;
  const dueAtRaw = String(formData.get("due_at") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const lineItems = parseLineItems(formData);
  if (lineItems.length === 0) {
    throw new Error("Add at least one line item.");
  }

  const subtotalCents = lineItems.reduce(
    (a, li) => a + li.quantity * li.unit_amount_cents,
    0,
  );
  const taxCents = 0; // application-side tax math lives on a later phase
  const totalCents = subtotalCents + taxCents;
  const platform_fee = platformFeeCents({ totalCents });

  // Load engagement for company_id.
  const { data: eng } = await admin
    .from("firm_engagements")
    .select("id, company_id")
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!eng) throw new Error("Engagement not found.");

  const { data: inv, error } = await admin
    .from("firm_invoices")
    .insert({
      firm_id: ctx.firm.id,
      engagement_id: engagementId,
      company_id: eng.company_id,
      invoice_number: invoiceNumber,
      line_items: lineItems,
      subtotal_cents: subtotalCents,
      tax_cents: taxCents,
      total_cents: totalCents,
      currency: "usd",
      platform_fee_bps: 300,
      platform_fee_cents: platform_fee,
      recipient_email: recipientEmail,
      recipient_name: recipientName,
      due_at: dueAtRaw,
      status: "draft",
      notes,
      created_by: user.id,
    })
    .select("id, invoice_number")
    .single();
  if (error || !inv) throw new Error(error?.message ?? "Insert failed.");

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    companyId: eng.company_id,
    engagementId,
    kind: "firm.invoice_sent",
    summary: `Drafted invoice ${inv.invoice_number} for ${(totalCents / 100).toFixed(2)} ${"USD"}.`,
    payload: {
      invoice_id: inv.id,
      total_cents: totalCents,
      recipient: recipientEmail,
    },
  });

  revalidatePath(`/firm/clients/${engagementId}/invoices`);
  redirect(`/firm/clients/${engagementId}/invoices`);
}

export async function sendInvoice(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!invoiceId) throw new Error("Missing invoice id.");

  const { data: stripeRow } = await admin
    .from("firm_stripe_accounts")
    .select("stripe_account_id, charges_enabled")
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!stripeRow?.stripe_account_id || !stripeRow.charges_enabled) {
    throw new Error(
      "Connect Stripe + finish onboarding before sending invoices.",
    );
  }

  const { data: invoice } = await admin
    .from("firm_invoices")
    .select(
      "id, firm_id, engagement_id, company_id, invoice_number, line_items, total_cents, currency, platform_fee_cents, recipient_email, recipient_name, status",
    )
    .eq("id", invoiceId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!invoice) throw new Error("Invoice not found.");
  if (invoice.status !== "draft") {
    throw new Error("Only draft invoices can be sent.");
  }

  const o = origin();
  const checkout = await createInvoiceCheckoutSession({
    stripeAccountId: stripeRow.stripe_account_id,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    recipientEmail: invoice.recipient_email,
    recipientName: invoice.recipient_name,
    lineItems: invoice.line_items as LineItem[],
    currency: invoice.currency,
    platformFeeCents: invoice.platform_fee_cents,
    successUrl: `${o}/firm/clients/${engagementId}/invoices?paid=1&invoice=${invoice.id}`,
    cancelUrl: `${o}/firm/clients/${engagementId}/invoices?cancelled=1&invoice=${invoice.id}`,
  });
  if (!checkout.ok) throw new Error(checkout.reason);

  await admin
    .from("firm_invoices")
    .update({
      status: "sent",
      stripe_checkout_session_id: checkout.sessionId,
      stripe_hosted_invoice_url: checkout.checkoutUrl,
    })
    .eq("id", invoice.id);

  // Email the recipient.
  await sendEmail({
    to: invoice.recipient_email,
    fromName: ctx.firm.name,
    subject: `Invoice ${invoice.invoice_number} from ${ctx.firm.name}`,
    html: invoiceEmailHTML({
      firmName: ctx.firm.name,
      firmAccent: ctx.firm.accent_color ?? "#1d2843",
      invoiceNumber: invoice.invoice_number,
      totalCents: invoice.total_cents,
      currency: invoice.currency,
      checkoutUrl: checkout.checkoutUrl,
      recipientName: invoice.recipient_name,
    }),
    text: `Invoice ${invoice.invoice_number} from ${ctx.firm.name}\n\nTotal: ${formatCents(invoice.total_cents)} ${invoice.currency.toUpperCase()}\n\nPay securely: ${checkout.checkoutUrl}\n`,
    tags: {
      kind: "firm-invoice",
      firm_slug: ctx.firm.slug ?? "no-slug",
    },
  });

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    companyId: invoice.company_id,
    engagementId,
    kind: "firm.invoice_sent",
    summary: `Sent invoice ${invoice.invoice_number} (${formatCents(invoice.total_cents)}).`,
    payload: {
      invoice_id: invoice.id,
      stripe_session_id: checkout.sessionId,
    },
  });

  revalidatePath(`/firm/clients/${engagementId}/invoices`);
}

export async function voidInvoice(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!invoiceId) throw new Error("Missing invoice id.");

  await admin
    .from("firm_invoices")
    .update({
      status: "voided",
      voided_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .eq("firm_id", ctx.firm.id);

  revalidatePath(`/firm/clients/${engagementId}/invoices`);
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function invoiceEmailHTML(args: {
  firmName: string;
  firmAccent: string;
  invoiceNumber: string;
  totalCents: number;
  currency: string;
  checkoutUrl: string;
  recipientName: string | null;
}): string {
  const greet = args.recipientName
    ? `Hi ${escapeHtml(args.recipientName.split(" ")[0])},`
    : "Hi,";
  return `<!doctype html><html><body style="font-family: -apple-system, sans-serif; background-color: #F5EDD6; margin: 0; padding: 32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" style="background: #FFFFFF; border-radius: 16px; max-width: 560px;"><tr><td style="padding: 32px;">
        <div style="font-family: Georgia, serif; font-size: 18px; font-weight: 600; color: #1d2843; margin-bottom: 24px;">${escapeHtml(args.firmName)}</div>
        <h1 style="font-family: Georgia, serif; font-size: 22px; color: #1d2843; margin: 0 0 16px;">${greet}</h1>
        <p style="margin: 0 0 16px; color: #18181B; font-size: 14px; line-height: 1.6;">
          ${escapeHtml(args.firmName)} has sent you an invoice.
        </p>
        <div style="background: #F5EDD6; padding: 16px; border-radius: 12px; margin: 16px 0;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; color: #71717A;">Invoice ${escapeHtml(args.invoiceNumber)}</div>
          <div style="font-family: Georgia, serif; font-size: 28px; color: #1d2843; margin-top: 8px;">${formatCents(args.totalCents)} ${args.currency.toUpperCase()}</div>
        </div>
        <a href="${escapeAttr(args.checkoutUrl)}" style="display: inline-block; padding: 12px 24px; background: ${escapeAttr(args.firmAccent)}; color: #F5EDD6; text-decoration: none; border-radius: 999px; font-size: 14px;">Pay securely →</a>
        <hr style="border: none; border-top: 1px solid #E5E5E5; margin: 32px 0 16px;" />
        <p style="margin: 0; color: #71717A; font-size: 11px; line-height: 1.6;">
          Payments are processed by Stripe on behalf of ${escapeHtml(args.firmName)}. Your card details never touch our servers.
        </p>
      </td></tr></table>
    </td></tr></table>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
