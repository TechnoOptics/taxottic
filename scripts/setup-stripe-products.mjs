#!/usr/bin/env node
/**
 * One-shot setup: create the 14 Stripe products + prices that Taxottic's
 * billing flow expects, then push the resulting price IDs into Vercel
 * (production + preview) via the Vercel CLI.
 *
 * Run from a terminal that has Vercel CLI authenticated (it is, since
 * vercel link already ran):
 *
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/setup-stripe-products.mjs
 *
 * The script is idempotent: if a product with the same lookup_key
 * already exists in Stripe it reuses it instead of creating duplicates.
 *
 * Modes: detected from the key prefix.
 *   sk_test_*  → Stripe test mode (no real charges)
 *   sk_live_*  → Stripe LIVE — real customer charges enabled
 *
 * Outputs each price ID; copy/paste the summary into your records.
 */

import Stripe from "stripe";
import { execSync } from "node:child_process";

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error(
    "STRIPE_SECRET_KEY not set. Run with:\n  STRIPE_SECRET_KEY=sk_... node scripts/setup-stripe-products.mjs",
  );
  process.exit(1);
}

const isLive = KEY.startsWith("sk_live_");
const isTest = KEY.startsWith("sk_test_");
if (!isLive && !isTest) {
  console.error("Key doesn't look like a Stripe secret key (sk_live_* or sk_test_*).");
  process.exit(1);
}
console.log(
  `\n→ Stripe mode: ${isLive ? "\x1b[33mLIVE\x1b[0m (real charges)" : "TEST"}`,
);

const stripe = new Stripe(KEY, { apiVersion: "2026-04-22.dahlia" });

// Subscription tiers — 5 tiers × monthly + yearly = 10 prices.
// Yearly = ~17% off (10 months priced as 12).
const TIERS = [
  { code: "filer", name: "Filer", monthly: 4_99, yearly: 49_00 },
  { code: "solo", name: "Solo", monthly: 19_99, yearly: 199_00 },
  { code: "studio", name: "Studio", monthly: 49_00, yearly: 490_00 },
  { code: "scale", name: "Scale", monthly: 129_00, yearly: 1_290_00 },
  { code: "practice", name: "Practice", monthly: 299_00, yearly: 2_990_00 },
];

// One-time top-up credit packs — 4 prices, mode=payment.
const PACKS = [
  { code: "boost", name: "Boost", credits: 100, amount: 5_00 },
  { code: "stack", name: "Stack", credits: 500, amount: 20_00 },
  { code: "bundle", name: "Bundle", credits: 1_500, amount: 50_00 },
  { code: "power", name: "Power", credits: 5_000, amount: 150_00 },
];

/** Find a product by metadata.taxottic_code; create if missing. */
async function ensureProduct(code, name, type) {
  // Stripe doesn't allow filtering products by metadata directly, so we
  // page-list and look. There won't be many products in this account.
  for await (const p of stripe.products.list({ limit: 100, active: true })) {
    if (p.metadata?.taxottic_code === code) {
      console.log(`  reusing product '${name}' (${p.id})`);
      return p.id;
    }
  }
  const created = await stripe.products.create({
    name: `Taxottic ${name}`,
    metadata: { taxottic_code: code, taxottic_type: type },
  });
  console.log(`  created product '${name}' (${created.id})`);
  return created.id;
}

/** Find a price by lookup_key; create if missing. */
async function ensurePrice(lookupKey, productId, amountCents, recurring) {
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    limit: 1,
    active: true,
  });
  if (existing.data.length > 0) {
    const p = existing.data[0];
    console.log(`    reusing price ${lookupKey} (${p.id})`);
    return p.id;
  }
  const created = await stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: amountCents,
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    ...(recurring ? { recurring: { interval: recurring } } : {}),
  });
  console.log(`    created price ${lookupKey} (${created.id})`);
  return created.id;
}

const envOut = {};

console.log("\n→ Subscription tiers");
for (const tier of TIERS) {
  console.log(`\n${tier.name}:`);
  const productId = await ensureProduct(tier.code, tier.name, "subscription");
  envOut[`STRIPE_PRICE_${tier.code.toUpperCase()}_MONTHLY`] = await ensurePrice(
    `taxottic_${tier.code}_monthly`,
    productId,
    tier.monthly,
    "month",
  );
  envOut[`STRIPE_PRICE_${tier.code.toUpperCase()}_YEARLY`] = await ensurePrice(
    `taxottic_${tier.code}_yearly`,
    productId,
    tier.yearly,
    "year",
  );
}

console.log("\n→ Top-up credit packs");
for (const pack of PACKS) {
  console.log(`\n${pack.name} (${pack.credits} credits):`);
  const productId = await ensureProduct(
    `topup_${pack.code}`,
    `${pack.name} (${pack.credits} credits)`,
    "topup",
  );
  envOut[`STRIPE_PRICE_TOPUP_${pack.code.toUpperCase()}`] = await ensurePrice(
    `taxottic_topup_${pack.code}`,
    productId,
    pack.amount,
    null,
  );
}

console.log("\n→ All Stripe objects ready. Pushing to Vercel…\n");

// Push every env var to production + preview. We rm-then-add so the
// script is idempotent — running twice doesn't error on duplicates.
function setVercelEnv(name, value) {
  const envs = ["production", "preview"];
  for (const env of envs) {
    try {
      execSync(`npx vercel env rm ${name} ${env} --yes`, {
        stdio: ["ignore", "ignore", "ignore"],
      });
    } catch {
      /* no existing var; ignore */
    }
    try {
      execSync(`npx vercel env add ${name} ${env}`, {
        input: value + "\n",
        stdio: ["pipe", "ignore", "ignore"],
      });
    } catch (err) {
      console.error(`  ✗ ${name} ${env}: ${err.message}`);
      return false;
    }
  }
  console.log(`  ✓ ${name}`);
  return true;
}

for (const [name, value] of Object.entries(envOut)) {
  setVercelEnv(name, value);
}

console.log("\n→ Done. Summary:\n");
for (const [name, value] of Object.entries(envOut)) {
  console.log(`  ${name}=${value}`);
}
console.log(
  "\n→ Trigger a redeploy (push any commit, or use 'vercel --prod') for the new env vars to take effect.",
);
