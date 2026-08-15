import type { SupabaseClient } from "@supabase/supabase-js";
import {
  autoClassify,
  haversineMeters,
  MAX_CAPTURE_GAP_MS,
  METERS_PER_MILE,
  MIN_TRIP_METERS,
  segmentTrips,
  suggestClassification,
  type Place,
  type Classification,
} from "./segmentation";
import { shouldCloseOpenTail } from "./tail-close";
import { tripDeductionCents } from "./deduction";
import { buildTrackFromRaw, type RawPoint } from "./track";
import { notify } from "@/lib/push";
import { placesForTrip } from "./place-match";

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
 * Never let the render pass shrink a trip's drawn track: only replace
 * when the rebuilt track is at least as detailed (>= existing count) and
 * has the 2-point minimum. Pure so the safety invariant is unit-tested.
 */
export function shouldReplaceTrack(
  existingRenderedCount: number,
  rebuiltCount: number,
): boolean {
  return rebuiltCount >= 2 && rebuiltCount >= existingRenderedCount;
}

/** A trip whose average speed is physically impossible is corrupt data
 *  (timestamp poisoning, interleaved backlogs, GPS teleports), never a
 *  real drive. Highest sustained legal-ish average on US interstates is
 *  ~85 mph; 100 leaves margin. Observed live before this gate: 808, 314
 *  and 1,343 "mile" trips fabricated from a time-shifted backlog, worth
 *  \$1,875 of false deduction across one evening. */
export const MAX_PLAUSIBLE_AVG_MPH = 100;

export function isPlausibleTrip(
  distanceMiles: number,
  startMs: number,
  endMs: number,
): boolean {
  const hours = Math.max((endMs - startMs) / 3_600_000, 1 / 120); // >=30s
  return distanceMiles / hours <= MAX_PLAUSIBLE_AVG_MPH;
}

/** Why a rebuilt track was refused. Both modes fabricate distance; they
 *  are separated because they have different causes and different fixes. */
export type RenderRefusal =
  | { reason: "implausible_average_speed"; miles: number; minutes: number }
  | {
      reason: "unsupported_gap";
      miles: number;
      gapMiles: number;
      gapMinutes: number;
    };

/**
 * The plausibility gate for the RE-RENDER path (FMEA C6).
 *
 * `renderTripFromRaw` recomputes `distance_miles` and `deduction_cents`
 * from whatever raw falls in a window and writes them. `isPlausibleTrip`
 * guards only the INSERT, so a rebuild could fabricate distance on a
 * drive a human had already confirmed, at the full IRS rate.
 *
 * Two checks, because the insert gate alone is NOT sufficient here:
 *
 *  1. Impossible average speed. The insert-path test, reused verbatim.
 *     Catches the mode already seen in production: a time-shifted
 *     backlog rendered into a short window as 808, 314 and 1,343 "mile"
 *     trips, \$1,875 of false deduction in one evening.
 *
 *  2. An unsupported gap. This is the mode check 1 misses and the one
 *     FMEA C6 is actually about. On the `consume_to_keeper` path the
 *     render window is the UNION of the keeper's span and the
 *     candidate's, clamped only by neighbouring trips, so it can reach
 *     across a long stretch that produced no trip at all. The rebuild
 *     then joins the surviving points with a straight line and sums the
 *     haversine. Two real 5-mile drives 3 hours apart become one
 *     60-mile trip whose average speed is a perfectly innocent 18 mph.
 *
 * Neither threshold in check 2 is invented. `MAX_CAPTURE_GAP_MS` is the
 * segmenter's own "a capture gap longer than this ends the open trip";
 * a rebuilt track that draws across a longer gap is claiming miles for a
 * stretch the pipeline's own rules say was not one continuous drive.
 * `MIN_TRIP_METERS` is the segmenter's own "shorter than this is GPS
 * noise, not a drive": a phone parked at a dead stop emits no fixes at
 * all (the 25 m distanceFilter), so a long gap carrying no displacement
 * is evidence of PARKING, and refusing it would undo the deliberate
 * widening of `TRIP_END_DWELL_MS` that stopped train crossings and
 * drive-throughs severing a drive.
 *
 * The asymmetry is deliberate. A false refusal keeps the trip's existing
 * distance, which is the last value the gated insert (or a human)
 * blessed: nothing shrinks, nothing is lost, and the refusal is recorded
 * so the noise surfaces. A false accept claims a fabricated mile against
 * the IRS. A fabricated mile is worse than a missed one.
 *
 * Pure, so the whole safety argument is unit-tested without a database.
 */
