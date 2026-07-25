// Native app version gating.
//
// Why this exists: a device stuck on an old build silently loses every
// reliability fix we ship (background-tracking self-heal, the iOS
// "Always -> While Using" revert escalation, walk-away drive-end, the
// finalize-race backstop). A phone on 1.0 has NONE of them, and nothing
// in the product told the user to update — that is how a device sat on a
// months-old build for weeks while its drives quietly went missing.
//
// MIN_SUPPORTED_NATIVE_VERSION is the oldest build we consider healthy
// for drive tracking. Below it, OutdatedAppBanner shows a persistent
// "update to keep tracking" nudge. Bump this whenever a release carries
// a tracking-reliability fix that older builds must not miss.
export const MIN_SUPPORTED_NATIVE_VERSION = "1.2.0";

/**
 * True when `current` is a parseable version strictly older than `min`.
 *
 * Deliberately conservative: an unparseable, empty, or missing version
 * returns false (no nag) rather than risk badgering a user whose build
 * string we simply can't read. Only a version we can read AND that is
 * genuinely lower trips the banner. Compares dot-separated numeric
 * segments (1.2.0); non-numeric suffixes on a segment are ignored so
 * "1.2.0-rc1" reads as 1.2.0.
 */
export function isVersionBelow(
  current: string | null | undefined,
  min: string,
): boolean {
  const cur = parseVersion(current);
  const floor = parseVersion(min);
  if (!cur || !floor) return false;
  const len = Math.max(cur.length, floor.length);
  for (let i = 0; i < len; i++) {
    const a = cur[i] ?? 0;
    const b = floor[i] ?? 0;
    if (a < b) return true;
    if (a > b) return false;
  }
  return false; // equal
}

function parseVersion(v: string | null | undefined): number[] | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(".").map((seg) => {
    const m = seg.match(/^\d+/);
    return m ? Number(m[0]) : NaN;
  });
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) return null;
  return parts;
}
