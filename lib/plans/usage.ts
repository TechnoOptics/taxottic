import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FEATURE_GATES,
  type FeatureGates,
  PLAN_LIMITS,
  type Plan,
} from "./limits";

/**
 * Resolve the active plan for a user. Defaults to 'free' if the row is
 * missing or the subscription isn't currently active/trialing.
 *
 * Super-admins (forever-allowlist) get 'practice' implicitly so they
 * can exercise every feature without paying.
 *
 * Trial expiry: when status='trialing' and trial_end has passed, the
 * row is left intact (so we keep the audit trail of "this user had a
 * trial") but the function returns 'free'. The next checkout will
 * mark them paid.
 *
 * Backwards compat: rows whose `plan` column predates the 5-tier
 * rewrite ('pro', 'team') are normalized to the closest current tier.
 */
export async function getActivePlan(
  supabase: SupabaseClient,
  userId: string,
): Promise<Plan> {
  const { data: superAdmin } = await supabase.rpc("is_super_admin");
  if (superAdmin) {
    // QA plan preview: a super-admin can pin their effective plan to any
    // tier from the profile menu, to walk each plan's gated experience
    // and confirm the gating matches the plan. Only consulted here, in
    // the super-admin branch, so it can never be a paywall bypass for a
    // normal user. Null / unset → default to the top 'practice' tier.
    const { data: prof } = await supabase
      .from("profiles")
      .select("preview_plan")
      .eq("id", userId)
      .maybeSingle();
    return asPlanOrNull(prof?.preview_plan) ?? "practice";
  }

  const { data } = await supabase
    .from("subscriptions")
    .select("plan, status, trial_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return "free";
  if (data.status !== "active" && data.status !== "trialing") return "free";
  if (data.status === "trialing" && isTrialExpired(data.trial_end)) {
    return "free";
  }
  return normalizePlan(data.plan);
}

/**
 * Trial state for the dashboard banner. Returns days remaining
 * (rounded up) and whether the trial is still active.
 */
export type TrialState =
  | { kind: "active"; daysRemaining: number; trialEnd: string }
  | { kind: "expired"; trialEnd: string }
  | { kind: "none" };

export async function getTrialState(
  supabase: SupabaseClient,
  userId: string,
): Promise<TrialState> {
  const { data } = await supabase
    .from("subscriptions")
    .select("status, trial_end, stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();
  // Only show trial UI when the row was seeded by signup (no Stripe
  // sub yet). Once they convert, we don't want the trial banner to
  // linger.
  if (!data || data.stripe_subscription_id) return { kind: "none" };
  if (data.status !== "trialing" || !data.trial_end) return { kind: "none" };
  const expired = isTrialExpired(data.trial_end);
  if (expired) return { kind: "expired", trialEnd: data.trial_end };
  const days = Math.max(
    1,
    Math.ceil(
      (new Date(data.trial_end).getTime() - Date.now()) / 86_400_000,
    ),
  );
  return { kind: "active", daysRemaining: days, trialEnd: data.trial_end };
}

function isTrialExpired(trialEnd: string | null): boolean {
  if (!trialEnd) return false;
  return new Date(trialEnd).getTime() < Date.now();
}

/**
 * True if the current user is in the forever-allowlist super_admins
 * table. Used by paid endpoints to skip credit consumption — a super
 * admin should never be told they're out of credits.
 *
 * Uses the public.is_super_admin() RPC, which itself runs under
 * security definer and joins auth.users by email to super_admins.
 */
export async function isSuperAdmin(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_super_admin");
  if (error) return false;
  return !!data;
}

/**
 * Map legacy plan codes to current tiers. 'pro' → 'solo' (the closest
 * single-company-priced tier), 'team' → 'studio'. Anything unknown
 * falls back to 'free'.
 */
export function normalizePlan(raw: unknown): Plan {
  switch (raw) {
    case "filer":
    case "solo":
    case "studio":
    case "scale":
    case "practice":
      return raw;
    case "pro":
      return "solo";
    case "team":
      return "studio";
    default:
      return "free";
  }
}

/**
 * Validate a raw value as one of the six current plan tiers, else null.
 * Unlike normalizePlan (which coerces unknowns to 'free'), this returns
 * null for an absent/invalid value — used by the super-admin plan
 * preview so "unset" is distinguishable from "free".
 */
export function asPlanOrNull(raw: unknown): Plan | null {
  switch (raw) {
    case "free":
    case "filer":
    case "solo":
    case "studio":
    case "scale":
    case "practice":
      return raw;
    default:
      return null;
  }
}

export async function countBellaMessagesThisMonth(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const start = monthStartIso();
  const { count } = await supabase
    .from("bella_messages")
    .select("id, conversation:bella_conversations!inner(user_id)", {
      count: "exact",
      head: true,
    })
    .eq("role", "user")
    .gte("created_at", start)
    .eq("conversation.user_id", userId);
  return count ?? 0;
}

export async function countCsvImportsThisMonth(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const start = monthStartIso();
  const { count } = await supabase
    .from("bank_imports")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start)
    .eq("user_id", userId);
  return count ?? 0;
}

export async function countCompanies(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count } = await supabase
    .from("company_members")
    .select("company_id", { count: "exact", head: true })
    .eq("user_id", userId);
  return count ?? 0;
}

