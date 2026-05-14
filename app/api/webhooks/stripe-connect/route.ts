import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/server";
import { getStripeForWebhook } from "@/lib/firm/payments/stripe-connect";
import { logFirmActivity } from "@/lib/firm/activity";

export const runtime = "nodejs";

// Stripe Connect webhook handler.
//
// We listen to a small set of events:
//   - account.updated → mirror charges_enabled / payouts_enabled
//     / details_submitted onto firm_stripe_accounts.
//   - checkout.session.completed → mark the invoice paid.
//   - charge.refunded → mark the invoice refunded.
//   - payment_intent.payment_failed → mark the invoice failed.
//
// Auth: Stripe signs the body with the endpoint signing secret.
// We use stripe.webhooks.constructEvent() to verify.

export async function POST(req: NextRequest) {
  const stripe = getStripeForWebhook();
  if (!stripe) {
    return NextResponse.json({ error: "stripe not configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "STRIPE_CONNECT_WEBHOOK_SECRET not configured" },
      { status: 503 },
    );
  }

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid sig" },
      { status: 400 },
    );
  }

  const admin = createServiceClient();
  try {
    switch (event.type) {
      case "account.updated": {
        const acct = event.data.object as Stripe.Account;
        await admin
          .from("firm_stripe_accounts")
          .update({
            charges_enabled: acct.charges_enabled ?? false,
            payouts_enabled: acct.payouts_enabled ?? false,
            details_submitted: acct.details_submitted ?? false,
            country: acct.country ?? null,
            default_currency: acct.default_currency ?? null,
          })
          .eq("stripe_account_id", acct.id);
        break;
      }
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const invoiceId = session.metadata?.firm_invoice_id;
        const paymentIntent =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id ?? null;
        if (!invoiceId) break;
        const { data: inv } = await admin
          .from("firm_invoices")
          .select("id, firm_id, engagement_id, company_id, invoice_number, total_cents, currency")
          .eq("id", invoiceId)
          .maybeSingle();
        if (!inv) break;
        await admin
          .from("firm_invoices")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            stripe_payment_intent_id: paymentIntent,
          })
          .eq("id", inv.id);
        await logFirmActivity({
          client: admin,
          firmId: inv.firm_id,
          companyId: inv.company_id,
          engagementId: inv.engagement_id,
          kind: "firm.payment_received",
          summary: `Payment received for invoice ${inv.invoice_number}: ${formatCents(inv.total_cents)} ${inv.currency.toUpperCase()}.`,
          payload: {
            invoice_id: inv.id,
            stripe_session_id: session.id,
            payment_intent: paymentIntent,
          },
          actorSide: "system",
        });
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntent =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id ?? null;
        if (!paymentIntent) break;
        const { data: inv } = await admin
          .from("firm_invoices")
          .select("id, firm_id, engagement_id, company_id, invoice_number, total_cents")
          .eq("stripe_payment_intent_id", paymentIntent)
          .maybeSingle();
        if (!inv) break;
        await admin
          .from("firm_invoices")
          .update({
            status: "refunded",
            refunded_at: new Date().toISOString(),
          })
          .eq("id", inv.id);
        await logFirmActivity({
          client: admin,
          firmId: inv.firm_id,
          companyId: inv.company_id,
          engagementId: inv.engagement_id,
          kind: "firm.note_added",
          summary: `Refund processed for invoice ${inv.invoice_number}.`,
          payload: { invoice_id: inv.id, payment_intent: paymentIntent },
          actorSide: "system",
        });
        break;
      }
      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const invoiceId = pi.metadata?.firm_invoice_id;
        if (!invoiceId) break;
        await admin
          .from("firm_invoices")
          .update({ status: "failed" })
          .eq("id", invoiceId);
        break;
      }
      default:
        break;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[stripe-connect webhook] handler error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "handler error" },
      { status: 500 },
    );
  }
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
