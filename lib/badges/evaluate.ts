import type { SupabaseClient } from "@supabase/supabase-js";
import { notify } from "@/lib/push";
import { BADGES } from "./catalog";

/**
 * Lightweight badge evaluation. Reads the user's current state and inserts
 * any badge they qualify for that they don't already have. Idempotent thanks
 * to the (user_id, badge_code) unique constraint.
 *
 * Returns the codes that should pop the celebration overlay ONCE:
 *   1. Insert any newly-earned badges (no-op if already present).
 *   2. UPDATE … SET celebrated_at = now() WHERE celebrated_at IS NULL
 *      RETURNING badge_code, atomically claim the celebration window.
 *
 * The celebrated_at column was added in
 * 20260520000001_badges_celebrated_at. Before that, the contract relied
 * on "newly inserted = newly celebrated", which silently re-fired on
 * every dashboard render if the insert ever raced or returned cached
 * existence in an unexpected order. The explicit flag makes the
 * one-shot semantics atomic and survives reload mid-celebration.
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
    { count: bizTripCount },
    { count: donationCount },
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
    // A logged BUSINESS drive, the actual mileage-deduction milestone,
    // distinct from the "vehicle" badge which only checks the profile
    // flag. Keyed on driver_user_id (mileage_trips has no user_id).
    supabase
      .from("mileage_trips")
      .select("*", { count: "exact", head: true })
      .eq("driver_user_id", userId)
      .eq("classification", "business"),
    // Any logged charitable gift → the "Philanthropist" badge. Spans all
    // years (one act of generosity earns it for good).
    supabase
      .from("charitable_donations")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
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
  if ((bizTripCount ?? 0) > 0) earned.push({ badge_code: "first_drive" });

  if ((invitesCount ?? 0) > 0) earned.push({ badge_code: "team_grower" });

  if ((donationCount ?? 0) > 0) earned.push({ badge_code: "philanthropist" });

  const toInsert = earned
    .filter((e) => !have.has(e.badge_code))
    .map((e) => ({ user_id: userId, badge_code: e.badge_code }));

  // Phase 1, insert any newly-earned badges. Best-effort: if the
  // insert fails (RLS quirk in a page-render context, transient DB
  // error, etc.) we still want to claim+return whatever's
  // uncelebrated below, so don't bail out here.
  if (toInsert.length > 0) {
    try {
      await supabase.from("badges").insert(toInsert);
      for (const b of toInsert) {
        await notify(userId, {
          kind: "badge_awarded",
          badgeLabel: BADGES[b.badge_code]?.title ?? b.badge_code,
          badgeCode: b.badge_code,
        });
      }
    } catch {
      // ignore, atomic claim below is the source of truth
    }
  }

  // Phase 2, atomically claim the celebration window. PostgREST's
  // update().select() returns the rows it just touched, so we get
  // exactly the codes that transitioned from "uncelebrated" to
  // "celebrated" on THIS call. Concurrent renders racing the same
  // user only see the codes their UPDATE actually touched (the
  // other one finds celebrated_at IS NOT NULL and skips). That's
  // the one-shot semantics the dashboard depends on.
  const { data: claimed } = await supabase
    .from("badges")
    .update({ celebrated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("celebrated_at", null)
    .select("badge_code");
  return (claimed ?? []).map((b) => b.badge_code as string);
}
