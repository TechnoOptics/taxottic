import type { SupabaseClient } from "@supabase/supabase-js";
import { notify } from "@/lib/push";
import { BADGES } from "./catalog";

/**
 * Lightweight badge evaluation. Reads the user's current state and inserts
 * any badge they qualify for that they don't already have. Idempotent thanks
 * to the (user_id, badge_code) unique constraint.
 *
 * Returns the codes that were JUST awarded on this run so the caller can
 * trigger a celebration UI. On any subsequent render the badges already
 * exist and the returned array is empty - which is exactly the
 * once-and-only-once trigger we need.
 *
 * Cheap enough to call on every dashboard render. We can move to event-driven
 * awards once volume justifies it.
 */
export async function evaluateBadges(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const taxYear = new Date().getUTCFullYear();
  const earned: { badge_code: string; context?: object }[] = [];

  const [
    { data: existing },
    { data: companyMembers },
    { count: incomeCount },
    { count: expenseCount },
    { data: incomeMonths },
    { data: profile },
    { data: goalsAll },
    { count: goalsDone },
    { count: bellaConvos },
    { data: businessProfiles },
    { count: invitesCount },
  ] = await Promise.all([
    supabase.from("badges").select("badge_code").eq("user_id", userId),
    supabase.from("company_members").select("company_id").eq("user_id", userId),
    supabase
      .from("monthly_income")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("tax_year", taxYear),
    supabase
      .from("monthly_expenses")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("tax_year", taxYear),
    supabase
      .from("monthly_income")
      .select("month")
      .eq("user_id", userId)
      .eq("tax_year", taxYear),
    supabase
      .from("tax_profiles")
      .select("user_id")
      .eq("user_id", userId)
      .eq("tax_year", taxYear)
      .maybeSingle(),
    supabase.from("goals").select("status").eq("user_id", userId),
    supabase
      .from("goals")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "completed"),
    supabase
      .from("bella_conversations")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("business_profiles")
      .select("has_home_office, has_vehicle"),
    supabase
      .from("invitations")
      .select("*", { count: "exact", head: true })
      .eq("invited_by", userId),
  ]);

  const have = new Set((existing ?? []).map((b) => b.badge_code));

  if ((companyMembers?.length ?? 0) > 0) earned.push({ badge_code: "first_company" });
  if (profile) earned.push({ badge_code: "first_forecast_setup" });
  if ((incomeCount ?? 0) > 0) earned.push({ badge_code: "first_income" });
  if ((expenseCount ?? 0) > 0) earned.push({ badge_code: "first_expense" });

  const monthsCovered = new Set((incomeMonths ?? []).map((r) => r.month)).size;
  if (monthsCovered >= 6) earned.push({ badge_code: "six_months_data" });

  if ((goalsAll?.length ?? 0) > 0) earned.push({ badge_code: "goal_setter" });
  if ((goalsDone ?? 0) > 0) earned.push({ badge_code: "goal_crusher" });

  if ((bellaConvos ?? 0) > 0) earned.push({ badge_code: "bella_curious" });

  if ((businessProfiles ?? []).some((b) => b.has_home_office))
    earned.push({ badge_code: "home_office" });
  if ((businessProfiles ?? []).some((b) => b.has_vehicle))
    earned.push({ badge_code: "vehicle" });

  if ((invitesCount ?? 0) > 0) earned.push({ badge_code: "team_grower" });

  const toInsert = earned
    .filter((e) => !have.has(e.badge_code))
    .map((e) => ({ user_id: userId, badge_code: e.badge_code }));

  if (toInsert.length === 0) return [];

  // Best-effort: if the insert fails (e.g., RLS quirk in server-action /
  // page-render context), don't crash the dashboard render. Return the
  // codes we attempted so the UI can celebrate even if the insert
  // raced.
  try {
    await supabase.from("badges").insert(toInsert);
    // Push the award (Phase 3 producer). notify() is idempotent
    // (notification_log dedupe) and a clean no-op until APNs/FCM
    // creds exist, so awaiting here is safe + cheap; toInsert is
    // non-empty only the once a badge is first earned.
    for (const b of toInsert) {
      await notify(userId, {
        kind: "badge_awarded",
        badgeLabel: BADGES[b.badge_code]?.title ?? b.badge_code,
        badgeCode: b.badge_code,
      });
    }
  } catch {
    // ignore
  }
  return toInsert.map((b) => b.badge_code);
}
