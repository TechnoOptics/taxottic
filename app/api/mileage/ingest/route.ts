import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { type GpsPoint } from "@/lib/mileage/segmentation";
import { finalizeUserTrips } from "@/lib/mileage/finalize";
import { parseSignalReport } from "@/lib/mileage/signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/mileage/ingest
//
// Contract (May 25 2026 rewrite):
//   1. Persist every incoming point to mileage_points_raw (staging).
//   2. Hand off to finalizeUserTrips(), which pulls the still-unconsumed
//      staging pool, runs segmentTrips() over it, and materialises any
//      CLOSED trip into mileage_trips + mileage_points (marking the
//      contributing staging rows consumed). Points belonging to an OPEN
//      (still-moving) trip stay staged for the next batch, nothing is
//      dropped.
//
// The segmenter needs a 5-min stationary dwell (or 8-min capture gap)
// to close a trip. The device's @capgo plugin flushes every ~2 min
// mid-drive, so a single batch is rarely a complete drive on its own -
// that's why we re-segment the whole unconsumed pool every call.
//
// Bound: ingest segments only the last ~24h of staging (per-request
// cost). Drives that don't close within that window are picked up by
// the mileage-finalize CRON, which segments a wide window and closes
// parked-but-open trips even when the device has stopped heartbeating
// (app backgrounded/killed). See app/api/cron/mileage-finalize.

type Body = {
  companyId?: string;
  points?: GpsPoint[];
  // Set by the client when the user toggles tracking OFF (the final
  // flush in stopMileageTracking). Forces the tail-close so an
  // in-progress trip materializes the instant the user stops, instead
  // of being stranded open until the next heartbeat (which won't come,
  // because the flush timer was just cleared).
  sessionEnded?: boolean;
  // Vehicle-presence and motion observations drained from the native
  // producers' buffer, alongside the points they belong with. Rides on
  // this route deliberately rather than getting its own: the producers
  // already flush here, and a second parallel ingest path would be one
  // more thing to keep in step. Shape: `SignalReport` in lib/mileage/
  // signals.ts. Optional, and an older build sends none.
  signals?: unknown;
};

