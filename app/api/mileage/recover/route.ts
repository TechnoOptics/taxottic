import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMyCompanies } from "@/lib/auth";
import { finalizeUserTrips } from "@/lib/mileage/finalize";
import {
  clusterByCaptureGap,
  shouldForceCloseRecovery,
  summariseRecovery,
  RECOVERY_WINDOW_DAYS,
} from "@/lib/mileage/recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/mileage/recover
//
// The driver-triggered sweep behind "Recover lost drives".
//
// WHY IT IS NOT JUST ANOTHER CALL TO /api/mileage/finalize
//
// Two differences, both load-bearing:
//
//   1. The window. The live ingest path re-segments only the last 24h and
//      the page-render pass only 7 days, so a drive older than that is
//      invisible to every path a driver can trigger. This sweep uses the
//      same 45-day window the cron does, which is as wide as the data
//      goes: the retention cron tombstones unconsumed rows past 45 days,
//      so searching further would be searching nothing.
//
//   2. The tail-close. A drive whose phone died, was force-quit, or lost
//      the app mid-return never dwells, so it never closes on its own.
//      Recovery has to be able to force that, or it cannot recover the
//      exact case the driver is complaining about.
//
// WHAT IT DELIBERATELY WILL NOT DO
//
// It will not make a number appear for points it cannot honestly turn
// into a drive. Measured on this driver's own pool, 2026-08-17: one real
// 19.56 mi drive was delivered THREE times (a live whole-second stream
// plus two replayed copies offset .297 and .928 sub-second), interleaved
// so consecutive rows alternate between points 4.6 km apart. Summed
// naively that is 1,527 miles in 25 minutes, which the insert gate
// refuses. Dropping the impossible transitions and segmenting the
// survivors yields 23.14 mi against a true 19.56, an 18% fabrication that
// looks entirely plausible at a 56 mph average.
//
// So the sweep runs the ordinary, fully-guarded finalizer and then
// REPORTS what it could not consume and why. A fabricated mile is worse
// than a missing one, and a control that says "done" over a pool it
// silently failed to recover is the failure this codebase keeps shipping.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Same company the page renders, chosen the same way, so recovery can
  // never materialise drives into a company the driver is not looking at.
  const memberships = await getMyCompanies();
  const companyId = memberships[0]?.company?.id;
  if (!companyId) {
    return NextResponse.json({ error: "no_company" }, { status: 400 });
  }

  const admin = createServiceClient();
  const sinceIso = new Date(
    Date.now() - RECOVERY_WINDOW_DAYS * 86_400_000,
  ).toISOString();

  /** Every still-unconsumed point in the window, paged past the
   *  PostgREST 1000-row cap. Ordered by captured_at because the cluster
   *  pass below is only meaningful on a time-ordered stream. */
  const readPool = async () => {
    const PAGE = 1000;
    const MAX = 50_000;
    const rows: Array<{
      captured_at: string;
      lat: number;
      lng: number;
      speed_mps: number | null;
      accuracy_m: number | null;
    }> = [];
    for (let from = 0; from < MAX; from += PAGE) {
      const { data, error } = await admin
        .from("mileage_points_raw")
        .select("captured_at, lat, lng, speed_mps, accuracy_m")
        .eq("driver_user_id", user.id)
        .eq("company_id", companyId)
        .is("consumed_at", null)
        .gte("captured_at", sinceIso)
        .order("captured_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const page = data ?? [];
      rows.push(...(page as typeof rows));
      if (page.length < PAGE) break;
    }
    // speed_mps and accuracy_m are NOT optional decoration. segmentTrips
    // drops fixes worse than MAX_ACCURACY_M before it segments anything,
    // and derives "moving" from reported speed when it is above zero.
    // Diagnosing from lat/lng/ts alone asks the segmenter a question about
    // a stream the pipeline never sees, and it answers differently: on
    // this driver's own pool it turned two clusters that really do produce
    // trips into two that do not.
    return rows.map((r) => ({
      lat: r.lat,
      lng: r.lng,
      ts: Date.parse(r.captured_at),
      speedMps: r.speed_mps ?? undefined,
      accuracyM: r.accuracy_m ?? undefined,
    }));
  };

  try {
    const before = await readPool();
    const newestUnconsumedTs =
      before.length > 0 ? before[before.length - 1].ts : null;

    // Force the close only once the newest staged point is past the
    // segmenter's dwell. Pressing this mid-drive must not sever the drive
    // the driver is on; that drive is reported as still recording.
    const forcedClose = shouldForceCloseRecovery({
      newestUnconsumedTs,
      nowMs: Date.now(),
    });

    const result = await finalizeUserTrips(admin, user.id, companyId, {
      sinceIso,
      forceClose: forcedClose,
      // A sweep over weeks of backlog must not spray the lock screen with
      // one push per recovered drive. Same reasoning as the cron.
      push: false,
    });

    // Diagnose what SURVIVED the sweep. Reading the pool again rather than
    // subtracting is deliberate: the finalizer consumes by time range, so
    // the only trustworthy answer to "what is still stranded" is to ask.
    const after = await readPool();
    const remaining = summariseRecovery(
      clusterByCaptureGap(after),
      Date.now(),
    );

    console.log(
      `[mileage/recover] user=${user.id} pool_before=${before.length} ` +
        `forced=${forcedClose} trips=${result.tripsCreated} ` +
        `pool_after=${remaining.totalPoints} ` +
        `stationary=${remaining.stationaryPoints} ` +
        `recoverable=${remaining.recoverablePoints} ` +
        `contaminated=${remaining.contaminatedPoints} ` +
        `worst_mph=${remaining.worstMph}`,
    );

    return NextResponse.json({
      ok: true,
      pointsFound: before.length,
      forcedClose,
      tripsCreated: result.tripsCreated,
      milesRecovered: Number(result.businessMiles.toFixed(2)),
      remaining: {
        total: remaining.totalPoints,
        stationary: remaining.stationaryPoints,
        recoverable: remaining.recoverablePoints,
        recording: remaining.recordingPoints,
        contaminated: remaining.contaminatedPoints,
        contaminatedClusters: remaining.contaminatedClusters,
        worstMph: remaining.worstMph,
        contaminatedSpans: remaining.contaminatedSpans.map((s) => ({
          startIso: new Date(s.startTs).toISOString(),
          endIso: new Date(s.endTs).toISOString(),
          points: s.points,
        })),
      },
    });
  } catch (e) {
    console.error(
      "[mileage/recover] sweep failed",
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json({ error: "recover_failed" }, { status: 500 });
  }
}