export function assessRenderedTrack(
  points: readonly RawPoint[],
  distanceMiles: number,
): RenderRefusal | null {
  if (points.length < 2) return null; // caller already refuses to render
  const startMs = Date.parse(points[0].captured_at);
  const endMs = Date.parse(points[points.length - 1].captured_at);
  if (!isPlausibleTrip(distanceMiles, startMs, endMs)) {
    return {
      reason: "implausible_average_speed",
      miles: distanceMiles,
      minutes: (endMs - startMs) / 60_000,
    };
  }

  let gapMiles = 0;
  let gapMinutes = 0;
  for (let i = 1; i < points.length; i++) {
    const dtMs =
      Date.parse(points[i].captured_at) - Date.parse(points[i - 1].captured_at);
    if (dtMs <= MAX_CAPTURE_GAP_MS) continue;
    const meters = haversineMeters(points[i - 1], points[i]);
    if (meters < MIN_TRIP_METERS) continue; // parked, not travelled
    const legMiles = meters / METERS_PER_MILE;
    if (legMiles > gapMiles) {
      gapMiles = legMiles;
      gapMinutes = dtMs / 60_000;
    }
  }
  if (gapMiles > 0) {
    return {
      reason: "unsupported_gap",
      miles: distanceMiles,
      gapMiles,
      gapMinutes,
    };
  }
  return null;
}

/** One human-readable line for a refusal: the mode, the distance that
 *  was refused, the distance the trip keeps instead, and enough of the
 *  offending shape to start an investigation from a log search alone. */
export function describeRenderRefusal(
  refusal: RenderRefusal,
  keptMiles: number | null,
): string {
  const kept =
    keptMiles == null ? "unknown" : `${keptMiles.toFixed(2)} mi`;
  const shape =
    refusal.reason === "implausible_average_speed"
      ? `over ${refusal.minutes.toFixed(1)} min`
      : `including a ${refusal.gapMiles.toFixed(2)} mi straight line across a ` +
        `${refusal.gapMinutes.toFixed(0)} min capture gap`;
  return (
    `${refusal.reason}: refused a rebuild of ${refusal.miles.toFixed(2)} mi ` +
    `${shape}; trip keeps ${kept}`
  );
}

/**
 * The deduction actually written to a trip row.
 *
 * A drive the machine ASSUMED is business (autoClassify's blanket
 * default fired because no saved place could decide) has no evidence
 * behind it, and an over-claim is an IRS problem where an under-claim
 * is only money left on the table. So it is stored at zero cents until
 * a human confirms it. Every deduction rollup in the app sums stored
 * `deduction_cents` filtered to business, so a zero keeps the drive out
 * of the tax totals with no changes to any money math, while the drive
 * itself still appears on the map and in the trip list.
 *
 * Applied on the INSERT path and on the re-render path alike: a rebuild
 * may grow a drive's miles but must never restore its claim.
 * `null` is a pre-existing row from before the flag, left alone.
 */
export function persistedDeductionCents(
  computedCents: number,
  needsConfirmation: boolean | null,
): number {
  return needsConfirmation === true ? 0 : computedCents;
}

/** Calendar year of an instant in US-Central, the fleet default. UTC
 *  rolls over 6 hours early, misfiling US evening drives near Dec 31. */
export function localTaxYear(
  ms: number,
  timeZone = "America/Chicago",
): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(
      new Date(ms),
    ),
  );
}

/**
 * Make a refused rebuild visible. Two surfaces, because they answer
 * different questions:
 *   - a loud log line, for "what did the pipeline just do"; and
 *   - a row in mileage_render_refusals, for "which trips are frozen and
 *     since when", which a log search cannot answer weeks later.
 *
 * Never throws and never blocks the refusal itself: the trip is already
 * safe (the write was declined), so a ledger failure must not turn a
 * successful refusal into a crashed finalize run.
 */
