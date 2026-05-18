import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMyCompanies } from "@/lib/auth";
import { computeReadiness } from "@/lib/dashboard/readiness";
import { businessMileageDeductionCents } from "@/lib/mileage/deduction";
import { buildWatchSnapshot, type SnapshotInput } from "@/lib/watch/snapshot";
import { EMPTY_WATCH_SNAPSHOT } from "@/lib/watch/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/watch/snapshot
//
// The watch glance, assembled from existing well-tested cores. Auth
// via session; admin client for aggregate reads (same pattern as
// /api/push/action). EVERY section is best-effort — a failure in one
// field degrades that field to its empty default; the watch must
// never show an error. forecast / per-deduction $ / unsure
// expense+income are intentionally left to a follow-up (no fabricated
// tax numbers on the wrist); the swipe deck + pages already render
// them the moment the endpoint supplies them.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const taxYear = new Date().getUTCFullYear();
  const admin = createServiceClient();

  let readinessScore: number | null = null;
  let ytdDeductionCents = 0;
  let todayBusinessMiles = 0;
  let todayDeductionCents = 0;
  let pendingTrips: SnapshotInput["pendingTrips"] = [];
  let goals: SnapshotInput["goals"] = [];
  let latestBadgeCode: string | null = null;
  let newBadgeCode: string | null = null;
  let companyId: string | null = null;

  try {
    const companies = await getMyCompanies();
    companyId = companies[0]?.company.id ?? null;
    if (companyId) {
      readinessScore = (await computeReadiness(admin, companyId, taxYear))
        .score;
    }
  } catch {
    /* dial → 0 */
  }

  try {
    const { data } = await admin
      .from("mileage_trips")
      .select("distance_miles")
      .eq("driver_user_id", user.id)
      .eq("classification", "business")
      .eq("tax_year", taxYear);
    const miles = (data ?? []).reduce(
      (s, r) => s + Number((r as { distance_miles: number }).distance_miles || 0),
      0,
    );
    ytdDeductionCents = businessMileageDeductionCents(miles, taxYear);
  } catch {
    /* $0 */
  }

  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { data } = await admin
      .from("mileage_trips")
      .select("distance_miles")
      .eq("driver_user_id", user.id)
      .eq("classification", "business")
      .gte("started_at", startOfDay.toISOString());
    todayBusinessMiles = (data ?? []).reduce(
      (s, r) => s + Number((r as { distance_miles: number }).distance_miles || 0),
      0,
    );
    todayDeductionCents = businessMileageDeductionCents(
      todayBusinessMiles,
      taxYear,
    );
  } catch {
    /* today 0 */
  }

  try {
    const { data } = await admin
      .from("mileage_trips")
      .select("id, distance_miles, started_at")
      .eq("driver_user_id", user.id)
      .eq("classification", "unclassified")
      .order("started_at", { ascending: false })
      .limit(6);
    pendingTrips = (data ?? []).map((row) => {
      const t = row as {
        id: string;
        distance_miles: number;
        started_at: string;
      };
      const miles = Number(t.distance_miles || 0);
      return {
        id: t.id,
        distanceMiles: miles,
        startedAtISO: t.started_at,
        estDeductionCents: businessMileageDeductionCents(miles, taxYear),
      };
    });
  } catch {
    /* no pending trips */
  }

  try {
    const { data } = await admin
      .from("goals")
      .select("id, title, target_cents, saved_cents")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(5);
    goals = (data ?? []).map((row) => {
      const g = row as {
        id: string;
        title: string;
        target_cents: number;
        saved_cents: number;
      };
      return {
        id: g.id,
        title: g.title,
        savedCents: Number(g.saved_cents || 0),
        targetCents: Number(g.target_cents || 0),
      };
    });
  } catch {
    /* no goals */
  }

  try {
    const { data } = await admin
      .from("badges")
      .select("badge_code, awarded_at")
      .eq("user_id", user.id)
      .order("awarded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const b = data as { badge_code: string; awarded_at: string } | null;
    if (b) {
      latestBadgeCode = b.badge_code;
      // Fresh medal (< 10 min) → one-shot celebration on the wrist.
      const awarded = new Date(b.awarded_at).getTime();
      if (Number.isFinite(awarded) && Date.now() - awarded < 10 * 60_000) {
        newBadgeCode = b.badge_code;
      }
    }
  } catch {
    /* no badges */
  }

  try {
    return NextResponse.json(
      buildWatchSnapshot({
        readinessScore,
        ytdDeductionCents,
        todayBusinessMiles,
        todayDeductionCents,
        pendingTrips,
        pendingExpenses: [],
        goals,
        deductions: [],
        forecast: undefined,
        latestBadgeCode,
        newBadgeCode,
        companyId,
      }),
    );
  } catch {
    return NextResponse.json(EMPTY_WATCH_SNAPSHOT);
  }
}
