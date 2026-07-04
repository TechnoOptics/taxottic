import type { SupabaseClient } from "@supabase/supabase-js";
import {
  segmentTrips,
  suggestClassification,
  STATIONARY_DWELL_MS,
  type Place,
} from "./segmentation";
import { tripDeductionCents } from "./deduction";
import { notify } from "@/lib/push";

/**
 * Shared "segment the staging pool → materialise closed trips" core.
 *
 * Extracted from app/api/mileage/ingest so the live ingest route AND
 * the mileage-finalize cron run IDENTICAL segmentation + overlap-dedup
 * + consume-by-range logic. Divergence here is dangerous, the dedup
 * path is what stops a single drive becoming 9 duplicate trips, and the
 * consume-by-range path is what stops a finished drive being
 * re-segmented forever. Keep this as the single source of truth.
 */

type FinalizeOpts = {
  /** Only segment unconsumed points captured at/after this ISO time.
   *  Ingest passes ~24h (bounds per-request cost); the cron passes a
   *  wide window so drives stranded beyond 24h finally materialise. */
  sinceIso: string;
  /** Force the tail-close even when the most recent point is fresh.
   *  Ingest passes the client's `sessionEnded` (explicit "I'm done").
   *  The cron passes false and relies on the 5-min parked test below,
   *  so a periodic run can NEVER sever a still-active drive. */
  forceClose: boolean;
  /** Push a per-trip notification. Live ingest: true. The backfill
   *  cron: false, recovering weeks of stranded drives at once must not
   *  spray the lock screen with dozens of pings. */
  push: boolean;
};

export type FinalizeResult = {
  tripsCreated: number;
  businessMiles: number;
  deductionCents: number;
  poolSize: number;
};

export async function finalizeUserTrips(
  admin: SupabaseClient,
  userId: string,
  companyId: string,
  opts: FinalizeOpts,
): Promise<FinalizeResult> {
  const empty: FinalizeResult = {
    tripsCreated: 0,
    businessMiles: 0,
    deductionCents: 0,
    poolSize: 0,
  };

  // Pull the unconsumed staging pool, paginated. PostgREST caps any
  // single response at the project max-rows (1000), so a long drive
  // MUST be paged through or it gets truncated and fragmented at the
  // 1000-point boundary.
  const PAGE_SIZE = 1000;
  const MAX_POOL = 50_000;
  const fetchPage = (from: number) =>
    admin
      .from("mileage_points_raw")
      .select("id, captured_at, lat, lng, speed_mps, accuracy_m")
      .eq("driver_user_id", userId)
      .eq("company_id", companyId)
      .is("consumed_at", null)
      .gte("captured_at", opts.sinceIso)
      .order("captured_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
  const firstPage = await fetchPage(0);
  if (firstPage.error) {
    console.error("[finalize] pending fetch failed", firstPage.error.message);
    return empty;
  }
  const pending = firstPage.data ?? [];
  while (
    pending.length > 0 &&
    pending.length % PAGE_SIZE === 0 &&
    pending.length < MAX_POOL
  ) {
    const next = await fetchPage(pending.length);
    if (next.error) {
      console.error("[finalize] pending page fetch failed", next.error.message);
      break;
    }
    const rows = next.data ?? [];
    pending.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  const allPoints = pending.map((r) => ({
    lat: r.lat as number,
    lng: r.lng as number,
    ts: Date.parse(r.captured_at as string),
    speedMps: (r.speed_mps as number | null) ?? undefined,
    accuracyM: (r.accuracy_m as number | null) ?? undefined,
  }));
  if (allPoints.length === 0) return empty;

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

  // Close the open trip only when the user is parked (last point older
  // than the 5-min dwell) OR when the caller forces it. The cron never
  // forces, so it cannot fragment a drive that is still in progress.
  const lastPointAgeMs = Date.now() - allPoints[allPoints.length - 1].ts;
  const closeOpenAtEnd =
    opts.forceClose || lastPointAgeMs >= STATIONARY_DWELL_MS;
  const trips = segmentTrips(allPoints, { closeOpenAtEnd });

  let tripsCreated = 0;
  let businessMiles = 0;
  let deductionCents = 0;

  const consumeRange = async (
    startedAtIso: string,
    endedAtIso: string,
    tripId: string,
  ) => {
    const { error } = await admin
      .from("mileage_points_raw")
      .update({
        consumed_at: new Date().toISOString(),
        consumed_trip_id: tripId,
      })
      .eq("driver_user_id", userId)
      .eq("company_id", companyId)
      .is("consumed_at", null)
      .gte("captured_at", startedAtIso)
      .lte("captured_at", endedAtIso);
    if (error) console.error("[finalize] consume range failed", error.message);
  };

  for (const trip of trips) {
    const startedAt = new Date(trip.startTs).toISOString();
    const endedAt = new Date(trip.endTs).toISOString();

    // De-dupe by time-range OVERLAP: if an existing trip already covers
    // this window at least as completely, consume to it and skip; if the
    // new one is fuller, replace the stale fragment(s).
    const { data: overlaps } = await admin
      .from("mileage_trips")
      .select("id, distance_miles")
      .eq("company_id", companyId)
      .eq("driver_user_id", userId)
      .lte("started_at", endedAt)
      .gte("ended_at", startedAt);
    if (overlaps && overlaps.length > 0) {
      const maxMiles = Math.max(
        ...overlaps.map((o) => Number(o.distance_miles) || 0),
      );
      if (trip.distanceMiles <= maxMiles + 0.005) {
        const keeper = overlaps.reduce((a, b) =>
          (Number(a.distance_miles) || 0) >= (Number(b.distance_miles) || 0)
            ? a
            : b,
        );
        await consumeRange(startedAt, endedAt, keeper.id as string);
        continue;
      }
      await admin
        .from("mileage_trips")
        .delete()
        .in(
          "id",
          overlaps.map((o) => o.id as string),
        );
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
        driver_user_id: userId,
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
      console.error("[finalize] trip insert failed", tripErr?.message);
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
      if (ptErr) console.error("[finalize] points insert failed", ptErr.message);
    }

    await consumeRange(startedAt, endedAt, inserted.id);

    tripsCreated++;
    if (classification === "business") {
      businessMiles += trip.distanceMiles;
      deductionCents += dCents;
    }

    if (opts.push) {
      if (classification === "unclassified") {
        await notify(userId, { kind: "trip_classify", tripId: inserted.id });
      } else {
        await notify(userId, {
          kind: "trip_logged",
          tripId: inserted.id,
          classification,
        });
      }
    }
  }

  return {
    tripsCreated,
    businessMiles,
    deductionCents,
    poolSize: allPoints.length,
  };
}
