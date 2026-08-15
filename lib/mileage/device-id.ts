/**
 * A stable per-install id, so one driver's devices can be told apart.
 *
 * WHY THIS EXISTS
 *
 * `mileage_device_status` holds one row per (driver, company). A driver
 * with two devices therefore has them overwrite each other, and on
 * 2026-08-15 that produced a status row alternating between app_version
 * 1.3.9 and 1.3.1 thirty-one seconds apart. It reads exactly like a
 * downgrade, it was diagnosed as one, and the diagnosis was wrong. No
 * column existed that could have contradicted it.
 *
 * WHAT THIS DELIBERATELY IS NOT
 *
 * Not a hardware identifier. Not IDFV, not ANDROID_ID, not a fingerprint
 * assembled from screen size and user agent. Apple and Google both treat
 * those as tracking, and this app already declares that it collects
 * precise location, so adding a durable hardware id would change what we
 * would have to disclose for a question that does not need it.
 *
 * The only question is "same install, or a different one". A random uuid
 * answers that completely. It cannot identify a person, cannot be
 * correlated across apps, and carries no meaning off this device.
 *
 * Clearing site data resets it, which yields a NEW device rather than a
 * wrong one: the timeline splits, and a split timeline is honest about
 * what happened. That is the correct failure mode for a diagnostic.
 */

const KEY = "taxottic.deviceId";

/**
 * Prefixed so an id is recognisable in a database row without having to
 * ask what column it came from, and so it can never be mistaken for a
 * user id, a trip id, or anything else uuid-shaped in the same payload.
 */
const PREFIX = "dev_";

function randomId(): string {
  const c: Crypto | undefined =
    typeof globalThis !== "undefined"
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  if (c?.randomUUID) return PREFIX + c.randomUUID();
  // getRandomValues is available in every WebView this ships to; the
  // Math.random tail is a last resort that keeps a heartbeat reporting
  // SOMETHING rather than dropping the field. A weak id is still a
  // usable discriminator between two devices.
  if (c?.getRandomValues) {
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    return (
      PREFIX +
      Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
    );
  }
  return PREFIX + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Read the id, creating and persisting one on first call.
 *
 * Returns null on the server and whenever storage is unavailable
 * (private mode, disabled cookies, a locked WebView). Null is the honest
 * answer and is stored as null: an id invented per-call would be WORSE
 * than none, because every heartbeat would look like a brand new device
 * and the history this exists to make readable would become noise.
 */
export function getDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = randomId();
    window.localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}
