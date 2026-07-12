import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Raw GPS point retention. mileage_points_raw previously grew without
 * bound: consumed rows were never deleted, and stranded unconsumed rows
 * (late fixes inside already-finalized windows, parked-gap points older
 * than every finalize window) lived forever.
 *
 * Daily:
 *  1. Delete CONSUMED rows older than 30 days — the materialized trip +
 *     its mileage_points are the system of record; the raw row's job
 *     (recovery/backfill) is long done at 30 days.
 *  2. Sweep UNCONSUMED rows older than 45 days (the widest finalize
 *     window) — no finalize pass will ever pull them again, so they are
 *     dead weight that also keeps their (driver, company) pair in the
 *     finalize cron's pending scan forever. Marked consumed (no trip)
 *     rather than deleted, so a 30-day paper trail survives the sweep.
 *
 * Batched deletes (id IN subquery is unsupported by PostgREST; we page
 * on captured_at windows) so one giant delete can't hold locks.
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
  const consumedCutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const strandedCutoff = new Date(Date.now() - 45 * 86_400_000).toISOString();

  // 1. Purge old consumed rows.
  const { error: delErr, count: deleted } = await admin
    .from("mileage_points_raw")
    .delete({ count: "exact" })
    .not("consumed_at", "is", null)
    .lt("consumed_at", consumedCutoff);
  if (delErr) {
    console.error("[mileage-retention] purge failed", delErr.message);
  }

  // 2. Sweep immortal stranded rows.
  const { error: sweepErr, count: swept } = await admin
    .from("mileage_points_raw")
    .update({ consumed_at: new Date().toISOString() }, { count: "exact" })
    .is("consumed_at", null)
    .lt("captured_at", strandedCutoff);
  if (sweepErr) {
    console.error("[mileage-retention] sweep failed", sweepErr.message);
  }

  console.log(
    `[mileage-retention] deleted=${deleted ?? 0} swept=${swept ?? 0}`,
  );
  return NextResponse.json({
    ok: true,
    deleted: deleted ?? 0,
    swept: swept ?? 0,
  });
}
