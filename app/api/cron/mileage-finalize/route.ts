import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { finalizeUserTrips } from "@/lib/mileage/finalize";

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

  console.log(
    `[mileage-finalize] pairs=${pairs.size} processed=${processed} tripsCreated=${totalTrips}`,
  );

  return NextResponse.json({
    ok: true,
    pairs: pairs.size,
    processed,
    tripsCreated: totalTrips,
  });
}
