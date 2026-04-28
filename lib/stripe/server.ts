import Stripe from "stripe";

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is missing. Add it to .env.local before using billing.",
    );
  }
  cached = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  return cached;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Stripe Price IDs are environment-specific (test vs live mode). We read them
 * from env so dev and prod can point at different prices.
 *
 * Set STRIPE_PRICE_PRO_MONTHLY and STRIPE_PRICE_PRO_YEARLY in .env.local.
 */
export function getPriceId(key: "pro_monthly" | "pro_yearly"): string {
  const map = {
    pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? "",
    pro_yearly: process.env.STRIPE_PRICE_PRO_YEARLY ?? "",
  };
  return map[key];
}