export async function countCompanyMembers(
  supabase: SupabaseClient,
  companyId: string,
): Promise<number> {
  const { count } = await supabase
    .from("company_members")
    .select("user_id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .neq("role", "manager");
  return count ?? 0;
}

export type LimitCheck =
  | { ok: true; remaining: number; plan: Plan }
  | {
      ok: false;
      reason: "over_limit";
      plan: Plan;
      limit: number;
      used: number;
    };

export async function checkCsvImportLimit(
  supabase: SupabaseClient,
  userId: string,
): Promise<LimitCheck> {
  const plan = await getActivePlan(supabase, userId);
  const limit = PLAN_LIMITS[plan].csvImportsPerMonth;
  if (!Number.isFinite(limit)) return { ok: true, remaining: Infinity, plan };
  const used = await countCsvImportsThisMonth(supabase, userId);
  if (used >= limit)
    return { ok: false, reason: "over_limit", plan, limit, used };
  return { ok: true, remaining: limit - used, plan };
}

export async function checkCompanyLimit(
  supabase: SupabaseClient,
  userId: string,
): Promise<LimitCheck> {
  const plan = await getActivePlan(supabase, userId);
  const limit = PLAN_LIMITS[plan].companies;
  if (!Number.isFinite(limit)) return { ok: true, remaining: Infinity, plan };
  const used = await countCompanies(supabase, userId);
  if (used >= limit)
    return { ok: false, reason: "over_limit", plan, limit, used };
  return { ok: true, remaining: limit - used, plan };
}

export async function checkInviteLimit(
  supabase: SupabaseClient,
  userId: string,
  companyId: string,
): Promise<LimitCheck> {
  const plan = await getActivePlan(supabase, userId);
  const limit = PLAN_LIMITS[plan].invitesPerCompany;
  if (!Number.isFinite(limit)) return { ok: true, remaining: Infinity, plan };
  if (limit === 0)
    return { ok: false, reason: "over_limit", plan, limit: 0, used: 0 };
  const used = await countCompanyMembers(supabase, companyId);
  if (used >= limit)
    return { ok: false, reason: "over_limit", plan, limit, used };
  return { ok: true, remaining: limit - used, plan };
}

/**
 * Resolve the current user's feature-gate map. Active plan is read
 * once, then mapped through FEATURE_GATES so callers don't each write
 * their own "if plan === ..." branch.
 */
export async function getActiveFeatureGates(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ plan: Plan; gates: FeatureGates }> {
  const plan = await getActivePlan(supabase, userId);
  return { plan, gates: FEATURE_GATES[plan] };
}

function monthStartIso(): string {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1),
  ).toISOString();
}
