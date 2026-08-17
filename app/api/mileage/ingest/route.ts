import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { type GpsPoint } from "@/lib/mileage/segmentation";
import { finalizeUserTrips } from "@/lib/mileage/finalize";
import {
  NEIGHBOUR_ROW_CAP,
  NEIGHBOUR_WINDOW_MS,
  rejectImplausibleJumps,
  type JumpPoint,
} from "@/lib/mileage/plausible-jump";
import { correctBatchClockSkew } from "@/lib/mileage/clock-skew";

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
  // Set by the two native-buffer drains (lib/mileage/geofence.ts,
  // lib/mileage/device-status.ts). Those batches are stored-and-forwarded
  // by construction, so their lag is not evidence of a device clock
  // error and must not be corrected as one. See lib/mileage/clock-skew.
  backlog?: boolean;
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
  // Device-clock correction. See lib/mileage/clock-skew.ts for the two
  // failure modes this fixes, and for why the offset is confined to the
  // batch's contemporaneous cluster instead of reaching every point: a
  // flush that carries one fresh fix alongside hours of offline backlog
  // used to drag that backlog forward by up to 30 minutes, which wrote a
  // second copy of an already-stored drive under a timestamp the
  // idempotency key below could not recognise.
  //
  // A native-buffer drain says so outright rather than leaving the rule
  // to infer it: those batches land in the 2 to 30 minute band, which is
  // the one band the lag test cannot tell apart from clock drift.
  const backlog = body.backlog === true;
  const receiptMs = Date.now();
  const finite = rawPoints.filter(isFinitePoint);
  const skew = correctBatchClockSkew(finite, receiptMs, { backlog });
  const points = skew.points;
  if (skew.shifted) {
    console.log(
      `[ingest] clock skew ${Math.round(skew.skewMs / 1000)}s corrected ` +
        `user=${user.id} shifted=${points.length - skew.backlogHeld} ` +
        `backlog_held=${skew.backlogHeld}`,
    );
  }
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

  // 0. Refuse teleports.
  //
  // On 2026-08-09 this driver's pool held two interleaved copies of one
  // drive home, the second shifted about sixteen minutes later than
  // reality, so consecutive rows alternated between two places nine
  // miles apart. 30 of 81 transitions implied over 89 m/s and the worst
  // implied 53,544 m/s, about 119,000 mph. Segmentation could make
  // nothing of it, the downstream gate refused to write, and 391 points
  // sat unconsumed for six hours while the drive never reached the map.
  //
  // The phantom's origin is below this codebase (its timestamps all
  // share a .699 sub-second at a uniform cadence, the signature of a
  // boot-anchor reconstruction inside the geolocation plugin's buffer),
  // so the defence is to refuse it at the door rather than to try to
  // clean it up afterwards. See lib/mileage/plausible-jump.ts for why
  // this keys on implied SPEED and never on distance: a twenty minute
  // capture gap legitimately puts the next point nine miles away.
  const { data: lastRow, error: lastRowErr } = await admin
    .from("mileage_points_raw")
    .select("lat, lng, captured_at")
    .eq("driver_user_id", user.id)
    .eq("company_id", companyId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastRowErr) {
    // Not fatal, but say so. A failed read silently nulls the anchor and
    // the gate degrades to intra-batch checking only, which is a weaker
    // guarantee than the caller is entitled to assume.
    console.error(
      "[ingest] gate anchor read failed, checking within batch only:",
      lastRowErr.message,
    );
  }
  const lastAccepted =
    lastRow && Number.isFinite(lastRow.lat as number)
      ? {
          lat: lastRow.lat as number,
          lng: lastRow.lng as number,
          ts: Date.parse(lastRow.captured_at as string),
        }
      : null;

  // The anchor is only usable if it PRECEDES the batch.
  //
  // `points` is sorted ascending above. When the whole batch is older
  // than the newest stored point (an offline backlog uploaded after the
  // phone reconnects), every point compares negative against the anchor.
  // Negative elapsed is kept without advancing the reference, by design,
  // so the reference would never become a member of the batch and NO
  // pair inside it would ever be checked. A teleport buried in a backlog
  // would sail through the gate built to stop it.
  //
  // Passing null instead makes the batch self-anchor on its own first
  // point, which is the strongest check available for history.
  const anchor =
    lastAccepted &&
    Number.isFinite(lastAccepted.ts) &&
    points.length > 0 &&
    lastAccepted.ts <= points[0].ts
      ? lastAccepted
      : null;

  // The points this batch lands AMONG, which is the blind spot the
  // anchor above cannot cover.
  //
  // Measured 2026-08-17 on driver 89871e98. A drive uploaded live on
  // whole-second timestamps; 26 minutes later the native buffer replayed
  // the same drive twice more, on .297 and .928 sub-second offsets, with
  // every timestamp pushed about three minutes later than reality. The
  // 631 ms between the replays defeats the upsert key below outright, so
  // both copies were stored. The batch was wholly older than the newest
  // stored point, so `anchor` was correctly dropped, and the replay is
  // internally flawless, so the gate refused nothing. Merged, the pool
  // alternated between the live position and a copy 4.6 km behind it:
  // 1,263 of 3,351 transitions over 60 m/s, one 1,527 mi trip, refused
  // downstream, pool frozen permanently.
  //
  // NOT fixed by widening the upsert key's time resolution: a
  // whole-second key collapses the two replays into each other and
  // leaves the survivor still three minutes out of step with the live
  // copy. NOT fixed by keying on the sub-second offset either; that
  // describes this delivery rather than any rule, since live fixes are
  // not obliged to land on whole seconds. It is logged below as the
  // diagnostic it is.
  const storedNeighbours: JumpPoint[] = [];
  if (points.length > 0) {
    const { data: neighbourRows, error: neighbourErr } = await admin
      .from("mileage_points_raw")
      .select("lat, lng, captured_at")
      .eq("driver_user_id", user.id)
      .eq("company_id", companyId)
      .gte(
        "captured_at",
        new Date(points[0].ts - NEIGHBOUR_WINDOW_MS).toISOString(),
      )
      .lte(
        "captured_at",
        new Date(
          points[points.length - 1].ts + NEIGHBOUR_WINDOW_MS,
        ).toISOString(),
      )
      .order("captured_at", { ascending: true })
      .limit(NEIGHBOUR_ROW_CAP);
    if (neighbourErr) {
      // Say it. A swallowed error leaves the gate with no witnesses and
      // degrades it to exactly the behaviour that lost the drive.
      console.error(
        "[ingest] neighbour window read failed, gate has no stored witnesses:",
        neighbourErr.message,
      );
    }
    for (const row of neighbourRows ?? []) {
      const ts = Date.parse(row.captured_at as string);
      if (Number.isFinite(row.lat as number) && Number.isFinite(ts)) {
        storedNeighbours.push({
          lat: row.lat as number,
          lng: row.lng as number,
          ts,
        });
      }
    }
    if ((neighbourRows?.length ?? 0) >= NEIGHBOUR_ROW_CAP) {
      console.error(
        `[ingest] neighbour window hit the ${NEIGHBOUR_ROW_CAP} row cap ` +
          `user=${user.id}; the late part of this batch is checked against ` +
          `its predecessor only.`,
      );
    }
  }

  const gate = rejectImplausibleJumps(points, anchor, storedNeighbours);
  if (gate.rejected.length > 0) {
    const worst = gate.rejected.reduce((a, b) =>
      a.impliedMps > b.impliedMps ? a : b,
    );
    // The sub-second offset of what was refused. Not a rule and never a
    // gate, but on every incident so far the replay path has carried one
    // stable offset (.699 in August, .297 and .928 here), so a single
    // dominant value is strong evidence that a whole delivery was turned
    // away rather than a few stray fixes.
    const offsets = new Set(gate.rejected.map((r) => r.point.ts % 1000));
    const byReason = gate.rejected.reduce<Record<string, number>>((acc, r) => {
      acc[r.reason] = (acc[r.reason] ?? 0) + 1;
      return acc;
    }, {});
    console.error(
      `[ingest] REJECTED ${gate.rejected.length}/${points.length} implausible points ` +
        `user=${user.id} worst=${Math.round(worst.impliedMps)}m/s ` +
        `(${Math.round(worst.meters)}m in ${worst.seconds}s) ` +
        `by=${JSON.stringify(byReason)} subsecond_offsets=${offsets.size}. ` +
        `A non-zero count here means a second point source is writing into ` +
        `this driver's stream; see lib/mileage/plausible-jump.ts.`,
    );
  }
  const accepted = gate.kept;

  // 1. Stage the incoming points. Even a 1-point batch lands so we
  // never silently drop. An empty array is allowed, the device can
  // call us purely to let the segmenter catch up to already-staged data.
  if (accepted.length > 0) {
    const stagingRows = accepted.map((p) => ({
      driver_user_id: user.id,
      company_id: companyId,
      captured_at: new Date(p.ts).toISOString(),
      lat: p.lat,
      lng: p.lng,
      speed_mps: p.speedMps ?? null,
      accuracy_m: p.accuracyM ?? null,
    }));
    // Idempotent: a retried flush (POST succeeded but the response was
    // lost, routine in a tunnel) must not store the same fix twice, and
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

  // 2. Segment the unconsumed staging pool into closed trips. forceClose
  // mirrors the client's explicit "I'm done" (sessionEnded); otherwise
  // finalizeUserTrips closes only when the last point is >5 min old.
  const result = await finalizeUserTrips(admin, user.id, companyId, {
    sinceIso: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
    forceClose: sessionEnded,
    push: true,
  });

  console.log(
    `[ingest] done user=${user.id} incoming=${accepted.length} pool=${result.poolSize} trips=${result.tripsCreated} biz_mi=${result.businessMiles.toFixed(2)} ded_$=${(result.deductionCents / 100).toFixed(2)} sessionEnded=${sessionEnded}`,
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
