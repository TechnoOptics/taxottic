import type { SupabaseClient } from "@supabase/supabase-js";
import {
  segmentTrips,
  suggestClassification,
  STATIONARY_DWELL_MS,
  type Place,
  type Classification,
} from "./segmentation";
import { tripDeductionCents } from "./deduction";
import { buildTrackFromRaw, type RawPoint } from "./track";
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

export type OverlapAction =
  | { action: "insert" }
  | { action: "consume_to_keeper"; keeperId: string }
  | { action: "replace"; deleteIds: string[] };

/**
 * Pure decision for a candidate trip vs existing overlapping trips:
 * no overlaps → insert; an existing trip at least as full → consume the
 * candidate's window to the fullest keeper; otherwise the candidate is
 * fuller → replace the stale fragments. Extracted from the loop below so
 * the branch — the most consequential dedupe logic in the pipeline — is
 * unit-testable without a database.
 */
export function resolveOverlapAction(
  candidateMiles: number,
  overlaps: readonly { id: string; miles: number }[],
): OverlapAction {
  if (overlaps.length === 0) return { action: "insert" };
  const maxMiles = Math.max(...overlaps.map((o) => o.miles || 0));
  if (candidateMiles <= maxMiles + 0.005) {
    const keeper = overlaps.reduce((a, b) =>
      (a.miles || 0) >= (b.miles || 0) ? a : b,
    );
    return { action: "consume_to_keeper", keeperId: keeper.id };
  }
  return { action: "replace", deleteIds: overlaps.map((o) => o.id) };
}

/**
 * Rebuild a trip's rendered track (mileage_points) + distance from ALL
 * raw staging points inside its own time window, then persist. This is
 * what keeps the rendered polyline honest: the segmentation pool only
 * ever sees currently-unconsumed points, so a drive whose points arrived
 * across multiple flush batches (the delayed-flush / battery case) could
 * be materialised from a partial pool while consume-by-range swallowed
 * the rest — a straight line across the missing stretch. Rebuilding from
 * the window is drift-free for healthy trips (the points the segmenter
 * drops sit outside [start, end]) and corrective for broken ones.
 *
 * `candStart/candEnd` is the window of the segment that resolved to this
 * trip; the effective window is the union with the trip's stored span so
 * a keeper absorbing an earlier/later fragment grows to cover it.
 */
