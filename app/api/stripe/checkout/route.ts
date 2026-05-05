import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  getPriceId,
  getStripe,
  isStripeConfigured,
  isSubscriptionKey,
  isTopUpKey,
} from "@/lib/stripe/server";
import { canPurchaseTopUp } from "@/lib/plans/credits";
import { getActivePlan } from "@/lib/plans/usage";

export const runtime = "nodejs";

type Body = {
  /** Subscription tier (filer_monthly, solo_yearly, …) OR a top-up
   *  pack key (boost, stack, bundle, power). */
  price_key?: string;
};

/**
 * Single endpoint for both subscription and top-up checkout. Direction
 * is inferred from `price_key`:
 *   - subscription_* keys go to mode=subscription
 *   - boost / stack / bundle / power go to mode=payment with metadata
 *     { topup_pack, user_id } so the webhook can record credits idempotently
 *     against the checkout-session id.
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured yet." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const rawKey = body.price_key ?? "solo_monthly";

  const isTopUp = isTopUpKey(rawKey);
  const isSub = isSubscriptionKey(rawKey);
  if (!isTopUp && !isSub) {
    return NextResponse.json(
      { error: `Unknown price_key ${rawKey}` },
      { status: 400 },
    );
  }

  const priceId = isTopUp ? getPriceId(`topup_${rawKey}`) : getPriceId(rawKey);
  if (!priceId) {
    return NextResponse.json(
      { error: `Price not configured for ${rawKey}` },
      { status: 503 },
    );
  }

  const admin = createServiceClient();

  // Top-up cap check before we ever spin up a Stripe session — saves a
  // refund cycle when a user hits 3× their monthly grant.
  if (isTopUp) {
    const plan = await getActivePlan(supabase, user.id);
    if (plan === "free") {
      return NextResponse.json(
        {
          error:
            "Top-ups are available on paid tiers only. Pick a subscription first.",
        },
        { status: 402 },
      );
    }
    const guard = await canPurchaseTopUp(admin, user.id, rawKey, plan);
    if (!guard.ok) {
      return NextResponse.json(
        {
          error: `You've used your top-up allowance for this billing period (3× your monthly credits). ${guard.remaining} credits left to buy. Upgrade for more headroom.`,
          code: "topup_cap_exceeded",
          remaining: guard.remaining,
        },
        { status: 402 },
      );
    }
  }

  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const stripe = getStripe();
  let customerId = sub?.stripe_customer_id ?? undefined;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await admin
      .from("subscriptions")
      .upsert({
        user_id: user.id,
        stripe_customer_id: customerId,
        plan: "free",
        status: "active",
      });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: isTopUp ? "payment" : "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${siteUrl}/billing?status=success`,
    cancel_url: `${siteUrl}/billing?status=cancel`,
    allow_promotion_codes: !isTopUp,
    metadata: isTopUp
      ? { topup_pack: rawKey, user_id: user.id }
      : { subscription_key: rawKey, user_id: user.id },
  });

  return NextResponse.json({ url: session.url });
}
