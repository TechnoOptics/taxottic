import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_LIMITS, type Plan } from "./limits";

/**
 * Resolves the active plan for a user. Defaults to 'free' if the row is missing
 * or the subscription isn't currently active/trialing.
 *
 * Super-admins (forever-allowlist) get 'pro' implicitly.
 */
export async function getActivePlan(
  supabase: SupabaseClient,
  userId: string,
): Promise<Plan> {
  const { data: superAdmin } = await supabase.rpc("is_super_admin");
  if (superAdmin) return "pro";

  const { data } = await supabase
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return "free";
  if (data.status !== "active" && data.status !== "trialing") return "free";
  return (data.plan as Plan) ?? "free";
}

/**
 * Counts Bella user-role messages this calendar month for a user.
 */
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

/**
 * Counts CSV imports created this month, scoped by company. Aggregates across
 * all companies the user is in.
 */
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

/**
 * Companies the user is a member of (any role).
 */
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

/**
 * Pending + accepted member rows for a given company (excluding manager).
 */
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
  | { ok: false; reason: "over_limit"; plan: Plan; limit: number; used: number };

export async function checkBellaLimit(
  supabase: SupabaseClient,
  userId: string,
): Promise<LimitCheck> {
  const plan = await getActivePlan(supabase, userId);
  const limit = PLAN_LIMITS[plan].bellaMessagesPerMonth;
  if (!Number.isFinite(limit)) return { ok: true, remaining: Infinity, plan };
  const used = await countBellaMessagesThisMonth(supabase, userId);
  if (used >= limit) return { ok: false, reason: "over_limit", plan, limit, used };
  return { ok: true, remaining: limit - used, plan };
}

export async function checkCsvImportLimit(
  supabase: SupabaseClient,
  userId: string,
): Promise<LimitCheck> {
  const plan = await getActivePlan(supabase, userId);
  const limit = PLAN_LIMITS[plan].csvImportsPerMonth;
  if (!Number.isFinite(limit)) return { ok: true, remaining: Infinity, plan };
  const used = await countCsvImportsThisMonth(supabase, userId);
  if (used >= limit) return { ok: false, reason: "over_limit", plan, limit, used };
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
  if (used >= limit) return { ok: false, reason: "over_limit", plan, limit, used };
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
  if (limit === 0) return { ok: false, reason: "over_limit", plan, limit: 0, used: 0 };
  const used = await countCompanyMembers(supabase, companyId);
  if (used >= limit) return { ok: false, reason: "over_limit", plan, limit, used };
  return { ok: true, remaining: limit - used, plan };
}

function monthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}
