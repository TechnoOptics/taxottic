/**
 * Should the drive log re-render because the driver just came back to it?
 *
 * ## The failure this exists to end
 *
 * /mileage is a server component. Its data is correct for the instant it
 * rendered and, once mounted, nothing on the page ever asks the server
 * again. On a desktop tab that is invisible. On a phone it is the whole
 * bug, because the Taxottic app is a WebView on a remote URL and the OS
 * keeps that page alive across backgrounding: the driver opens the app,
 * drives, comes back, and is shown the render from before the drive.
 *
 * Both reporting drivers described the same workaround: "they have to
 * click around and different things so hopefully the drives can refresh".
 * Clicking around is a navigation, and a navigation is a fresh render.
 * They were hand-cranking the thing this module now does on its own.
 *
 * ## Why the drive is genuinely missing at render time
 *
 * It is not, mostly, the finalize time-box. `shouldCloseOpenTail` refuses
 * to close a trip without positive evidence the phone is parked rather
 * than merely silent: a heartbeat that lands a full TRIP_END_DWELL_MS
 * after the newest point, or the six-hour ceiling. So a driver who parks
 * and opens the app three minutes later gets a render whose finalize ran,
 * succeeded, and correctly created nothing, because the drive is not
 * closeable yet. `finalizeOutstanding` is false, FinalizeSettleRefresh is
 * not rendered, and the page is then frozen on an answer that goes out of
 * date a few minutes later.
 *
 * ## Why an event and not a timer
 *
 * A backgrounded WebView freezes setInterval and setTimeout while native
 * callbacks keep arriving; this repo has measured timer_lag_ms in the
 * hours. Any schedule set before the app goes away is therefore worthless
 * exactly when it is needed. So the trigger is a real event the WebView
 * still delivers on the way back in (visibilitychange, which PWASetup's
 * service-worker adoption already depends on for this same case), and the
 * decision is gated on the WALL CLOCK rather than on a timer having run.
 *
 * ## Why not a poll
 *
 * A poll on a page a driver leaves open is a per-phone load with no end,
 * and it could not honestly promise the case it would be bought for: with
 * the tail-close ceiling at six hours there is no near deadline to poll
 * up to. Returning to the app is the moment the driver actually looks,
 * and it is free.
 *
 * ## Why this is not a reload
 *
 * The caller uses router.refresh(), which refetches the RSC payload and
 * leaves every client component mounted. A window.location.reload() here
 * would re-run the tracker's arm sequence, whose first act is
 * `await stopBgSafely(bg)`; a backgrounded iOS WebView suspends at that
 * await and never reaches start(). That is the Grace outage (see
 * PWASetup), and return-refresh-wiring.test.ts holds the line on it.
 */

/**
 * How stale a render must be before returning to it is worth a re-render.
 *
 * Two forces set this. Too low and every tap that moves focus (a range
 * pill is a navigation, and the focus event follows it) buys a second
 * render on top of the one the tap already caused. Too high and a driver
 * who parks, walks in, and opens the app is still shown the stale list.
 * Forty-five seconds is above any tap-and-return and far below the gap
 * between a drive and the next time somebody opens the app.
 */
export const RETURN_REFRESH_MIN_STALE_MS = 45_000;

export function shouldRefreshOnReturn(args: {
  /** document.visibilityState at the moment the event fired. */
  visibility: string;
  nowMs: number;
  /** When the data on screen was last known good, in the same clock as
   *  `nowMs`. Null until the caller's effect has stamped a render, which
   *  is not the same thing as a page that has gone stale. */
  lastRefreshedAtMs: number | null;
  minStaleMs?: number;
}): boolean {
  const { visibility, nowMs, lastRefreshedAtMs } = args;
  const minStaleMs = args.minStaleMs ?? RETURN_REFRESH_MIN_STALE_MS;

  if (visibility !== "visible") return false;
  if (lastRefreshedAtMs === null) return false;
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastRefreshedAtMs))
    return false;

  const ageMs = nowMs - lastRefreshedAtMs;
  // A backward clock jump makes age negative. Staleness is then unknowable,
  // and refusing costs one missed auto-refresh, whereas trusting it would
  // fire on every event until the clock caught up.
  if (ageMs < 0) return false;

  return ageMs >= minStaleMs;
}
