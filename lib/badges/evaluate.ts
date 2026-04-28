import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lightweight badge evaluation. Reads the user's current state and inserts
 * any badge they qualify for that they don't already have. Idempotent thanks
 * to the (user_id, badge_code) unique constraint.
 *
 * Cheap enough to call on every dashboard render. We can move to event-driven
 * awards once volume justifies it.
 */
export async function evaluateBadges(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
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

  if (toInsert.length === 0) return;

  await supabase.from("badges").insert(toInsert);
}