async function renderTripFromRaw(
  admin: SupabaseClient,
  userId: string,
  companyId: string,
  tripId: string,
  candStartIso: string,
  candEndIso: string,
): Promise<{ miles: number; deductionCents: number } | null> {
  const { data: trip } = await admin
    .from("mileage_trips")
    .select("started_at, ended_at, classification, tax_year")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) return null;
  const startIso =
    (trip.started_at as string) < candStartIso
      ? (trip.started_at as string)
      : candStartIso;
  const endIso =
    (trip.ended_at as string) > candEndIso
      ? (trip.ended_at as string)
      : candEndIso;

  const PAGE = 1000;
  const raw: RawPoint[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("mileage_points_raw")
      .select("captured_at, lat, lng, speed_mps, accuracy_m")
      .eq("driver_user_id", userId)
      .eq("company_id", companyId)
      .gte("captured_at", startIso)
      .lte("captured_at", endIso)
      .order("captured_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("[finalize] render raw fetch failed", error.message);
      return null;
    }
    const rows = (data ?? []) as RawPoint[];
    raw.push(...rows);
    if (rows.length < PAGE) break;
  }

  const track = buildTrackFromRaw(raw);
  // Fewer than 2 usable points in the window: leave whatever was already
  // rendered rather than blanking the trip.
  if (track.points.length < 2) return null;

  const { error: delErr } = await admin
    .from("mileage_points")
    .delete()
    .eq("trip_id", tripId);
  if (delErr) {
    console.error("[finalize] render delete failed", delErr.message);
    return null;
  }
  const { error: insErr } = await admin.from("mileage_points").insert(
    track.points.map((pt) => ({
      trip_id: tripId,
      captured_at: pt.captured_at,
      lat: pt.lat,
      lng: pt.lng,
      speed_mps: pt.speed_mps ?? null,
      accuracy_m: pt.accuracy_m ?? null,
    })),
  );
  if (insErr) {
    console.error("[finalize] render insert failed", insErr.message);
    return null;
  }

  const taxYear = (trip.tax_year as number) ?? new Date(startIso).getUTCFullYear();
  const classification = (trip.classification as Classification) ?? "unclassified";
  const deductionCents = tripDeductionCents(
    { distanceMiles: track.distanceMiles },
    classification,
    taxYear,
  );
  const newStart = track.points[0].captured_at;
  const newEnd = track.points[track.points.length - 1].captured_at;
  const { error: updErr } = await admin
    .from("mileage_trips")
    .update({
      started_at: newStart,
      ended_at: newEnd,
      distance_miles: Number(track.distanceMiles.toFixed(3)),
      deduction_cents: deductionCents,
    })
    .eq("id", tripId);
  if (updErr) {
    // A started_at collision (unique index) is the only expected failure
    // and is harmless — the points are already corrected; skip the span
    // update rather than abort finalize.
    console.error("[finalize] render trip update failed", updErr.message);
  }
  return { miles: track.distanceMiles, deductionCents };
}

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
    const decision = resolveOverlapAction(
      trip.distanceMiles,
      (overlaps ?? []).map((o) => ({
        id: o.id as string,
        miles: Number(o.distance_miles) || 0,
      })),
    );
    if (decision.action === "consume_to_keeper") {
      await consumeRange(startedAt, endedAt, decision.keeperId);
      // Merge this segment's window into the keeper's rendered track so
      // an absorbed fragment's points are drawn, not just marked consumed
      // (the straight-line bug: consumed-but-never-rendered points).
      await renderTripFromRaw(
        admin,
        userId,
        companyId,
        decision.keeperId,
        startedAt,
        endedAt,
      );
      continue;
    }
    if (decision.action === "replace") {
      await admin.from("mileage_trips").delete().in("id", decision.deleteIds);
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
      // 23505 on (driver_user_id, started_at) = a CONCURRENT finalize run
      // (cron / ingest / page-open all segment the same pool) inserted
      // this exact trip between our overlap read and this insert. We are
      // the race's loser: consume our window to the winner's trip instead
      // of double-materializing the drive (which double-counted the
      // deduction before the unique index existed).
      if ((tripErr as { code?: string } | null)?.code === "23505") {
        const { data: winner } = await admin
          .from("mileage_trips")
          .select("id")
          .eq("driver_user_id", userId)
          .eq("started_at", startedAt)
          .maybeSingle();
        if (winner) {
          await consumeRange(startedAt, endedAt, winner.id as string);
          await renderTripFromRaw(
            admin,
            userId,
            companyId,
            winner.id as string,
            startedAt,
            endedAt,
          );
        }
        continue;
      }
      console.error("[finalize] trip insert failed", tripErr?.message);
      continue;
    }

    await consumeRange(startedAt, endedAt, inserted.id);

    // Render the track from ALL raw in the window (not just this run's
    // segmentation pool), so points that flushed in a separate batch are
    // drawn instead of being silently consumed. Falls back to the
    // in-memory segment if the window somehow reads < 2 raw points, so a
    // freshly-inserted trip is never left with an empty track.
    const rendered = await renderTripFromRaw(
      admin,
      userId,
      companyId,
      inserted.id,
      startedAt,
      endedAt,
    );
    if (!rendered) {
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
        if (ptErr)
          console.error("[finalize] points insert failed", ptErr.message);
      }
    }

    tripsCreated++;
    if (classification === "business") {
      // Prefer the raw-rebuilt distance/deduction (corrects a partial
      // segmentation pool) over the in-memory estimate when available.
      businessMiles += rendered?.miles ?? trip.distanceMiles;
      deductionCents += rendered?.deductionCents ?? dCents;
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