function isFinitePoint(p: unknown): p is GpsPoint {
  if (!p || typeof p !== "object") return false;
  const q = p as Record<string, unknown>;
  return (
    typeof q.lat === "number" &&
    Number.isFinite(q.lat) &&
    typeof q.lng === "number" &&
    Number.isFinite(q.lng) &&
    typeof q.ts === "number" &&
    Number.isFinite(q.ts)
  );
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    console.log("[ingest] 401, no session");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    console.log("[ingest] 400, invalid_json");
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const companyId = String(body.companyId ?? "").trim();
  const sessionEnded = body.sessionEnded === true;
  const rawPoints = Array.isArray(body.points) ? body.points : [];
  if (!companyId) {
    console.log("[ingest] 400, missing_company user=" + user.id);
    return NextResponse.json({ error: "missing_company" }, { status: 400 });
  }
  // Device-clock correction. Two failure modes, both fixed by SHIFTING
  // the batch rather than pinning individual points:
  //
  //  - Clock AHEAD: a future captured_at makes the finalizer's parked
  //    test (server now - device ts) read negative, so the drive never
  //    tail-closes. Pinning every skewed point to the identical receipt
  //    instant (the old behaviour) collapsed the batch to one timestamp,
  //    and renderTripFromRaw's by-time dedupe then kept ONE point per
  //    batch — silently deleting the drive's shape (audit #14).
  //  - Clock BEHIND: every point looks minutes old on arrival, so the
  //    parked test fires on a live drive and force-closes it every
  //    ingest, shredding one drive into fragments (audit #13).
  //
  // Both are a constant offset across the batch, so compute the skew
  // from the batch's newest point and subtract it from all of them.
  // Relative spacing — the thing that makes a track a track — survives.
  const receiptMs = Date.now();
  const SKEW_TOLERANCE_MS = 2 * 60_000;
  // A true clock offset is seconds to minutes. A batch HOURS or days
  // behind receipt is not a broken clock, it is an OFFLINE BACKLOG
  // finally flushing — its timestamps are correct and must be kept.
  // Shifting a backlog relabels old drives as "now" and interleaves
  // them with tonight's points into fabricated mega-trips (observed
  // live: two impossible trips, 808 mi and 314 mi, 21-mile hops at
  // 1-minute spacing, after a 2-day-dark phone flushed its buffer).
  const MAX_BEHIND_SHIFT_MS = 30 * 60_000;
  const finite = rawPoints.filter(isFinitePoint);
  const newestTs = finite.reduce((a, pt) => Math.max(a, pt.ts), 0);
  const skewMs = newestTs > 0 ? newestTs - receiptMs : 0;
  const shiftable =
    // Ahead of receipt is physically impossible: always a clock issue.
    (skewMs > SKEW_TOLERANCE_MS ||
      // Behind is ambiguous: only treat SMALL lags as clock skew.
      (skewMs < -SKEW_TOLERANCE_MS && skewMs > -MAX_BEHIND_SHIFT_MS));
  const correctedPoints = shiftable
    ? finite.map((pt) => ({ ...pt, ts: pt.ts - skewMs }))
    : finite;
  const points = correctedPoints.sort((a, b) => a.ts - b.ts);
  if (points.length > 50_000) {
    console.log(
      "[ingest] 413, too_many_points user=" + user.id + " n=" + points.length,
    );
    return NextResponse.json({ error: "too_many_points" }, { status: 413 });
  }

  const admin = createServiceClient();

  const { data: membership } = await admin
    .from("company_members")
    .select("company_id")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    console.log(
      "[ingest] 403, not_a_member user=" + user.id + " company=" + companyId,
    );
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 1. Stage the incoming points. Even a 1-point batch lands so we
  // never silently drop. An empty array is allowed, the device can
  // call us purely to let the segmenter catch up to already-staged data.
  if (points.length > 0) {
    const stagingRows = points.map((p) => ({
      driver_user_id: user.id,
      company_id: companyId,
      captured_at: new Date(p.ts).toISOString(),
      lat: p.lat,
      lng: p.lng,
      speed_mps: p.speedMps ?? null,
      accuracy_m: p.accuracyM ?? null,
    }));
    // Idempotent: a retried flush (POST succeeded but the response was
    // lost — routine in a tunnel) must not store the same fix twice, and
    // a second capture path must be able to overlap safely. Identity is
    // (driver, company, captured_at); see migration 20260728000000.
    const { error: stageErr } = await admin
      .from("mileage_points_raw")
      .upsert(stagingRows, {
        onConflict: "driver_user_id,company_id,captured_at",
        ignoreDuplicates: true,
      });
    if (stageErr) {
      console.error("[ingest] stage insert failed", stageErr.message);
      return NextResponse.json(
        { error: "stage_failed", detail: stageErr.message },
        { status: 500 },
      );
    }
  }

  // 1b. Stage any signal observations that came with the batch, BEFORE
  // segmenting, so the confidence engine scores this run's trips with
  // the evidence that belongs to them rather than one flush late.
  //
  // A bad signal payload must never cost us the points: everything here
  // is best-effort and the failure is logged, not returned.
  const signalReport = parseSignalReport(body.signals, Date.now());
  if (signalReport.observations.length > 0) {
    const rows = signalReport.observations.map((o) => ({
      driver_user_id: user.id,
      company_id: companyId,
      kind: o.kind,
      platform: o.platform,
      started_at: new Date(o.startedAtMs).toISOString(),
      last_seen_at: new Date(o.lastSeenAtMs).toISOString(),
      ended_at: o.endedAtMs === null ? null : new Date(o.endedAtMs).toISOString(),
      strength: o.strength ?? null,
      source: o.source ?? null,
      detail: o.detail,
    }));
    // Same identity contract as the raw points: a retried flush must not
    // multiply a device's own evidence.
    const { error: sigErr } = await admin
      .from("mileage_signal_events")
      .upsert(rows, {
        onConflict: "driver_user_id,company_id,kind,started_at",
        ignoreDuplicates: false,
      });
    if (sigErr) {
      console.error("[ingest] signal upsert failed", sigErr.message);
    }
  }
  if (signalReport.rejected.length > 0) {
    // Never absorbed. A producer emitting nonsense has to be visible, or
    // it looks exactly like a quiet device.
    console.error(
      `[ingest] signal payload rejected user=${user.id} ` +
        signalReport.rejected
          .map((r) => `${r.kind ?? "?"}:${r.reason}`)
          .join(" "),
    );
  }

  // 2. Segment the unconsumed staging pool into closed trips. forceClose
  // mirrors the client's explicit "I'm done" (sessionEnded); otherwise
  // finalizeUserTrips closes only when the last point is >5 min old.
  const result = await finalizeUserTrips(admin, user.id, companyId, {
    sinceIso: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
    forceClose: sessionEnded,
    push: true,
  });

  console.log(
    `[ingest] done user=${user.id} incoming=${points.length} pool=${result.poolSize} trips=${result.tripsCreated} biz_mi=${result.businessMiles.toFixed(2)} ded_$=${(result.deductionCents / 100).toFixed(2)} sessionEnded=${sessionEnded}`,
  );

  // Honest remaining-backlog figure for the on-device diagnostics: the
  // client reads `stagingRemaining` (the old `stagingPoolSize` was both
  // misnamed on the wire and semantically the PROCESSED pool, so the
  // diag crumb permanently showed 0).
  const { count: stagingRemaining } = await admin
    .from("mileage_points_raw")
    .select("id", { count: "exact", head: true })
    .eq("driver_user_id", user.id)
    .eq("company_id", companyId)
    .is("consumed_at", null);

  return NextResponse.json({
    ok: true,
    tripsCreated: result.tripsCreated,
    businessMiles: Number(result.businessMiles.toFixed(3)),
    deductionCents: result.deductionCents,
    stagingPoolSize: result.poolSize,
    stagingRemaining: stagingRemaining ?? 0,
  });
}
