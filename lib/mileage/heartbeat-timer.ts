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
/**
 * The sender's return value is deliberately `unknown` rather than `void`.
 *
 * The ingest-driven path does not care: it fires and forgets. beatOnForeground
 * does, because the render that follows it reads the column this beat writes,
 * and a caller that cannot await the send is a caller that renders first and
 * asks the server second. sendHeartbeat already returns a promise; the old
 * `() => void` signature was throwing it away at the registration site.
 */
let beat: (() => unknown) | null = null;

/**
 * Wall-clock time of the last beat, and the reason this module no longer
 * trusts its own timer.
 *
 * MEASURED, on the driver's Galaxy Fold, 2026-08-09 03:00 to 15:00 UTC:
 * mileage_points_raw took ~50 points an hour for twelve straight hours,
 * one every ~70 seconds, while mileage_device_heartbeats took exactly
 * three, all of them in the two minutes the app was on screen.
 *
 * Neither platform has a native uploader (checked: nothing in
 * android/app/src/main/java or ios/App/App posts to the ingest endpoint),
 * so every one of those points went through a WebView fetch(). The JS
 * page was therefore alive and running location callbacks all night, and
 * each of those callbacks reached ensureHeartbeatTimer(). The interval
 * fired zero times in twelve hours.
 *
 * That is the platform behaviour, not a bug in the app: a backgrounded
 * WebView freezes timers while still delivering native callbacks. So a
 * setInterval is the one primitive that cannot report during a
 * background stretch, which is precisely the stretch worth reporting.
 *
 * The original heartbeat rode the flush loop (flushCount % 10) and was
 * right about this. Giving it its own timer in #541/#542 fixed a real
 * arming bug and simultaneously moved it onto a clock that stops.
 *
 * So the beat is driven by INGEST, on wall clock, and the timer stays
 * only as a foreground convenience. Wall clock rather than a tick count
 * because ingest cadence varies by two orders of magnitude between a
 * parked phone and an active drive.
 */
let lastBeatAt = 0;

/**
 * Supply the actual heartbeat sender. Called at module scope by
 * native-tracker (which owns sendHeartbeat and everything it reads).
 *
 * This is an optimisation, not the contract. If native-tracker never loads,
 * the timer fetches the sender itself. See ensureHeartbeatTimer.
 */
