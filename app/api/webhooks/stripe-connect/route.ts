import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { getStripeForWebhook } from "@/lib/firm/payments/stripe-connect";
import { logFirmActivity } from "@/lib/firm/activity";
import { syncStripeConnection } from "@/lib/stripe-connect/sync";

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
// PLUS real-time bank-source sync (see maybeSyncStripeBank): when a
// user has connected their OWN Stripe account as a transaction source
// (bank_connections.provider="stripe"), Stripe delivers that account's
// activity here with event.account=acct_…. On any event that means a
// new balance transaction posted, we run an incremental sync NOW so the
// connected Stripe pulls every transaction as it happens instead of
// waiting for the weekly cron.
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
    // Real-time pull for a connected Stripe bank source. Runs before
    // the firm-invoice switch and is a no-op for events whose
    // event.account isn't a linked bank connection.
    await maybeSyncStripeBank(admin, event);

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
     
    console.error("[stripe-connect webhook] handler error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "handler error" },
      { status: 500 },
    );
  }
}

// Connect events that mean a new balance_transaction has posted to the
// connected account (or is about to settle), so the bank source should
// re-pull. Stripe has no single "balance_transaction.created" event, so
// we trigger off the underlying objects: charges (income), refunds,
// disputes (adjustments/fees), payouts (settlement), and balance.available
// as a catch-all when funds move pending → available. Kept as a string
// Set so it never fights the installed @types/stripe event-literal union.
const BANK_SYNC_EVENTS = new Set<string>([
  "charge.succeeded",
  "charge.captured",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.funds_withdrawn",
  "payout.paid",
  "balance.available",
]);

/**
 * If this event belongs to a connected Stripe account that a user has
 * linked as a transaction source, run an immediate incremental sync.
 *
 * force:true bypasses syncStripeConnection's monthly cost throttle —
 * same rationale as the Plaid SYNC_UPDATES_AVAILABLE webhook: the event
 * only fires when there's genuinely new activity, so the throttle (which
 * exists to stop the blind weekly cron from redundant calls) must not
 * swallow it. The cursor in syncStripeConnection makes duplicate events
 * (e.g. charge.succeeded + a later balance.available for the same
 * payment) cheap no-ops — zero new rows. Errors are swallowed onto the
 * connection row so we still ack the webhook (a 500 would make Stripe
 * retry the whole event, including the firm-invoice handling).
 */
async function maybeSyncStripeBank(
  admin: SupabaseClient,
  event: Stripe.Event,
): Promise<void> {
  const accountId = event.account; // acct_… of the connected source
  if (!accountId || !BANK_SYNC_EVENTS.has(event.type)) return;

  const { data: conn } = await admin
    .from("bank_connections")
    .select("id")
    .eq("provider", "stripe")
    .eq("external_item_id", accountId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!conn) return;

  try {
    await syncStripeConnection(admin, conn.id as string, { force: true });
  } catch (err) {
    await admin
      .from("bank_connections")
      .update({
        status: "error",
        last_error: err instanceof Error ? err.message : String(err),
      })
      .eq("id", conn.id as string);
  }
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
