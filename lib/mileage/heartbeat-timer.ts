/**
 * The heartbeat's timer, in its own module so every ingest path can arm it.
 *
 * WHY THIS IS SEPARATE FROM native-tracker.ts.
 *
 * Points reach the server by THREE paths:
 *
 *   native-tracker.ts  postJson("/api/mileage/ingest")   the flush loop
 *   geofence.ts        fetch("/api/mileage/ingest")      geofence wake
 *   device-status.ts   fetch("/api/mileage/ingest")      native buffer drain
 *
 * The heartbeat originally rode the flush interval, so a device uploading
 * through either of the other two sent GPS every few seconds and never sent
 * a single heartbeat. A real phone did exactly that for 27 hours, which
 * blinded every alarm that reads heartbeats (the stall sweep, the
 * foreground-only detector, arm_interrupted_at, web_build) while each of
 * them individually looked healthy.
 *
 * The obvious fix, exporting the arming function from native-tracker, would
 * make device-status.ts import native-tracker while native-tracker already
 * imports device-status. That cycle is how you get an `undefined is not a
 * function` at module-init time on exactly one code path, which is the last
 * thing this subsystem needs.
 *
 * So the timer lives here and native-tracker REGISTERS its sendHeartbeat
 * into it. Callers that only need to arm it depend on this module alone.
 *
 * The invariant, stated in terms of the server rather than the client: if
 * points are reaching /api/mileage/ingest, health is being reported
 * alongside them. Which client function happens to be sending them is an
 * implementation detail, and making the invariant depend on that detail is
 * what produced the outage.
 */

/** Matches the previous effective rate (10 flush ticks at 30s). */
export const HEARTBEAT_EVERY_MS = 5 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let beat: (() => void) | null = null;

/**
 * Supply the actual heartbeat sender. Called once, at module scope, by
 * native-tracker (which owns sendHeartbeat and everything it reads).
 */
export function registerHeartbeatSender(fn: () => void): void {
  beat = fn;
}

/**
 * Start the heartbeat timer if it is not already running.
 *
 * Safe to call from anywhere, as often as you like: one null check. Call it
 * wherever points are successfully handed to the server.
 *
 * A no-op when no sender has registered, which only happens if this module
 * is loaded without native-tracker. That is not a silent failure worth
 * guarding: native-tracker imports both other ingest paths, so in any build
 * where points flow, the sender is registered.
 */
export function ensureHeartbeatTimer(): void {
  if (timer || !beat) return;
  timer = setInterval(() => {
    beat?.();
  }, HEARTBEAT_EVERY_MS);
}

/** Test seam. Not used by the app. */
export function __resetHeartbeatTimerForTest(): void {
  if (timer) clearInterval(timer);
  timer = null;
  beat = null;
}
