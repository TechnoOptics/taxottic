import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  segmentTrips,
  suggestClassification,
  type GpsPoint,
  type Place,
} from "@/lib/mileage/segmentation";
import { tripDeductionCents } from "@/lib/mileage/deduction";
import { notify } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/mileage/ingest
//
// THE BIG REWRITE (May 25 2026). The old contract was:
//   1. Receive a batch of points.
//   2. Run segmentTrips() on the batch.
//   3. Insert any closed trips.
//   4. Return ok + tripsCreated.
//
// That contract silently dropped EVERY user's drives. The
// segmenter needs a 5-min stationary dwell (or 8-min capture gap)
// to close a trip. The device's @capgo plugin flushes every 2 min
// during a drive. So every batch was mid-drive — continuous
// movement, no closing pause — segmentTrips returned 0 trips, we
// returned ok with tripsCreated=0, the device cleared its local
// buffer, and the points were lost. Zero rows in mileage_points
// or mileage_trips across the entire DB, ever, was the proof.
//
// New contract:
//   1. Persist every incoming point to mileage_points_raw (staging).
//   2. Pull ALL still-unconsumed staging rows for this user+company
//      (the last 24h to bound query cost).
//   3. Run segmentTrips() over the union (sorted by captured_at).
//   4. For each CLOSED trip the segmenter returns, insert into
//      mileage_trips, copy the points into mileage_points, and mark
//      the contributing staging rows consumed.
//   5. Points that belong to an OPEN (still-moving) trip stay in
//      staging for the next batch. Nothing is dropped.
//
// Console-logs the entire flow so Vercel runtime logs finally show
// what's happening — the old route had zero logging, which is why
// this bug went undiagnosed.

