/**
 * Trial-fraud guard.
 *
 * Defends the 7-day Solo trial from "make a new account every Monday"
 * abuse. Approach is intentionally LIGHTWEIGHT, we don't license
 * FingerprintJS Pro; we just stack a few server-side signals into a
 * stable hash and look it up in a `device_fingerprints` table.
 *
 * Signals (all server-readable, no client trust required):
 *   - normalized client IP (last-octet zero'd to soften CGN)
 *   - hashed user-agent (without Chrome-version churn)
 *   - accept-language
 *
 * If the same device fingerprint already consumed a trial under a
 * different user, the new user's trial is revoked: subscriptions row
 * flips to plan='free', status='active', trial_end=null. Their data
 * stays, they just don't get the bonus 400 credits or Solo features
 * for free.
 *
 * Runs LAZILY on the first authenticated dashboard load, gated by
 * `profiles.trial_validated_at` so we only do the work once per user.
 */

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TrialGuardResult =
  | { kind: "first_pass"; allowed: true }
  | { kind: "revoked"; reason: "device_already_used_trial" }
  | { kind: "noop" };

/**
 * Compute a stable per-device hash from the current request.
 *
 * NORMALIZATION:
 *   - IP: zero the last octet of v4 (CGN-friendly), keep first /48 of v6
 *   - User-agent: drop versioned tokens (Chrome/120.0 → Chrome). This
 *     keeps the fingerprint stable across browser auto-updates while
 *     still differentiating Firefox vs Chrome vs Safari.
 *   - Accept-language: take the primary language tag.
 */
export async function computeDeviceFingerprint(): Promise<{
  deviceHash: string;
  ipHash: string;
}> {
  const h = await headers();
  const xff = h.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0]?.trim() || "0.0.0.0";
  const ua = h.get("user-agent") ?? "";
  const lang = (h.get("accept-language") ?? "").split(",")[0]?.split(";")[0] ?? "";

  const normalizedIp = normalizeIp(ip);
  const normalizedUa = normalizeUa(ua);

  const deviceHash = sha256(
    `${normalizedIp}|${normalizedUa}|${lang}|taxottic-fp-v1`,
  );
  const ipHash = sha256(`${normalizedIp}|taxottic-ip-v1`);
  return { deviceHash, ipHash };
}

/**
 * Run the lazy guard. Returns the outcome so the caller can surface a
 * banner if needed. Idempotent, safe to call on every dashboard
 * render; cheap because the first run sets `trial_validated_at` and
 * subsequent runs early-return `noop`.
 *
 * The admin client is service-role so it can write to
 * subscriptions + device_fingerprints regardless of RLS.
 */
export async function runTrialGuard(args: {
  admin: SupabaseClient;
  userId: string;
}): Promise<TrialGuardResult> {
  const { admin, userId } = args;

  // Already validated? Skip, this is the hot path on every dashboard load.
  const { data: profile } = await admin
    .from("profiles")
    .select("trial_validated_at")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.trial_validated_at) {
    return { kind: "noop" };
  }

  const { deviceHash, ipHash } = await computeDeviceFingerprint();

  const { data: existing } = await admin
    .from("device_fingerprints")
    .select("id, trial_consumed_user_id")
    .eq("device_hash", deviceHash)
    .maybeSingle();

  let result: TrialGuardResult = { kind: "first_pass", allowed: true };

  if (existing && existing.trial_consumed_user_id && existing.trial_consumed_user_id !== userId) {
    // Different user, same device → revoke this user's trial.
    await admin
      .from("subscriptions")
      .update({
        plan: "free",
        status: "active",
        trial_end: null,
      })
      .eq("user_id", userId);
    result = { kind: "revoked", reason: "device_already_used_trial" };
  } else if (!existing) {
    // First time we've seen this fingerprint → claim the trial.
    await admin.from("device_fingerprints").insert({
      device_hash: deviceHash,
      ip_hash: ipHash,
      trial_consumed_user_id: userId,
    });
  }
  // else: same user revisiting from same device, no-op.

  // Mark profile validated so future dashboard hits skip this whole flow.
  await admin
    .from("profiles")
    .update({ trial_validated_at: new Date().toISOString() })
    .eq("id", userId);

  return result;
}

function normalizeIp(ip: string): string {
  // IPv4: 1.2.3.4 → 1.2.3.0
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`;
  // IPv6: take first 48 bits (3 hextets)
  if (ip.includes(":")) {
    const parts = ip.split(":").filter(Boolean);
    return parts.slice(0, 3).join(":");
  }
  return ip;
}

function normalizeUa(ua: string): string {
  // Strip /version tokens but keep the engine names: "Chrome/120.0.6099"
  // becomes "Chrome", but " Mac OS X 10_15_7" stays so a Mac vs PC
  // user on the same network still differs.
  return ua.replace(/\/[\d.]+/g, "");
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