export function registerHeartbeatSender(fn: () => unknown): void {
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
async function resolveSender(): Promise<(() => unknown) | null> {
  if (beat) return beat;
  try {
    const mod = await import("./native-tracker");
    if (!beat && typeof mod.sendHeartbeat === "function") {
      // Returns the promise rather than discarding it, so a caller that
      // needs to know when the beat LANDED can wait for it. sendHeartbeat
      // swallows its own failures, so this never rejects.
      beat = () => mod.sendHeartbeat();
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
 * Beats from the INGEST call itself, on wall clock, not from the interval.
 * See lastBeatAt above for the twelve hours of production measurement that
 * forced this: in a backgrounded WebView the interval does not fire at all,
 * while the location callbacks that reach this function keep running.
 *
 * It also means a short-lived page that drains a buffer and unloads inside
 * five minutes still reports. A driver who opens the app at a stop and
 * closes it again is a normal user, and on the interval-only version they
 * were invisible.
 */
export function ensureHeartbeatTimer(): void {
  if (!timer) {
    // Foreground convenience only. Keeps the beat regular while the app is
    // on screen and ingest happens to be quiet; contributes nothing in the
    // background, where it does not fire at all.
    timer = setInterval(maybeBeat, HEARTBEAT_EVERY_MS);
  }
  // The load-bearing call. Driven by ingest, so it runs on exactly the
  // schedule the location callbacks run on, which is the schedule that
  // survives backgrounding.
  maybeBeat();
}

/**
 * Beat if a heartbeat interval of wall clock has passed since the last one.
 *
 * lastBeatAt is stamped BEFORE the send rather than after, so a slow or
 * failing send cannot queue a second beat behind it. Losing one beat to a
 * failed request is the right trade against a stalled request letting
 * every subsequent ingest fire another.
 */
function maybeBeat(): void {
  const now = Date.now();
  if (lastBeatAt && now - lastBeatAt < HEARTBEAT_EVERY_MS) return;
  lastBeatAt = now;
  void resolveSender().then((fn) => {
    // The sender now returns sendHeartbeat's promise (see `beat` above).
    // This path does not wait for it, but it must not leave the rejection
    // unhandled either.
    void Promise.resolve(fn?.()).catch(() => {});
  });
}

/**
 * The beat that is in flight for the current foregrounding, if any.
 *
 * Both triggers fire on the same return: native-tracker's appStateChange
 * listener, which is the OS's own statement that the app came forward, and
 * the drive log's own visibility handler, which needs to know when the beat
 * LANDED so it can re-render after it. Refusing the second caller would
 * technically be correct anti-spam and would break the thing this exists
 * for, so they share one send and both await it.
 */
let pendingForegroundBeat: Promise<boolean> | null = null;

/**
 * Beat because the app just came forward. Resolves true once a heartbeat
 * has actually been sent, false if the wall-clock gate refused.
 *
 * ## Why foregrounding needs its own trigger at all
 *
 * A finished drive becomes a trip only when finalize can prove the phone was
 * alive AND quiet: `mileage_device_status.reported_at` at least one
 * TRIP_END_DWELL_MS newer than the newest GPS point (see ./tail-close.ts).
 * Heartbeats are the only thing that advances that column and they ride
 * ingest, so a parked car (no movement, no fixes, no ingest) stops them
 * dead. Nothing then restarted them until the driver's next drive, the
 * ten-minute cron catching a device that happened to beat, or the six-hour
 * ceiling. Measured on the reporting driver's handset: three drives on
 * 2026-08-23 became trip rows 6h 33m, 8h 57m and 12h 35m after they ended,
 * all three within four minutes of the beats resuming when the app was next
 * opened. That gap is the "click around and hope the drive shows up" the
 * driver described.
 *
 * ## Why it cannot shorten a drive
 *
 * A heartbeat is evidence of LIFE, never of parking. shouldCloseOpenTail
 * refuses to close before a full dwell of GPS silence however fresh the beat
 * is, so a driver still moving is untouched by this. Nothing here goes near
 * forceClose, which is the flag that would bypass that check.
 *
 * ## Anti-spam
 *
 * Same gate, same field, same constant as maybeBeat: one wall-clock reading
 * of "how recently did we beat". A driver flicking to a text message and
 * back six times posts one heartbeat, not six. Deliberately NOT a second
 * scheme of its own, because two answers to that question means the one
 * nobody reads is the one that spams.
 *
 * No timer, on purpose. A backgrounded WebView freezes setInterval while
 * native callbacks keep arriving; this rides a real OS event and compares
 * the wall clock, which is the only combination that works across a
 * background stretch.
 */
export function beatOnForeground(): Promise<boolean> {
  if (pendingForegroundBeat) return pendingForegroundBeat;

  const now = Date.now();
  if (lastBeatAt && now - lastBeatAt < HEARTBEAT_EVERY_MS)
    return Promise.resolve(false);
  // Stamped BEFORE the send, exactly as maybeBeat does it, so a slow send
  // cannot queue a second beat behind it.
  lastBeatAt = now;

  const run = resolveSender()
    .then(async (fn) => {
      if (!fn) return false;
      await fn();
      return true;
    })
    // Offline, a chunk that would not load, or a sender that threw. The
    // caller must not be told fresh evidence exists when it does not.
    .catch(() => false);
  pendingForegroundBeat = run;
  void run.then(
    () => {
      pendingForegroundBeat = null;
    },
    () => {
      pendingForegroundBeat = null;
    },
  );
  return run;
}

/** Test seam. Not used by the app. */
export function __resetHeartbeatTimerForTest(): void {
  if (timer) clearInterval(timer);
  timer = null;
  beat = null;
  lastBeatAt = 0;
  pendingForegroundBeat = null;
}
