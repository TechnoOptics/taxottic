import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  segmentTrips,
  suggestClassification,
  type GpsPoint,
  type Place,
} from "@/lib/mileage/segmentation";
import { tripDeductionCents } from "@/lib/mileage/deduction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/mileage/ingest
//
// The native background-geolocation layer (Phase 4) streams raw GPS
// points here. ALL intelligence is server-side + already unit-
// tested (segmentTrips / suggestClassification / tripDeduction),
// so this route is just: authenticate → validate → segment →
// classify → persist with the IRS deduction precomputed.
//
// Auth/write model: validate the user via the session, then WRITE
// with the service-role client scoping every row by the validated
// driver_user_id (the codebase's standard pattern — @supabase/ssr
// cookies don't reach PostgREST in route handlers, so RLS WITH
// CHECK on a session client would fail).
//
// Scope note (documented, intentional): this segments the SUBMITTED
// batch. A drive split across two upload batches yields two trips
// at the seam; cross-batch stitching is the Phase-2.5 refinement
// noted in docs/MILEAGE_TRACKER_SPEC.md. Re-posting the same batch
// is de-duped on (company, driver, started_at, ended_at).

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
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const companyId = String(body.companyId ?? "").trim();
  const rawPoints = Array.isArray(body.points) ? body.points : [];
  if (!companyId) {
    return NextResponse.json({ error: "missing_company" }, { status: 400 });
  }
  const points = rawPoints
    .filter(isFinitePoint)
    .sort((a, b) => a.ts - b.ts);
  if (points.length < 2) {
    return NextResponse.json(
      { ok: true, tripsCreated: 0, businessMiles: 0, deductionCents: 0 },
      { status: 200 },
    );
  }
  // Reject absurd payloads early (a runaway client / abuse).
  if (points.length > 50_000) {
    return NextResponse.json({ error: "too_many_points" }, { status: 413 });
  }

  const admin = createServiceClient();

  // The signed-in user must be a member of the company they're
  // logging mileage for.
  const { data: membership } = await admin
    .from("company_members")
    .select("company_id")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Known geofenced places for business/personal suggestion.
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

  const trips = segmentTrips(points);

  let tripsCreated = 0;
  let businessMiles = 0;
  let deductionCents = 0;

  for (const trip of trips) {
    const startedAt = new Date(trip.startTs).toISOString();
    const endedAt = new Date(trip.endTs).toISOString();

    // Idempotent: skip if this exact drive was already ingested.
    const { data: dupe } = await admin
      .from("mileage_trips")
      .select("id")
      .eq("company_id", companyId)
      .eq("driver_user_id", user.id)
      .eq("started_at", startedAt)
      .eq("ended_at", endedAt)
      .maybeSingle();
    if (dupe) continue;

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
      // Don't fail the whole batch for one bad trip; the device
      // can safely retry (idempotency guard above protects us).
      console.error("[mileage/ingest] trip insert failed", tripErr?.message);
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
        console.error("[mileage/ingest] points insert failed", ptErr.message);
      }
    }

    tripsCreated++;
    if (classification === "business") {
      businessMiles += trip.distanceMiles;
      deductionCents += dCents;
    }
  }

  return NextResponse.json({
    ok: true,
    tripsCreated,
    businessMiles: Number(businessMiles.toFixed(3)),
    deductionCents,
  });
}
