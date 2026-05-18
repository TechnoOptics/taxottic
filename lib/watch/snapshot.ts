import type { WatchSnapshot } from "./types";
import { EMPTY_WATCH_SNAPSHOT } from "./types";

// Rough blended marginal rate for the "≈ tax saved" line. This is a
// deliberately conservative ESTIMATE shown with a "≈" — consistent
// with Taxottic's forecasts-not-advice posture. It is intentionally
// not the forecast engine's precise number; the watch is a glance.
const ROUGH_MARGINAL_RATE = 0.22;

export type SnapshotInput = {
  readinessScore: number | null;
  ytdBusinessMiles: number;
  ytdDeductionCents: number;
  pendingTrip: {
    id: string;
    distanceMiles: number;
    startedAtISO: string;
    estDeductionCents: number;
  } | null;
  latestBadgeCode: string | null;
};

/** Prettify a badge_code like "deduction_hunter" → "Deduction Hunter". */
export function badgeTitle(code: string): string {
  return code
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function tripSummary(distanceMiles: number, startedAtISO: string): string {
  const miles = distanceMiles.toFixed(1);
  const d = new Date(startedAtISO);
  const time = Number.isNaN(d.getTime())
    ? ""
    : ` · ${d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}`;
  return `${miles} mi${time}`;
}

/**
 * Pure mapper: already-fetched primitives → WatchSnapshot. No I/O, so
 * it is fully unit-tested; the route does the (resilient) fetching.
 */
export function buildWatchSnapshot(input: SnapshotInput): WatchSnapshot {
  const snap: WatchSnapshot = { ...EMPTY_WATCH_SNAPSHOT };

  if (input.readinessScore != null && Number.isFinite(input.readinessScore)) {
    snap.taxReadinessPct = Math.max(
      0,
      Math.min(100, Math.round(input.readinessScore)),
    );
  }

  snap.ytdDeductionCents = Math.max(0, Math.round(input.ytdDeductionCents));
  snap.estimatedTaxSavedCents = Math.round(
    snap.ytdDeductionCents * ROUGH_MARGINAL_RATE,
  );

  if (input.pendingTrip) {
    snap.pendingTrip = {
      id: input.pendingTrip.id,
      summary: tripSummary(
        input.pendingTrip.distanceMiles,
        input.pendingTrip.startedAtISO,
      ),
      estDeductionCents: Math.max(
        0,
        Math.round(input.pendingTrip.estDeductionCents),
      ),
    };
  }

  if (input.latestBadgeCode) {
    snap.latestBadge = {
      title: badgeTitle(input.latestBadgeCode),
      symbol: "rosette",
    };
  }

  return snap;
}
