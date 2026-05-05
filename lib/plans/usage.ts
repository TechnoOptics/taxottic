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
 * Backwards compat: rows whose `plan` column predates the 5-tier
 * rewrite ('pro', 'team') are normalized to the closest current tier.
 */
export async function getActivePlan(
  supabase: SupabaseClient,
  userId: string,
): Promise<Plan> {
  const { data: superAdmin } = await supabase.rpc("is_super_admin");
  if (superAdmin) return "practice";

  const { data } = await supabase
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return "free";
  if (data.status !== "active" && data.status !== "trialing") return "free";
  return normalizePlan(data.plan);
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
