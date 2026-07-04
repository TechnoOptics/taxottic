import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { type GpsPoint } from "@/lib/mileage/segmentation";
import { finalizeUserTrips } from "@/lib/mileage/finalize";

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
  const points = rawPoints.filter(isFinitePoint).sort((a, b) => a.ts - b.ts);
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

  return NextResponse.json({
    ok: true,
    tripsCreated: result.tripsCreated,
    businessMiles: Number(result.businessMiles.toFixed(3)),
    deductionCents: result.deductionCents,
    stagingPoolSize: result.poolSize,
  });
}
