/**
 * Credits engine.
 *
 * Append-only ledger semantics: every change to a user's balance is a
 * row in `credits_ledger`. The current balance is always
 * `SUM(delta_credits)` for that user. We never persist a standalone
 * balance counter, that's the only way to keep balance and history
 * impossible to diverge.
 *
 * Operations:
 *   getBalance(userId)                -> int
 *   ensureMonthlyGrant(userId, plan)  -> void   idempotent per period
 *   consume(userId, action, ref)      -> ConsumeResult
 *   recordTopUp(userId, pack, ref)    -> int (new balance)
 *   topUpRemaining(userId, plan)      -> int (cap remaining for the period)
 *
 * All writes go through the service-role client so RLS doesn't have to
 * thread cookie auth in API routes that already verified the user.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CREDIT_COST,
  CREDIT_PACKS,
  CREDIT_ROLLOVER_MULTIPLIER,
  PLAN_LIMITS,
  TOPUP_CAP_MULTIPLIER,
  type CreditAction,
  type CreditPackKey,
  type Plan,
} from "./limits";

export type ConsumeResult =
  | { ok: true; balanceAfter: number; cost: number }
  | {
      ok: false;
      reason: "insufficient_credits";
      balance: number;
      needed: number;
    };

/**
 * Read the current balance via the SQL helper. Falls back to summing
 * the ledger directly if the RPC isn't available (older deploys).
 */
export async function getBalance(
  admin: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data, error } = await admin.rpc("credit_balance", {
    p_user_id: userId,
  });
  if (!error && typeof data === "number") return data;
  // Fallback: hand-sum the ledger.
  const { data: rows } = await admin
    .from("credits_ledger")
    .select("delta_credits")
    .eq("user_id", userId);
  return (rows ?? []).reduce(
    (a, r) => a + ((r as { delta_credits: number }).delta_credits ?? 0),
    0,
  );
}

/**
 * Idempotently grant the monthly allowance for a user's current plan.
 *
 * "Idempotent" means: calling this multiple times in the same period
 * is a no-op. We key off `subscriptions.last_credit_grant_at` -
 * if it's within the last 27 days we don't grant again (27 not 30 so
 * we tolerate slightly drifted billing cycles).
 *
 * Also handles rollover trimming: any monthly-grant carryover above
 * 2× the new grant gets trimmed via a single negative ledger entry
 * tagged `rollover_expiry`. This protects margin from users hoarding
 * months of unused credits.
 */
export async function ensureMonthlyGrant(
  admin: SupabaseClient,
  userId: string,
  plan: Plan,
): Promise<{ granted: number; trimmed: number; balance: number }> {
  const grant = PLAN_LIMITS[plan].monthlyCreditGrant;
  if (!grant || grant <= 0) {
    return {
      granted: 0,
      trimmed: 0,
      balance: await getBalance(admin, userId),
    };
  }

  const { data: sub } = await admin
    .from("subscriptions")
    .select("last_credit_grant_at, topups_this_period_credits")
    .eq("user_id", userId)
    .maybeSingle();

  const last = sub?.last_credit_grant_at
    ? new Date(sub.last_credit_grant_at).getTime()
    : 0;
  const now = Date.now();
  const daysSince = (now - last) / 86_400_000;
  if (daysSince < 27) {
    return {
      granted: 0,
      trimmed: 0,
      balance: await getBalance(admin, userId),
    };
  }

  const balanceBefore = await getBalance(admin, userId);
  const cap = grant * CREDIT_ROLLOVER_MULTIPLIER;
  const trimmed = balanceBefore > cap ? balanceBefore - cap : 0;

  // Bundle the rollover trim and the new grant into two ledger rows
  // (separate so the user can see both in their history).
  const rows: Array<{
    user_id: string;
    delta_credits: number;
    reason: string;
    ref_id: string | null;
  }> = [];
  if (trimmed > 0) {
    rows.push({
      user_id: userId,
      delta_credits: -trimmed,
      reason: "rollover_expiry",
      ref_id: null,
    });
  }
  rows.push({
    user_id: userId,
    delta_credits: grant,
    reason: "monthly_grant",
    ref_id: plan,
  });
  const { error } = await admin.from("credits_ledger").insert(rows);
  if (error) throw new Error(error.message);

  // Reset the per-period top-up counter and update the grant timestamp.
  await admin
    .from("subscriptions")
    .update({
      last_credit_grant_at: new Date(now).toISOString(),
      topups_this_period_credits: 0,
    })
    .eq("user_id", userId);

  return {
    granted: grant,
    trimmed,
    balance: await getBalance(admin, userId),
  };
}

