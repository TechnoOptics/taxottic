/**
 * Anchor a trip's endpoints to the driver's learned places.
 *
 * WHY THIS EXISTS: 185 trips, zero endpoints.
 *
 * mileage_trips has carried start_place_id and end_place_id since the
 * first migration, app/mileage/business/page.tsx renders them through
 * placeLabel(), and NOTHING HAS EVER WRITTEN THEM. Every trip recorded
 * since 2026-06-01 has null on both, so the business mileage view has
 * always shown a drive with no "from" and no "to".
 *
 * That is what a driver means when they say a trip "did not show the
 * complete start and finish". The miles were right; the journey had no
 * ends.
 *
 * It also silently disabled the check the operator actually wants: you
 * cannot ask "they arrived at a client, so where is the drive that left
 * home?" when no trip knows where it started. Answering that question
 * is downstream of this function returning something.
 *
 * MATCHING RULE, and why it is radius-based rather than nearest.
 *
 * A place carries its own radius (150 to 250 m for learned places), and
 * a point belongs to a place only if it is INSIDE that radius. Nearest
 * match with no ceiling would label a motorway services as "home"
 * because home was the closest of four places thirty miles away, and a
 * wrong label on a tax record is worse than an honest blank.
 *
 * Where radii overlap, the SMALLEST matching radius wins: a precise
 * place is a more specific claim than a broad one, so "client site"
 * beats a wide "downtown" if the point is inside both.
 */

/** Metres between two coordinates. Haversine, earth radius 6371 km. */
export function metresBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type MatchablePlace = {
  id: string;
  lat: number;
  lng: number;
  /** Metres. Missing or nonsense falls back to DEFAULT_RADIUS_M. */
  radius_m?: number | null;
};

/**
 * Used when a place has no radius. Matches the learned-place default
 * used when arming geofences, so a trip is labelled with the same place
 * whose boundary would have triggered capture.
 */
export const DEFAULT_RADIUS_M = 150;

/**
 * A point beyond this is never matched, whatever the stored radius
 * says. Guards against a corrupt or hand-edited radius swallowing a
 * whole city and mislabelling every drive.
 */
export const MAX_MATCH_RADIUS_M = 1_000;

/** The place containing this point, or null. Null is a valid answer. */
export function placeForPoint(
  lat: number,
  lng: number,
  places: MatchablePlace[],
): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let bestId: string | null = null;
  let bestRadius = Infinity;

  for (const p of places) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const radius = Math.min(
      Number.isFinite(p.radius_m as number) && (p.radius_m as number) > 0
        ? (p.radius_m as number)
        : DEFAULT_RADIUS_M,
      MAX_MATCH_RADIUS_M,
    );
    if (metresBetween(lat, lng, p.lat, p.lng) > radius) continue;
    // Smallest matching radius wins. See the header for why.
    if (radius < bestRadius) {
      bestRadius = radius;
      bestId = p.id;
    }
  }
  return bestId;
}

/** Both endpoints at once, the shape the trip insert needs. */
export function placesForTrip(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  places: MatchablePlace[],
): { start_place_id: string | null; end_place_id: string | null } {
  return {
    start_place_id: placeForPoint(start.lat, start.lng, places),
    end_place_id: placeForPoint(end.lat, end.lng, places),
  };
}
