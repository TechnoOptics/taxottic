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
 * Supply the actual heartbeat sender. Called at module scope by
 * native-tracker (which owns sendHeartbeat and everything it reads).
 *
 * This is an optimisation, not the contract. If native-tracker never loads,
 * the timer fetches the sender itself. See ensureHeartbeatTimer.
 */
export function registerHeartbeatSender(fn: () => void): void {
  beat = fn;
}

/**
 * Resolve the heartbeat sender, importing native-tracker if nothing has
 * registered one.
 *
 * The registration alone is NOT sufficient, and the reason is worth stating
 * because the first draft of this file got it backwards.
 *
 * native-tracker imports device-status and geofence. That means loading
 * native-tracker loads them. It does NOT mean loading them loads
 * native-tracker, and the arrow only points one way:
 *
 *   app/mileage/page.tsx -> TrackerStatus -> geofence
 *
 * is a real chunk in this app that pulls in geofence with no native-tracker
 * anywhere in the graph. On that chunk nothing ever registers a sender, so
 * an ensureHeartbeatTimer() that bailed out on a null sender would arm
 * nothing and go silent in precisely the way this whole change exists to
 * prevent.
 *
 * A dynamic import is safe here where a static one is not: it runs inside a
 * timer callback minutes after module init, so there is no cycle to resolve
 * and nothing is half-initialised by the time it lands.
 */
async function resolveSender(): Promise<(() => void) | null> {
  if (beat) return beat;
  try {
    const mod = await import("./native-tracker");
    if (!beat && typeof mod.sendHeartbeat === "function") {
      beat = () => {
        void mod.sendHeartbeat();
      };
    }
  } catch {
    // Offline, or the chunk failed to load. The next tick tries again;
    // a heartbeat is not worth surfacing an error to the driver over.
  }
  return beat;
}

/**
 * Start the heartbeat timer if it is not already running.
 *
 * Safe to call from anywhere, as often as you like: one null check. Call it
 * wherever points are successfully handed to the server.
 *
 * Deliberately does NOT require a registered sender. The timer starts
 * regardless and resolves the sender on its first tick, so arming works on
 * any chunk that can reach the ingest endpoint.
 *
 * Beats once immediately as well as on the interval. Two reasons, and the
 * first is the one that matters:
 *
 * A short-lived page that ingests a few points and unloads inside five
 * minutes would otherwise report nothing at all, which is the exact shape
 * of the blackout this change exists to end. A driver who opens the app at
 * a stop, uploads a buffer and closes it again is a normal user, not an
 * edge case, and on the interval-only version they stay invisible.
 *
 * Second, it makes the fix observable. A change to a five-minute timer that
 * can only be confirmed by waiting five minutes on a real handset is a
 * change that gets shipped on reasoning instead of evidence, and reasoning
 * is what produced v166 and the first draft of v167.
 */
export function ensureHeartbeatTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    void resolveSender().then((fn) => fn?.());
  }, HEARTBEAT_EVERY_MS);
  void resolveSender().then((fn) => fn?.());
}

/** Test seam. Not used by the app. */
export function __resetHeartbeatTimerForTest(): void {
  if (timer) clearInterval(timer);
  timer = null;
  beat = null;
}