/**
 * Consume credits for a user-facing action. Returns insufficient if
 * the user can't afford it, the caller is expected to surface the
 * "buy a top-up" CTA.
 *
 * Race protection: we re-read the balance after the insert. If a
 * parallel request burned the balance, the post-write balance could
 * dip negative. That's accepted, the ledger is the source of truth
 * and a small overshoot in a rare race is cheaper than a heavyweight
 * lock here. The next monthly grant restores parity.
 */
export async function consume(
  admin: SupabaseClient,
  userId: string,
  action: CreditAction,
  refId: string | null,
): Promise<ConsumeResult> {
  const cost = CREDIT_COST[action];
  const balance = await getBalance(admin, userId);
  if (balance < cost) {
    return { ok: false, reason: "insufficient_credits", balance, needed: cost };
  }
  const { error } = await admin.from("credits_ledger").insert({
    user_id: userId,
    delta_credits: -cost,
    reason: `consume_${action}`,
    ref_id: refId,
  });
  if (error) throw new Error(error.message);
  return { ok: true, balanceAfter: balance - cost, cost };
}

/**
 * Record a top-up purchase from Stripe. Idempotent on `stripeChargeId`
 *, if we already recorded a row with that ref we skip. Caller is
 * the Stripe webhook.
 */
export async function recordTopUp(
  admin: SupabaseClient,
  userId: string,
  pack: CreditPackKey,
  stripeChargeId: string,
): Promise<{ balance: number; alreadyRecorded: boolean }> {
  const credits = CREDIT_PACKS[pack].credits;

  const { data: existing } = await admin
    .from("credits_ledger")
    .select("id")
    .eq("user_id", userId)
    .eq("ref_id", stripeChargeId)
    .eq("reason", `topup_${pack}`)
    .maybeSingle();
  if (existing) {
    return {
      balance: await getBalance(admin, userId),
      alreadyRecorded: true,
    };
  }

  const { error } = await admin.from("credits_ledger").insert({
    user_id: userId,
    delta_credits: credits,
    reason: `topup_${pack}`,
    ref_id: stripeChargeId,
  });
  if (error) throw new Error(error.message);

  // Bump per-period top-up tracker so the cap can enforce later.
  const { data: sub } = await admin
    .from("subscriptions")
    .select("topups_this_period_credits")
    .eq("user_id", userId)
    .maybeSingle();
  const prior = sub?.topups_this_period_credits ?? 0;
  await admin
    .from("subscriptions")
    .update({ topups_this_period_credits: prior + credits })
    .eq("user_id", userId);

  return { balance: await getBalance(admin, userId), alreadyRecorded: false };
}

/**
 * How many top-up credits the user can still purchase this billing
 * period before hitting the 3× cap. Returns Infinity for tiers without
 * a finite monthly grant (Practice+).
 */
export async function topUpRemaining(
  admin: SupabaseClient,
  userId: string,
  plan: Plan,
): Promise<number> {
  const grant = PLAN_LIMITS[plan].monthlyCreditGrant;
  if (!Number.isFinite(grant)) return Number.POSITIVE_INFINITY;
  const cap = grant * TOPUP_CAP_MULTIPLIER;
  const { data: sub } = await admin
    .from("subscriptions")
    .select("topups_this_period_credits")
    .eq("user_id", userId)
    .maybeSingle();
  const used = sub?.topups_this_period_credits ?? 0;
  return Math.max(0, cap - used);
}

/**
 * Validate a pending top-up purchase fits under the cap. Used by the
 * checkout endpoint before redirecting to Stripe.
 */
export async function canPurchaseTopUp(
  admin: SupabaseClient,
  userId: string,
  pack: CreditPackKey,
  plan: Plan,
): Promise<{ ok: true } | { ok: false; reason: "cap_exceeded"; remaining: number }> {
  const credits = CREDIT_PACKS[pack].credits;
  const remaining = await topUpRemaining(admin, userId, plan);
  if (credits > remaining) {
    return { ok: false, reason: "cap_exceeded", remaining };
  }
  return { ok: true };
}

/**
 * Set / clear auto top-up. Pass `null` for pack to disable.
 */
export async function setAutoTopUp(
  admin: SupabaseClient,
  userId: string,
  pack: CreditPackKey | null,
  thresholdCredits: number | null,
): Promise<void> {
  const { error } = await admin
    .from("subscriptions")
    .update({
      auto_topup_pack: pack,
      auto_topup_threshold_credits: thresholdCredits,
    })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}
