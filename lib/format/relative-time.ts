// Friendly relative-time + freshness helpers for "last synced" indicators.
//
// Compute these on the SERVER (server components / route handlers) and pass
// the resulting string/level to client components as props — that avoids a
// hydration mismatch from Date.now() differing between server and client.

export type Freshness = "fresh" | "stale" | "old" | "never";

/** "just now" / "5 minutes ago" / "3 days ago" / "2 months ago" / "never". */
export function relativeTime(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "never";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const y = Math.round(mo / 12);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

/**
 * Bucket a timestamp for styling + warnings:
 *   fresh  ≤ 3 days, stale ≤ 14 days, old > 14 days, never = no timestamp.
 */
export function freshnessLevel(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
): Freshness {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "never";
  const days = (nowMs - t) / 86_400_000;
  if (days <= 3) return "fresh";
  if (days <= 14) return "stale";
  return "old";
}
