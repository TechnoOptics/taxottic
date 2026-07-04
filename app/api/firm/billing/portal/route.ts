import { NextRequest, NextResponse } from "next/server";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";

export const runtime = "nodejs";

// Mint a Stripe Customer Portal session for the firm. The Portal
// is Stripe's hosted self-service surface, upgrade, downgrade,
// change card, cancel, without us having to build any of it.

export async function GET(_req: NextRequest) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const { data: sub } = await admin
    .from("firm_subscriptions")
    .select("stripe_customer_id")
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!sub?.stripe_customer_id) {
    return NextResponse.redirect(
      new URL(
        "/firm/billing?error=no_customer",
        process.env.NEXT_PUBLIC_SITE_URL ?? "https://taxottic.com",
      ),
    );
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.redirect(
      new URL(
        "/firm/billing?error=stripe_not_configured",
        process.env.NEXT_PUBLIC_SITE_URL ?? "https://taxottic.com",
      ),
    );
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://taxottic.com"}/firm/billing`,
    });
    return NextResponse.redirect(session.url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(
      new URL(
        `/firm/billing?error=${encodeURIComponent(msg)}`,
        process.env.NEXT_PUBLIC_SITE_URL ?? "https://taxottic.com",
      ),
    );
  }
}
