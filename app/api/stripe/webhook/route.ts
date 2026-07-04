import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/server";
import { getStripe, isStripeConfigured } from "@/lib/stripe/server";
import { ensureMonthlyGrant, recordTopUp } from "@/lib/plans/credits";
import { CREDIT_PACKS, type CreditPackKey, type Plan } from "@/lib/plans/limits";

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

      // Resolve which tier this subscription unlocks by mapping the
      // Stripe price ID back through the env-var price map. Falls
      // back to the legacy Pro→Solo mapping if env vars aren't set.
      const firstItem = sub.items?.data?.[0];
      const priceId = firstItem?.price?.id ?? null;
      const tier = resolveTierFromPriceId(priceId);
      const plan: Plan =
        status === "active" || status === "trialing" ? tier : "free";

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

      // Grant the new tier's monthly credits (idempotent within 27d).
      // On a tier change the old grant ages out at the next billing
      // cycle; we don't double-grant here.
      if (plan !== "free") {
        await ensureMonthlyGrant(admin, row.user_id, plan);
      }
      break;
    }
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // Pre-link the customer if missing, the subscription event will
      // arrive shortly with the same customer id.
      if (typeof session.customer === "string" && session.customer_email) {
        await admin
          .from("subscriptions")
          .update({ stripe_customer_id: session.customer })
          .eq("stripe_customer_id", session.customer);
      }

      // Top-up purchases: mode === "payment" and our metadata sets
      // `topup_pack`. Subscription checkouts have mode === "subscription"
      // and skip this branch.
      if (
        session.mode === "payment" &&
        session.metadata?.topup_pack &&
        session.metadata?.user_id &&
        session.payment_status === "paid"
      ) {
        const pack = session.metadata.topup_pack as CreditPackKey;
        if (pack in CREDIT_PACKS) {
          await recordTopUp(
            admin,
            session.metadata.user_id,
            pack,
            session.id, // checkout-session id is unique → idempotency key
          );
        }
      }
      break;
    }
    case "invoice.paid": {
      // Recurring subscription invoices land here on each renewal.
      // Re-grant the monthly credits so the user gets a fresh
      // allowance at every billing period.
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id ?? null;
      if (!customerId) break;
      const { data: row } = await admin
        .from("subscriptions")
        .select("user_id, plan")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      if (row?.user_id && row.plan && row.plan !== "free") {
        await ensureMonthlyGrant(admin, row.user_id, row.plan as Plan);
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}

/**
 * Look up which plan code a Stripe price ID belongs to. We carry the
 * map server-side so the webhook never has to trust client metadata.
 */
function resolveTierFromPriceId(priceId: string | null): Plan {
  if (!priceId) return "solo";
  const env = process.env;
  const map: Record<string, Plan> = {
    [env.STRIPE_PRICE_FILER_MONTHLY ?? ""]: "filer",
    [env.STRIPE_PRICE_FILER_YEARLY ?? ""]: "filer",
    [env.STRIPE_PRICE_SOLO_MONTHLY ?? ""]: "solo",
    [env.STRIPE_PRICE_SOLO_YEARLY ?? ""]: "solo",
    [env.STRIPE_PRICE_STUDIO_MONTHLY ?? ""]: "studio",
    [env.STRIPE_PRICE_STUDIO_YEARLY ?? ""]: "studio",
    [env.STRIPE_PRICE_SCALE_MONTHLY ?? ""]: "scale",
    [env.STRIPE_PRICE_SCALE_YEARLY ?? ""]: "scale",
    [env.STRIPE_PRICE_PRACTICE_MONTHLY ?? ""]: "practice",
    [env.STRIPE_PRICE_PRACTICE_YEARLY ?? ""]: "practice",
    // Legacy Pro prices map to Solo so existing customers don't
    // suddenly downgrade to free.
    [env.STRIPE_PRICE_PRO_MONTHLY ?? ""]: "solo",
    [env.STRIPE_PRICE_PRO_YEARLY ?? ""]: "solo",
  };
  // Drop empty-string keys so an unconfigured env var doesn't match.
  delete map[""];
  return map[priceId] ?? "solo";
}
