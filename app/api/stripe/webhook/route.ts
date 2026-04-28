import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/server";
import { getStripe, isStripeConfigured } from "@/lib/stripe/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook receiver. Configure in Stripe dashboard:
 *   - URL: <site>/api/stripe/webhook
 *   - Events: customer.subscription.created/updated/deleted, invoice.paid,
 *             checkout.session.completed
 *   - Copy the signing secret into STRIPE_WEBHOOK_SECRET.
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ received: true }, { status: 200 });
  }
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const stripe = getStripe();
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bad sig" },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer.id;

      const { data: row } = await admin
        .from("subscriptions")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      if (!row) break;

      const status = sub.status as
        | "active"
        | "trialing"
        | "past_due"
        | "canceled"
        | "incomplete"
        | "incomplete_expired"
        | "unpaid"
        | "paused";
      const plan: "free" | "pro" =
        status === "active" || status === "trialing" ? "pro" : "free";

      // Newer Stripe API exposes current_period_end on subscription items
      // rather than the subscription itself. Read the first item's end.
      const firstItem = sub.items?.data?.[0];
      const periodEndUnix = firstItem?.current_period_end;
      const periodEnd = periodEndUnix
        ? new Date(periodEndUnix * 1000).toISOString()
        : null;
      const trialEnd = sub.trial_end
        ? new Date(sub.trial_end * 1000).toISOString()
        : null;

      await admin
        .from("subscriptions")
        .update({
          plan,
          status,
          stripe_subscription_id: sub.id,
          current_period_end: periodEnd,
          trial_end: trialEnd,
          cancel_at_period_end: sub.cancel_at_period_end,
        })
        .eq("user_id", row.user_id);
      break;
    }
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // Subscription will arrive via subscription.created shortly after; we
      // pre-link the customer if missing.
      if (typeof session.customer === "string" && session.customer_email) {
        await admin
          .from("subscriptions")
          .update({ stripe_customer_id: session.customer })
          .eq("stripe_customer_id", session.customer);
      }
      break;
    }
    default:
      // ignore other events
      break;
  }

  return NextResponse.json({ received: true });
}
