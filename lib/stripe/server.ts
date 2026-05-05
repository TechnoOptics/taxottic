import Stripe from "stripe";
import type {
  CreditPackKey,
  PriceKey,
  SubscriptionPriceKey,
} from "@/lib/plans/limits";

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
 * Stripe Price IDs are environment-specific (test vs live). We read
 * them from env so dev and prod can point at different prices.
 *
 * Required env vars:
 *   STRIPE_PRICE_FILER_MONTHLY      / _YEARLY
 *   STRIPE_PRICE_SOLO_MONTHLY       / _YEARLY
 *   STRIPE_PRICE_STUDIO_MONTHLY     / _YEARLY
 *   STRIPE_PRICE_SCALE_MONTHLY      / _YEARLY
 *   STRIPE_PRICE_PRACTICE_MONTHLY   / _YEARLY
 *   STRIPE_PRICE_TOPUP_BOOST
 *   STRIPE_PRICE_TOPUP_STACK
 *   STRIPE_PRICE_TOPUP_BUNDLE
 *   STRIPE_PRICE_TOPUP_POWER
 *
 * Legacy fallbacks:
 *   STRIPE_PRICE_PRO_MONTHLY / _YEARLY are still read for the legacy
 *   pro_monthly / pro_yearly keys so live customers don't break during
 *   migration.
 */
export function getPriceId(key: PriceKey): string {
  const env = process.env;
  const map: Record<string, string | undefined> = {
    filer_monthly: env.STRIPE_PRICE_FILER_MONTHLY,
    filer_yearly: env.STRIPE_PRICE_FILER_YEARLY,
    solo_monthly:
      env.STRIPE_PRICE_SOLO_MONTHLY ?? env.STRIPE_PRICE_PRO_MONTHLY,
    solo_yearly: env.STRIPE_PRICE_SOLO_YEARLY ?? env.STRIPE_PRICE_PRO_YEARLY,
    studio_monthly: env.STRIPE_PRICE_STUDIO_MONTHLY,
    studio_yearly: env.STRIPE_PRICE_STUDIO_YEARLY,
    scale_monthly: env.STRIPE_PRICE_SCALE_MONTHLY,
    scale_yearly: env.STRIPE_PRICE_SCALE_YEARLY,
    practice_monthly: env.STRIPE_PRICE_PRACTICE_MONTHLY,
    practice_yearly: env.STRIPE_PRICE_PRACTICE_YEARLY,
    topup_boost: env.STRIPE_PRICE_TOPUP_BOOST,
    topup_stack: env.STRIPE_PRICE_TOPUP_STACK,
    topup_bundle: env.STRIPE_PRICE_TOPUP_BUNDLE,
    topup_power: env.STRIPE_PRICE_TOPUP_POWER,
  };
  return map[key] ?? "";
}

/** Type-narrowing helpers — used by routes to validate a `price_key`. */
const SUBSCRIPTION_KEYS = new Set<SubscriptionPriceKey>([
  "filer_monthly",
  "filer_yearly",
  "solo_monthly",
  "solo_yearly",
  "studio_monthly",
  "studio_yearly",
  "scale_monthly",
  "scale_yearly",
  "practice_monthly",
  "practice_yearly",
]);

const TOPUP_KEYS = new Set<CreditPackKey>([
  "boost",
  "stack",
  "bundle",
  "power",
]);

export function isSubscriptionKey(k: string): k is SubscriptionPriceKey {
  return SUBSCRIPTION_KEYS.has(k as SubscriptionPriceKey);
}

export function isTopUpKey(k: string): k is CreditPackKey {
  return TOPUP_KEYS.has(k as CreditPackKey);
}
