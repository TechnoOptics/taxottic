// Build-independent driver drive-tracking health.
//
// Every prior "our drives stopped" incident split into a few distinct
// device states that need DIFFERENT responses, and the app couldn't tell
// them apart. This evaluator derives the state purely from what the
// SERVER already observes in mileage_points_raw — last upload, last real
// movement — plus the toggle intent. Deriving it from raw uploads (not
// the device heartbeat) is the whole point: it works even for a phone on
// a months-old build that never sends our newer heartbeat fields.
//
// The two failure modes, kept separate because the fix differs:
//   - SILENT: the device stopped talking to the server entirely. Tracker
//     dead (iOS Always->While-Using revert, app killed, permission lost).
//   - PARKED: uploads are flowing fine, but nothing has MOVED in a long
//     time. The tracked phone isn't the one being driven with (e.g. a
//     spare/kiosk device sitting on a desk). Not a bug — needs a human to
//     point tracking at the right phone.

/** No upload for this long while tracking is ON = the device went dark.
 *  Matches the tracker-stall push floor so the two agree. */
export const SILENT_AFTER_MS = 3 * 60 * 60_000; // 3h

/** Uploading fine but no real movement for this long = the tracked phone
 *  probably isn't the driven one. Deliberately generous so a normal
 *  no-driving stretch (a weekend, a desk day) never trips it. */
export const PARKED_AFTER_MS = 48 * 60 * 60_000; // 48h

/** Speed (m/s) that counts as genuine vehicle movement, not GPS jitter
 *  on a stationary phone. ~5.6 mph. Mirrors the movement filter used to
 *  find `last_real_movement` in triage. */
export const MOVEMENT_SPEED_MPS = 2.5;

export type DriveTrackingHealth =
  | "healthy" // recent upload AND recent movement
  | "silent" // tracking on, but no upload for SILENT_AFTER_MS
  | "parked" // uploading, but no movement for PARKED_AFTER_MS
  | "off" // tracking toggle is off (not an alarm)
  | "never"; // tracking on, never uploaded anything

export type DriveHealthSignals = {
  nowMs: number;
  /** Newest mileage_points_raw.created_at for this driver, or null. */
  lastUploadMs: number | null;
  /** Newest raw point with speed >= MOVEMENT_SPEED_MPS, or null. */
  lastMovementMs: number | null;
  /** The driver's own toggle intent (mileage_device_status.tracking_enabled).
   *  Unknown/absent is treated as ON, so a device that never sent a
   *  heartbeat but IS uploading still gets watched. */
  trackingEnabled: boolean | null;
};

export type DriveHealthResult = {
  status: DriveTrackingHealth;
  /** ms since the relevant event (silence for silent, stillness for
   *  parked), or null when not applicable. */
  ageMs: number | null;
};

/**
 * Pure classification. Order matters: an OFF toggle is never an alarm; a
 * device that has genuinely gone silent takes precedence over "parked"
 * (no uploads means we can't even see movement); parked only applies
 * while uploads are still current.
 */
export function evaluateDriveTrackingHealth(
  s: DriveHealthSignals,
): DriveHealthResult {
  // Explicit opt-out: the driver turned tracking off. Not our alarm.
  if (s.trackingEnabled === false) return { status: "off", ageMs: null };

  if (s.lastUploadMs == null) {
    // Never uploaded. Only interesting if they intend to track.
    return { status: "never", ageMs: null };
  }

  const silence = s.nowMs - s.lastUploadMs;
  if (silence >= SILENT_AFTER_MS) {
    return { status: "silent", ageMs: silence };
  }

  // Uploads are current. Is anything actually moving?
  const stillness =
    s.lastMovementMs == null ? s.nowMs - s.lastUploadMs : s.nowMs - s.lastMovementMs;
  if (stillness >= PARKED_AFTER_MS) {
    return { status: "parked", ageMs: stillness };
  }

  return { status: "healthy", ageMs: null };
}

/** Compact human label for a health result, e.g. "Silent 5h" / "Parked 3d". */
export function describeDriveHealth(r: DriveHealthResult): string {
  switch (r.status) {
    case "healthy":
      return "Tracking";
    case "off":
      return "Tracking off";
    case "never":
      return "No drives yet";
    case "silent":
      return `Silent ${formatAge(r.ageMs)}`;
    case "parked":
      return `Parked ${formatAge(r.ageMs)}`;
  }
}

function formatAge(ms: number | null): string {
  if (ms == null) return "";
  const h = ms / 3_600_000;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}
