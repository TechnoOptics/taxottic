import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { finalizeUserTrips } from "@/lib/mileage/finalize";
import { evaluateTrackerStall, WATCH_WINDOW_MS } from "@/lib/mileage/stall";
import { notify } from "@/lib/push";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Mileage finalizer cron.
 *
 * Why this exists: a trip only materialises when an ingest call sees the
 * user has parked (last staged point >5 min old). That detection rides
 * on the device's background heartbeats, so when the app is
 * backgrounded or killed right after a drive, the heartbeats stop and
 * the just-finished drive sits OPEN in mileage_points_raw, never closing.
 * And because the live ingest only looks back ~24h, any such drive ages
 * out of that window and is stranded forever (lost mileage + deduction).
 *
 * This cron is the server-side safety net: every 10 minutes it finds
 * every driver/company with unconsumed staging points and runs the same
 * segmentation finalizer over a WIDE window. forceClose=false, so it
 * only closes trips whose last point is genuinely >5 min old, it can
 * never sever a drive that's still in progress. push=false so a one-time
 * backfill of weeks of stranded drives doesn't spam the lock screen.
 *
 * Auth: Vercel sets `x-vercel-cron: 1` on scheduled runs; we also accept
 * Authorization: Bearer $CRON_SECRET for manual/debug triggering.
 */
export async function GET(req: NextRequest) {
  const isCron = req.headers.get("x-vercel-cron") === "1";
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  const isAuthed = !!secret && auth === `Bearer ${secret}`;
  if (!isCron && !isAuthed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();

  // Collect the distinct (driver, company) pairs that have unconsumed
  // staging points. Page through so a large backlog can't hide a pair
  // past the PostgREST 1000-row cap. Only 2 columns, so this is cheap.
  const pairs = new Map<string, { driver: string; company: string }>();
  const PAGE = 1000;
  const SCAN_CAP = 50_000;
  for (let from = 0; from < SCAN_CAP; from += PAGE) {
    const { data, error } = await admin
      .from("mileage_points_raw")
      .select("driver_user_id, company_id")
      .is("consumed_at", null)
      .order("captured_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("[mileage-finalize] pair scan failed", error.message);
      break;
    }
    const rows = data ?? [];
    for (const r of rows) {
      const driver = r.driver_user_id as string;
      const company = r.company_id as string;
      pairs.set(`${driver}|${company}`, { driver, company });
    }
    if (rows.length < PAGE) break;
  }

  // Finalize each. Wide window (45 days) so drives stranded well beyond
  // the live ingest's 24h bound are recovered. Each call segments only
  // that user's pool and dedupes against existing trips by overlap, so a
  // re-run is idempotent.
  const sinceIso = new Date(
    Date.now() - 45 * 24 * 60 * 60_000,
  ).toISOString();
  let totalTrips = 0;
  let processed = 0;
  for (const { driver, company } of pairs.values()) {
    try {
      const r = await finalizeUserTrips(admin, driver, company, {
        sinceIso,
        forceClose: false,
        push: false,
      });
      totalTrips += r.tripsCreated;
      processed++;
    } catch (err) {
      console.error(
        "[mileage-finalize] finalize failed",
        driver,
        company,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // ── Tracker-stall escalation ─────────────────────────────────────
  // A driver who WAS uploading (any point in the watch window) and has
  // now been silent for hours has a dead tracker — in practice iOS
  // reverting Location "Always" → "While Using" (observed twice on a
  // real device). The in-app banner can't reach a closed app, so the
  // escalation is a push. Pure decision logic in lib/mileage/stall.ts;
  // episode state in mileage_tracker_alerts (service-role only).
  let stallsNotified = 0;
  try {
    const nowMs = Date.now();
    const watchSinceIso = new Date(nowMs - WATCH_WINDOW_MS).toISOString();
    // Distinct (driver, company) with ANY upload in the watch window —
    // deliberately not the unconsumed-pairs set above, which can miss a
    // driver whose points were all consumed before the tracker died.
    const watched = new Map<string, { driver: string; company: string }>();
    for (let from = 0; from < SCAN_CAP; from += PAGE) {
      const { data, error } = await admin
        .from("mileage_points_raw")
        .select("driver_user_id, company_id")
        .gte("created_at", watchSinceIso)
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      for (const r of data) {
        const driver = r.driver_user_id as string;
        const company = r.company_id as string;
        watched.set(`${driver}|${company}`, { driver, company });
      }
      if (data.length < PAGE) break;
    }

    for (const { driver, company } of watched.values()) {
      const { data: newest } = await admin
        .from("mileage_points_raw")
        .select("created_at")
        .eq("driver_user_id", driver)
        .eq("company_id", company)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!newest) continue;
      const lastUploadMs = Date.parse(newest.created_at as string);

      const { data: alert } = await admin
        .from("mileage_tracker_alerts")
        .select("notified_at")
        .eq("driver_user_id", driver)
        .eq("company_id", company)
        .maybeSingle();

      const decision = evaluateTrackerStall({
        lastUploadMs,
        nowMs,
        lastNotifiedMs: alert
          ? Date.parse(alert.notified_at as string)
          : null,
      });

      if (decision === "clear") {
        if (alert) {
          await admin
            .from("mileage_tracker_alerts")
            .delete()
            .eq("driver_user_id", driver)
            .eq("company_id", company);
        }
        continue;
      }
      if (decision !== "notify") continue;

      await notify(driver, {
        kind: "tracker_stalled",
        dayKey: new Date(nowMs).toISOString().slice(0, 10),
      });
      await admin.from("mileage_tracker_alerts").upsert(
        {
          driver_user_id: driver,
          company_id: company,
          stalled_since: new Date(lastUploadMs).toISOString(),
          notified_at: new Date(nowMs).toISOString(),
        },
        { onConflict: "driver_user_id,company_id" },
      );
      stallsNotified++;
    }
  } catch (err) {
    // The sweep must never break trip finalization.
    console.error(
      "[mileage-finalize] stall sweep failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  console.log(
    `[mileage-finalize] pairs=${pairs.size} processed=${processed} tripsCreated=${totalTrips} stallsNotified=${stallsNotified}`,
  );

  return NextResponse.json({
    ok: true,
    pairs: pairs.size,
    processed,
    tripsCreated: totalTrips,
  });
}
