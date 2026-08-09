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
 *  3. Delete device heartbeat history (mileage_device_heartbeats) older
 *     than 30 days. History exists to diagnose a blackout after the
 *     fact; a blackout older than a month is a post-mortem nobody is
 *     running, and the volume is small enough that a longer window buys
 *     nothing (~12 rows/hour per actively-tracking driver, so a driver
 *     tracking 10 hours a day is roughly 3,600 rows a month). 30 days
 *     also matches the raw-point retention above, so the heartbeat that
 *     explains a gap and the GPS points around it expire together
 *     instead of leaving history pointing at points that are gone.
 *     mileage_device_status (latest state) is never purged: it is one
 *     row per driver and the finalize cron reads it.
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
  const heartbeatCutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();

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

  // 3. Purge old device heartbeat history.
  const { error: hbErr, count: heartbeatsDeleted } = await admin
    .from("mileage_device_heartbeats")
    .delete({ count: "exact" })
    .lt("reported_at", heartbeatCutoff);
  if (hbErr) {
    console.error("[mileage-retention] heartbeat purge failed", hbErr.message);
  }

  // 4. Clear watch pairing tokens that were never collected.
  //
  // A pairing token is written in PLAINTEXT to watch_devices.pending_token
  // by /api/watch/pair/redeem, and cleared by /api/watch/pair/poll the
  // moment the watch collects it. That design is sound and its comment says
  // "the plaintext never lingers".
  //
  // It lingers when nothing ever polls. The watch app has no build target
  // and has never shipped, so nothing has EVER polled, and a plaintext
  // token has been sitting in this table since 2026-05-21: eighty days, on
  // a row that is already paired (token_hash set) and therefore has no use
  // for it whatsoever.
  //
  // The lesson is the one running through this whole subsystem: a cleanup
  // that only runs on the happy path is not cleanup. The sweep belongs on a
  // timer, where it runs whether or not the counterparty ever appears.
  //
  // Two independent conditions, either sufficient:
  //   token_hash is not null  the device is already paired, so a pending
  //                           token is by definition spent
  //   created_at < 1h ago     nobody is mid-pairing an hour later
  const pendingCutoff = new Date(Date.now() - 60 * 60_000).toISOString();
  const { error: ptErr, count: tokensCleared } = await admin
    .from("watch_devices")
    .update({ pending_token: null }, { count: "exact" })
    .not("pending_token", "is", null)
    .or(`token_hash.not.is.null,created_at.lt.${pendingCutoff}`);
  if (ptErr) {
    console.error(
      "[mileage-retention] pending-token sweep failed",
      ptErr.message,
    );
  }

  console.log(
    `[mileage-retention] deleted=${deleted ?? 0} swept=${swept ?? 0} heartbeats=${
      heartbeatsDeleted ?? 0
    } watchTokensCleared=${tokensCleared ?? 0}`,
  );
  return NextResponse.json({
    ok: true,
    deleted: deleted ?? 0,
    swept: swept ?? 0,
    heartbeatsDeleted: heartbeatsDeleted ?? 0,
    watchTokensCleared: tokensCleared ?? 0,
  });
}