async function recordRenderRefusal(
  admin: SupabaseClient,
  args: {
    tripId: string;
    userId: string;
    companyId: string;
    refusal: RenderRefusal;
    keptMiles: number | null;
    windowStartIso: string;
    windowEndIso: string;
  },
): Promise<void> {
  const detail = describeRenderRefusal(args.refusal, args.keptMiles);
  console.error(
    `[finalize] RENDER REFUSED trip=${args.tripId} driver=${args.userId} ${detail}`,
  );
  try {
    const { error } = await admin.rpc("mileage_record_render_refusal", {
      p_trip_id: args.tripId,
      p_driver_user_id: args.userId,
      p_company_id: args.companyId,
      p_reason: args.refusal.reason,
      p_refused_miles: Number(args.refusal.miles.toFixed(3)),
      p_kept_miles:
        args.keptMiles == null ? null : Number(args.keptMiles.toFixed(3)),
      p_detail: detail,
      p_window_start: args.windowStartIso,
      p_window_end: args.windowEndIso,
    });
    if (error) {
      console.error("[finalize] refusal ledger write failed", error.message);
    }
  } catch (err) {
    console.error(
      "[finalize] refusal ledger write threw",
      err instanceof Error ? err.message : String(err),
    );
  }
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
  hooks?: { onRefusal?: (refusal: RenderRefusal) => void },
): Promise<{ miles: number; deductionCents: number } | null> {
  const { data: trip } = await admin
    .from("mileage_trips")
    .select(
      "started_at, ended_at, classification, tax_year, needs_confirmation, distance_miles",
    )
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

  // Provenance guard (audit critical #1): manual and route trips carry a
  // user-authored distance that is NOT derivable from raw GPS. A partial
  // stranded trace inside their window must never overwrite them — that
  // was destroying IRS-defensible odometer entries with 8-mile fragments.
  {
    const { data: t, error: srcErr } = await admin
      .from("mileage_trips")
      .select("source")
      .eq("id", tripId)
      .maybeSingle();
    // FAIL CLOSED. This guard is what stops a raw rebuild overwriting a
    // user-authored odometer entry, and it used to ignore `error`. On a
    // query error `t` is null, the condition below is false, and the
    // rebuild proceeded, destroying exactly the IRS-defensible entries
    // the guard exists to protect. PostgREST returns errors as values
    // rather than throwing, so this is a realistic path, not a
    // hypothetical.
    if (srcErr) {
      console.error(
        "[finalize] provenance read failed, refusing to re-render",
        tripId,
        srcErr.message,
      );
      return null;
    }
    if (t && (t as { source?: string }).source !== "tracked") return null;
  }

  // Safety invariant: the render pass may only ADD detail to a trip,
  // never lose it. If a rebuild would produce fewer points than are
  // already drawn (a truncated/failed window read, a mid-flush race),
  // skip the replace and keep the existing track. This makes the render
  // path safe-by-construction — it can heal a broken trip but can never
  // itself corrupt a healthy one.
  const { count: existingCount, error: countErr } = await admin
    .from("mileage_points")
    .select("*", { count: "exact", head: true })
    .eq("trip_id", tripId);
  // FAIL CLOSED, same reasoning as the provenance guard above. This read
  // used to ignore `error`, and `existingCount ?? 0` then made
  // shouldReplaceTrack always pass, so a query error turned the
  // never-shrink invariant into a no-op and a truncated rebuild could
  // overwrite a more detailed track. An unknown count is not zero.
  if (countErr) {
    console.error(
      "[finalize] existing-track count failed, refusing to re-render",
      tripId,
      countErr.message,
    );
    return null;
  }
  if (!shouldReplaceTrack(existingCount ?? 0, track.points.length)) {
    return null;
  }

  // Plausibility gate for the re-render (FMEA C6). Deliberately sits
  // AFTER the never-shrink check and BEFORE the destructive delete
  // below: a refusal must leave the trip exactly as it was, track and
  // distance both. The trip keeps whatever the gated insert (or a human)
  // last blessed, and the refusal is recorded so a frozen trip is
  // findable instead of silent.
  const refusal = assessRenderedTrack(track.points, track.distanceMiles);
  if (refusal) {
    const keptMiles = Number(trip.distance_miles);
    await recordRenderRefusal(admin, {
      tripId,
      userId,
      companyId,
      refusal,
      keptMiles: Number.isFinite(keptMiles) ? keptMiles : null,
      windowStartIso: startIso,
      windowEndIso: endIso,
    });
    hooks?.onRefusal?.(refusal);
    return null;
  }

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
  const newStart = track.points[0].captured_at;
  // Still unconfirmed? Then this rebuild rewrites the distance but must
  // NOT resurrect the claim. Once a human has confirmed the drive the
  // flag is false (reclassifyTripCore clears it), so their decision
  // wins here and the real deduction is recomputed as before.
  const deductionCents = persistedDeductionCents(
    tripDeductionCents(
      { distanceMiles: track.distanceMiles },
      classification,
      taxYear,
      newStart,
    ),
    (trip.needs_confirmation as boolean | null) ?? null,
  );
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

/**
 * Is auto-apply on for this driver? On unless the driver explicitly
 * turned it off (profiles.mileage_schedule.autoApplyBusiness === false).
 * Fails open: a missing profile row or a read error keeps drives
 * landing automatically rather than silently reviving the review queue.
 */
export async function autoApplyEnabled(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  try {
    const { data } = await admin
      .from("profiles")
      .select("mileage_schedule")
      .eq("id", userId)
      .maybeSingle();
    const sched =
      (data?.mileage_schedule as { autoApplyBusiness?: boolean } | null) ??
      null;
    return sched?.autoApplyBusiness !== false;
  } catch {
    return true;
  }
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

  // Auto-apply: a finished drive lands already classified so it shows
  // up on the map and in the deduction the moment it materialises,
  // with no review queue and no "business or personal?" push. This is
  // the default. The driver can still change any drive's call
  // afterwards from the trip list (or /mileage/classify).
  //
  // profiles.mileage_schedule.autoApplyBusiness is the existing opt-out
  // (the watch's "Auto-apply business" toggle writes it). Only an
  // explicit `false` restores the old review flow, so users who never
  // touch the toggle, and every row where mileage_schedule is NULL, get
  // the automatic behaviour.
  const autoApply = await autoApplyEnabled(admin, userId);

  // Close the open trip when the caller forces it (sessionEnded /
  // walked-away: an explicit, evidence-backed end) or when the user
  // has been parked for the SAME 10-minute dwell the in-stream
  // segmentation uses. It used to be the 5-min STATIONARY dwell, which
  // quietly undercut the June 2026 fragmentation fix (audit major
  // #15): at a dead stop the 25 m distanceFilter emits no fixes, the
  // 30 s heartbeats keep re-running this test, and any train crossing
  // or drive-through longer than 5 minutes severed the drive into two
  // trips — shaving deductible connector miles every time.
  // The device's own last word, used to tell an IDLE phone from a SILENT
  // one. Heartbeats ride the same fetch path as the points, so an upload
  // stall silences both; a heartbeat newer than the last point is
  // therefore real evidence the phone was alive and simply not driving.
  // See shouldCloseOpenTail for the day of measurements behind this.
  const { data: statusRow } = await admin
    .from("mileage_device_status")
    .select("reported_at")
    .eq("driver_user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();
  const reportedMs = statusRow?.reported_at
    ? Date.parse(statusRow.reported_at as string)
    : NaN;

  const closeOpenAtEnd = shouldCloseOpenTail({
    forceClose: opts.forceClose,
    lastPointTs: allPoints[allPoints.length - 1].ts,
    deviceReportedAtMs: Number.isFinite(reportedMs) ? reportedMs : null,
    nowMs: Date.now(),
  });
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
      .select(
        "id, distance_miles, source, classification, classified_by, classified_at, notes",
      )
      .eq("company_id", companyId)
      .eq("driver_user_id", userId)
      .lte("started_at", endedAt)
      .gte("ended_at", startedAt);
    // User-authored trips (manual odometer entry, route reconstruction)
    // are authoritative for their window: the machine defers. Consume the
    // raw range to them WITHOUT re-rendering (their distance/polyline is
    // not raw-derived) and never insert a competing auto trip on top.
    const authored = (overlaps ?? []).find(
      (o) => (o as { source?: string }).source && (o as { source?: string }).source !== "tracked",
    );
    if (authored) {
      await consumeRange(startedAt, endedAt, authored.id as string);
      continue;
    }
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
      // Clamp the render window to the keeper's own span union this
      // segment. Rendering a raw range that reaches across ANOTHER
      // existing trip made both trips draw the same points, so the same
      // miles were counted twice (audit #16).
      const { data: keeper } = await admin
        .from("mileage_trips")
        .select("started_at, ended_at")
        .eq("id", decision.keeperId)
        .maybeSingle();
      const kStart = keeper?.started_at
        ? (keeper.started_at as string)
        : startedAt;
      const kEnd = keeper?.ended_at ? (keeper.ended_at as string) : endedAt;
      const unionStart = startedAt < kStart ? startedAt : kStart;
      const unionEnd = endedAt > kEnd ? endedAt : kEnd;
      const { data: neighbours } = await admin
        .from("mileage_trips")
        .select("started_at, ended_at")
        .eq("company_id", companyId)
        .eq("driver_user_id", userId)
        .neq("id", decision.keeperId)
        .lte("started_at", unionEnd)
        .gte("ended_at", unionStart);
      let clampedStart = unionStart;
      let clampedEnd = unionEnd;
      for (const n of neighbours ?? []) {
        const nStart = n.started_at as string;
        const nEnd = n.ended_at as string;
        if (nEnd <= kStart && nEnd > clampedStart) clampedStart = nEnd;
        if (nStart >= kEnd && nStart < clampedEnd) clampedEnd = nStart;
      }
      await renderTripFromRaw(
        admin,
        userId,
        companyId,
        decision.keeperId,
        clampedStart,
        clampedEnd,
      );
      continue;
    }
    // Human classification survives a replace (audit critical #2): if any
    // fragment being superseded was classified by a person, the fuller
    // successor inherits that decision (and its notes) instead of a fresh
    // auto-suggestion silently discarding review work — or worse,
    // flipping a user-marked-personal drive back to business.
    let carried: {
      classification: "business" | "personal" | "unclassified";
      classified_by: string;
      classified_at: string | null;
      notes: string | null;
    } | null = null;
    if (decision.action === "replace") {
      const humanClassified = (overlaps ?? [])
        .filter(
          (o) =>
            decision.deleteIds.includes(o.id as string) &&
            (o as { classified_by?: string | null }).classified_by != null,
        )
        .sort(
          (a, b) =>
            (Number(b.distance_miles) || 0) - (Number(a.distance_miles) || 0),
        )[0];
      if (humanClassified) {
        carried = {
          classification: (humanClassified as { classification: string })
            .classification as "business" | "personal" | "unclassified",
          classified_by: (humanClassified as { classified_by: string })
            .classified_by,
          classified_at:
            (humanClassified as { classified_at: string | null })
              .classified_at ?? null,
          notes: (humanClassified as { notes: string | null }).notes ?? null,
        };
      }
      await admin.from("mileage_trips").delete().in("id", decision.deleteIds);
    }

    // A carried human call always wins, including a deliberate "review
    // later". Otherwise the machine decides, and with auto-apply on it
    // must decide fully: no drive is parked in a review queue.
    //
    // `needsConfirmation` records that the machine GUESSED rather than
    // decided. A carried human call is never a guess, so inheriting one
    // clears the flag: a re-render cannot resurrect it on a drive
    // somebody already confirmed.
    const auto = carried || !autoApply ? null : autoClassify(trip, places);
    const classification = carried
      ? carried.classification
      : (auto?.classification ?? suggestClassification(trip, places));
    const needsConfirmation = auto?.needsConfirmation ?? false;
    // Tax year from the trip's LOCAL date. A US evening drive on Dec 31
    // is already Jan 1 in UTC, so getUTCFullYear() filed it under the
    // WRONG tax year — the deduction landed in a return the user had
    // already filed (audit #34). America/Chicago is the fleet default
    // until a per-company timezone exists; any US zone puts a Dec-31
    // evening drive back in the right year.
    const taxYear = localTaxYear(trip.startTs);
    const dCents = persistedDeductionCents(
      tripDeductionCents(
        { distanceMiles: trip.distanceMiles },
        classification,
        taxYear,
        startedAt,
      ),
      needsConfirmation,
    );

    // Plausibility gate: refuse to CREATE an impossible trip. The
    // segmenter can only be as good as its input; poisoned timestamps
    // upstream must die here, not surface as a four-digit deduction on
    // someone's phone.
    if (!isPlausibleTrip(trip.distanceMiles, trip.startTs, trip.endTs)) {
      console.error(
        `[finalize] IMPLAUSIBLE trip rejected: ${trip.distanceMiles.toFixed(1)} mi in ` +
          `${((trip.endTs - trip.startTs) / 60_000).toFixed(1)} min (driver=${userId})`,
      );
      continue;
    }

    const { data: inserted, error: tripErr } = await admin
      .from("mileage_trips")
      .insert({
        company_id: companyId,
        driver_user_id: userId,
        started_at: startedAt,
        ended_at: endedAt,
        distance_miles: Number(trip.distanceMiles.toFixed(3)),
        classification,
        classified_by: carried?.classified_by ?? null,
        classified_at: carried?.classified_at ?? null,
        needs_confirmation: needsConfirmation,
        notes: carried?.notes ?? null,
        tax_year: taxYear,
        deduction_cents: dCents,
        // Anchor the drive to the company's places.
        //
        // These two columns have existed since the first mileage
        // migration and were NEVER WRITTEN: 185 trips recorded between
        // 2026-06-01 and 2026-08-15 all carried null on both, while
        // app/mileage/business/page.tsx rendered them through
        // placeLabel() and therefore showed every drive with no "from"
        // and no "to". That is what a driver means when a trip "does
        // not show the complete start and finish".
        //
        // It also silently disabled the operator question that matters:
        // "they arrived at a client, so where is the drive that left
        // home?" cannot be asked while no trip knows where it began.
        //
        // placesForTrip returns null for a point that is inside no
        // place, which is a legitimate answer and much better than
        // labelling a motorway services as "home". See
        // lib/mileage/place-match.ts.
        ...placesForTrip(
          { lat: trip.startPoint.lat, lng: trip.startPoint.lng },
          { lat: trip.endPoint.lat, lng: trip.endPoint.lng },
          places.map((pl) => ({
            id: pl.id,
            lat: pl.lat,
            lng: pl.lng,
            radius_m: pl.radiusM,
          })),
        ),
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
      if (classification === "unclassified" && !autoApply) {
        // Only reachable with auto-apply explicitly turned off. With it
        // on, a drive is never left needing a call, so the "business or
        // personal?" push never fires, including for a drive whose
        // human classifier had chosen "review later".
        await notify(userId, {
          kind: "trip_classify",
          tripId: inserted.id,
          miles: trip.distanceMiles,
          whenLabel: new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Chicago",
            hour: "numeric",
            minute: "2-digit",
          }).format(new Date(trip.startTs)),
        });
      } else if (classification !== "unclassified") {
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

export type ReconcileResult = {
  scanned: number;
  healed: number;
  /** Rebuilds the plausibility gate declined to write. Non-zero here is
   *  the alarm: the reconciler is repeatedly trying to write a
   *  fabricated distance onto real trips. */
  refused: number;
};

/**
 * Self-healing safety net. Scans recent trips for the "straight line
 * across no road" signature — a trip whose own time window contains
 * materially more usable raw points than are actually drawn — and
 * rebuilds each from the raw window. renderTripFromRaw is idempotent and
 * can only add detail (see shouldReplaceTrack), so this is safe to run on
 * every cron tick: a healthy trip is left untouched, and any trip a
 * future regression breaks is repaired within one cron interval instead
 * of silently corrupting a driver's mileage forever.
 *
 * Detection runs in one indexed DB function (mileage_broken_trips) so the
 * per-trip point-count comparison never round-trips through the app.
 */
export async function reconcileBrokenTrips(
  admin: SupabaseClient,
  opts: { sinceIso: string; limit?: number },
): Promise<ReconcileResult> {
  const limit = opts.limit ?? 200;
  const { data, error } = await admin.rpc("mileage_broken_trips", {
    p_since: opts.sinceIso,
    p_lim: limit,
  });
  if (error) {
    console.error("[reconcile] broken-trip scan failed", error.message);
    return { scanned: 0, healed: 0, refused: 0 };
  }
  const rows = (data ?? []) as Array<{
    trip_id: string;
    driver_user_id: string;
    company_id: string;
    started_at: string;
    ended_at: string;
  }>;
  let healed = 0;
  let refused = 0;
  for (const r of rows) {
    try {
      const res = await renderTripFromRaw(
        admin,
        r.driver_user_id,
        r.company_id,
        r.trip_id,
        r.started_at,
        r.ended_at,
        { onRefusal: () => refused++ },
      );
      if (res) {
        healed++;
        console.warn(
          `[reconcile] healed trip ${r.trip_id} (${res.miles.toFixed(2)} mi)`,
        );
      }
    } catch (err) {
      console.error(
        "[reconcile] heal failed",
        r.trip_id,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return { scanned: rows.length, healed, refused };
}