type Body = {
  companyId?: string;
  points?: GpsPoint[];
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
    console.log("[ingest] 401 — no session");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    console.log("[ingest] 400 — invalid_json");
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const companyId = String(body.companyId ?? "").trim();
  const rawPoints = Array.isArray(body.points) ? body.points : [];
  if (!companyId) {
    console.log("[ingest] 400 — missing_company user=" + user.id);
    return NextResponse.json({ error: "missing_company" }, { status: 400 });
  }
  const points = rawPoints
    .filter(isFinitePoint)
    .sort((a, b) => a.ts - b.ts);
  if (points.length > 50_000) {
    console.log(
      "[ingest] 413 — too_many_points user=" + user.id + " n=" + points.length,
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
      "[ingest] 403 — not_a_member user=" + user.id + " company=" + companyId,
    );
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 1. Stage the incoming points. Even a 1-point batch lands so we
  // never silently drop. Skip if the array is empty (the device
  // can still call us to drain its buffer + see the segmentation
  // catch up to any already-staged data).
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
    const { error: stageErr } = await admin
      .from("mileage_points_raw")
      .insert(stagingRows);
    if (stageErr) {
      console.error("[ingest] stage insert failed", stageErr.message);
      return NextResponse.json(
        { error: "stage_failed", detail: stageErr.message },
        { status: 500 },
      );
    }
  }

  // 2. Pull the user's unconsumed staging pool (last 24h bound so a
  // single query never blows up). 50k row hard cap matches the
  // hard reject above. Sorted asc by captured_at so the segmenter
  // sees a chronological stream.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data: pendingRows, error: pendingErr } = await admin
    .from("mileage_points_raw")
    .select("id, captured_at, lat, lng, speed_mps, accuracy_m")
    .eq("driver_user_id", user.id)
    .eq("company_id", companyId)
    .is("consumed_at", null)
    .gte("captured_at", dayAgo)
    .order("captured_at", { ascending: true })
    .limit(50_000);
  if (pendingErr) {
    console.error("[ingest] pending fetch failed", pendingErr.message);
    return NextResponse.json(
      { error: "pending_failed", detail: pendingErr.message },
      { status: 500 },
    );
  }
  const pending = pendingRows ?? [];

  // Convert staging rows → GpsPoint for the segmenter. Keep a
  // side-map id→raw row so we can mark them consumed after a trip
  // is materialised.
  type StagingRow = (typeof pending)[number];
  type PointWithRaw = GpsPoint & { __raw: StagingRow };
  const allPoints: PointWithRaw[] = pending.map((r) => ({
    lat: r.lat as number,
    lng: r.lng as number,
    ts: Date.parse(r.captured_at as string),
    speedMps: (r.speed_mps as number | null) ?? undefined,
    accuracyM: (r.accuracy_m as number | null) ?? undefined,
    __raw: r,
  }));

  console.log(
    `[ingest] user=${user.id} company=${companyId} incoming=${points.length} staging_pool=${allPoints.length}`,
  );

  // 3. Known places for auto-classification.
  const { data: placeRows } = await admin
    .from("mileage_places")
    .select("id, kind, lat, lng, radius_m")
    .eq("company_id", companyId);
  const places: Place[] = (placeRows ?? []).map((p) => ({
    id: p.id as string,
    kind: p.kind as Place["kind"],
    lat: p.lat as number,
    lng: p.lng as number,
    radiusM: (p.radius_m as number) ?? 120,
  }));

  // 4. Segment across the full staging pool.
  const trips = segmentTrips(
    allPoints.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      ts: p.ts,
      speedMps: p.speedMps,
      accuracyM: p.accuracyM,
    })),
  );

  let tripsCreated = 0;
  let businessMiles = 0;
  let deductionCents = 0;

  // 5. Materialise closed trips. For each trip the segmenter returns
  // we find the matching subset of staging rows by timestamp range
  // (segmentTrips preserves order, so startTs..endTs covers exactly
  // the contributing fixes).
  for (const trip of trips) {
    const startedAt = new Date(trip.startTs).toISOString();
    const endedAt = new Date(trip.endTs).toISOString();

    // De-dupe re-posted batches: if a trip with this exact range
    // exists for this driver, skip + still mark the staging rows
    // consumed so they don't pile up.
    const { data: dupe } = await admin
      .from("mileage_trips")
      .select("id")
      .eq("company_id", companyId)
      .eq("driver_user_id", user.id)
      .eq("started_at", startedAt)
      .eq("ended_at", endedAt)
      .maybeSingle();

    const contributingRaw = allPoints.filter(
      (p) => p.ts >= trip.startTs && p.ts <= trip.endTs,
    );

    if (dupe) {
      const ids = contributingRaw.map((p) => (p.__raw as { id: string }).id);
      if (ids.length > 0) {
        await admin
          .from("mileage_points_raw")
          .update({
            consumed_at: new Date().toISOString(),
            consumed_trip_id: dupe.id,
          })
          .in("id", ids);
      }
      continue;
    }

    const classification = suggestClassification(trip, places);
    const taxYear = new Date(trip.startTs).getUTCFullYear();
    const dCents = tripDeductionCents(
      { distanceMiles: trip.distanceMiles },
      classification,
      taxYear,
    );

    const { data: inserted, error: tripErr } = await admin
      .from("mileage_trips")
      .insert({
        company_id: companyId,
        driver_user_id: user.id,
        started_at: startedAt,
        ended_at: endedAt,
        distance_miles: Number(trip.distanceMiles.toFixed(3)),
        classification,
        tax_year: taxYear,
        deduction_cents: dCents,
      })
      .select("id")
      .single();
    if (tripErr || !inserted) {
      console.error("[ingest] trip insert failed", tripErr?.message);
      continue;
    }

    const pointRows = trip.points.map((pt) => ({
      trip_id: inserted.id,
      captured_at: new Date(pt.ts).toISOString(),
      lat: pt.lat,
      lng: pt.lng,
      speed_mps: pt.speedMps ?? null,
      accuracy_m: pt.accuracyM ?? null,
    }));
    if (pointRows.length > 0) {
      const { error: ptErr } = await admin
        .from("mileage_points")
        .insert(pointRows);
      if (ptErr) {
        console.error("[ingest] points insert failed", ptErr.message);
      }
    }

    // Mark the contributing staging rows consumed.
    const ids = contributingRaw.map((p) => (p.__raw as { id: string }).id);
    if (ids.length > 0) {
      await admin
        .from("mileage_points_raw")
        .update({
          consumed_at: new Date().toISOString(),
          consumed_trip_id: inserted.id,
        })
        .in("id", ids);
    }

    tripsCreated++;
    if (classification === "business") {
      businessMiles += trip.distanceMiles;
      deductionCents += dCents;
    } else if (classification === "unclassified") {
      await notify(user.id, {
        kind: "trip_classify",
        tripId: inserted.id,
      });
    }
  }

  const stagingRemaining = allPoints.length - trips.reduce((sum, t) => {
    return (
      sum +
      allPoints.filter((p) => p.ts >= t.startTs && p.ts <= t.endTs).length
    );
  }, 0);

  console.log(
    `[ingest] done user=${user.id} trips=${tripsCreated} biz_mi=${businessMiles.toFixed(2)} ded_$=${(deductionCents / 100).toFixed(2)} staging_left=${stagingRemaining}`,
  );

  return NextResponse.json({
    ok: true,
    tripsCreated,
    businessMiles: Number(businessMiles.toFixed(3)),
    deductionCents,
    stagingPoolSize: allPoints.length,
    stagingRemaining,
  });
}
