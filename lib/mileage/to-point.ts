import type { GpsPoint } from "./segmentation";

/**
 * Map a plugin Location onto the server's GpsPoint contract, or null if
 * the fix cannot be trusted.
 *
 * WHY A MISSING TIMESTAMP IS A DROP, NOT A DEFAULT.
 *
 * This used to end with:
 *
 *   ts: typeof p.time === "number" && p.time > 0 ? p.time : Date.now(),
 *
 * so a fix arriving without a time was stamped with the moment it was
 * PROCESSED and stored as the moment it was CAPTURED. That is not a
 * rounding error, it is a fabricated fact in a record a driver deducts
 * from their taxes.
 *
 * The damage is worst exactly where the fallback is most likely to fire.
 * A buffered batch drained after a blackout would have every point
 * collapsed onto one instant, putting a whole drive at the wrong time,
 * in the wrong trip, possibly in the wrong tax year, and reading as a
 * teleport cluster that lib/mileage/plausible-jump.ts now refuses at the
 * door anyway.
 *
 * Dropping loses a position. Dating it to now invents one. A lost point
 * is recoverable (the raw window, the reconciler, the reconstruct tool);
 * an invented one is not, because nothing downstream can tell it from a
 * real one. So the ambiguity resolves to null, the same answer this
 * function already gives for a non-finite coordinate.
 *
 * Callers already handle null: the contract has always been
 * `GpsPoint | null`. The caller counts the drops so the loss is visible
 * rather than silent.
 */
export function toPoint(p: {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  time: number | null;
}): GpsPoint | null {
  if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) {
    return null;
  }
  // A capture time we do not have is not a capture time we may invent.
  if (typeof p.time !== "number" || !Number.isFinite(p.time) || p.time <= 0) {
    return null;
  }
  return {
    lat: p.latitude,
    lng: p.longitude,
    ts: p.time,
    speedMps: typeof p.speed === "number" && p.speed >= 0 ? p.speed : undefined,
    accuracyM:
      typeof p.accuracy === "number" && p.accuracy >= 0 ? p.accuracy : undefined,
  };
}
