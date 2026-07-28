// Pure buffer arithmetic for the on-device point queue.
//
// Extracted from native-tracker so the dangerous parts are testable.
// The tracker itself is a web of Capacitor/DOM/fetch side effects, but
// the decisions that lose user data are pure — and every mileage
// incident so far has come from one of them.

import type { GpsPoint } from "./segmentation";

/**
 * Remove the points a flush successfully uploaded.
 *
 * MUST be identity-based, not positional. The tracker previously did
 * `buffer = buffer.slice(batch.length)`, which assumes the buffer head
 * is exactly where it was when the POST started. It isn't: the location
 * callback keeps pushing during the request, and at MAX_BUFFER the
 * tracker evicts from the HEAD (`buffer.slice(-MAX_BUFFER)`). When that
 * happens mid-flight the head shifts left, and slicing by count then
 * deletes points that were never sent — silent, permanent loss of the
 * newest data, precisely while the device is under the heaviest load
 * (long drive, poor connectivity, big backlog).
 *
 * Timestamps are the identity the server already uses (ingest is unique
 * on driver+company+captured_at), so matching on `ts` here keeps client
 * and server agreeing on what "the same point" means.
 */
export function removeUploadedPoints(
  buffer: readonly GpsPoint[],
  uploaded: readonly GpsPoint[],
): GpsPoint[] {
  if (uploaded.length === 0) return [...buffer];
  const sent = new Set<number>();
  for (const p of uploaded) sent.add(p.ts);
  return buffer.filter((p) => !sent.has(p.ts));
}

/**
 * Apply the MAX_BUFFER cap, dropping OLDEST points first.
 *
 * Returns the trimmed buffer and how many were dropped, so the caller
 * can report the loss (trackerDiag.evictedPoints) instead of losing it
 * quietly. Oldest-first is deliberate: a drive in progress matters more
 * than one already stranded, and the server's finalizer can still
 * reconstruct older trips from whatever did land.
 */
export function capBuffer(
  buffer: readonly GpsPoint[],
  maxPoints: number,
): { points: GpsPoint[]; evicted: number } {
  if (buffer.length <= maxPoints) return { points: [...buffer], evicted: 0 };
  const evicted = buffer.length - maxPoints;
  return { points: buffer.slice(evicted), evicted };
}

/**
 * Should a flush attempt proceed right now?
 *
 * A `sessionEnded` flush is the force-close that materialises a drive.
 * It must NEVER be silently dropped just because a routine heartbeat
 * flush is in flight — that defect made walk-away fast-close dead code
 * in production. Regular flushes may be skipped freely (the next tick
 * retries); a sessionEnded flush has to be queued instead.
 */
export function flushAdmission(args: {
  flushInFlight: boolean;
  sessionEnded: boolean;
  bufferSize: number;
  tracking: boolean;
}): "send" | "skip" | "queue-session-end" {
  if (args.flushInFlight) {
    return args.sessionEnded ? "queue-session-end" : "skip";
  }
  // An empty buffer is still worth a call when the drive is ending: the
  // server needs the sessionEnded signal itself to force-close.
  if (args.bufferSize === 0 && !args.sessionEnded && args.tracking) {
    return "skip";
  }
  return "send";
}
