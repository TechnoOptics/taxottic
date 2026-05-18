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
// The watch glance, assembled from existing well-tested cores
// (readiness, mileage deduction). Auth via session; admin client for
// the aggregate reads (same validate-session → service-read pattern
// as /api/push/action). EVERY section is best-effort: a failure in
// one field degrades that field to its empty default rather than
// failing the whole sync — the watch should never show an error.
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
  let ytdBusinessMiles = 0;
  let ytdDeductionCents = 0;
  let pendingTrip: SnapshotInput["pendingTrip"] = null;
  let latestBadgeCode: string | null = null;

  try {
    const companies = await getMyCompanies();
    const companyId = companies[0]?.company.id;
    if (companyId) {
      const r = await computeReadiness(admin, companyId, taxYear);
      readinessScore = r.score;
    }
  } catch {
    /* readiness unavailable — dial shows 0 */
  }

  try {
    const { data } = await admin
      .from("mileage_trips")
      .select("distance_miles")
      .eq("driver_user_id", user.id)
      .eq("classification", "business")
      .eq("tax_year", taxYear);
    ytdBusinessMiles = (data ?? []).reduce(
      (sum, row) => sum + Number((row as { distance_miles: number }).distance_miles || 0),
      0,
    );
    ytdDeductionCents = businessMileageDeductionCents(
      ytdBusinessMiles,
      taxYear,
    );
  } catch {
    /* no trips / table unreachable — $0 */
  }

  try {
    const { data } = await admin
      .from("mileage_trips")
      .select("id, distance_miles, started_at")
      .eq("driver_user_id", user.id)
      .eq("classification", "unclassified")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const t = data as {
        id: string;
        distance_miles: number;
        started_at: string;
      };
      pendingTrip = {
        id: t.id,
        distanceMiles: Number(t.distance_miles || 0),
        startedAtISO: t.started_at,
        estDeductionCents: businessMileageDeductionCents(
          Number(t.distance_miles || 0),
          taxYear,
        ),
      };
    }
  } catch {
    /* no pending trip */
  }

  try {
    const { data } = await admin
      .from("badges")
      .select("badge_code")
      .eq("user_id", user.id)
      .order("awarded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestBadgeCode =
      (data as { badge_code: string } | null)?.badge_code ?? null;
  } catch {
    /* no badges */
  }

  try {
    const snapshot = buildWatchSnapshot({
      readinessScore,
      ytdBusinessMiles,
      ytdDeductionCents,
      pendingTrip,
      latestBadgeCode,
    });
    return NextResponse.json(snapshot);
  } catch {
    return NextResponse.json(EMPTY_WATCH_SNAPSHOT);
  }
}
