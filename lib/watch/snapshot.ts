import type {
  WatchSnapshot,
  WatchConfirm,
  WatchGoal,
  WatchDeduction,
} from "./types";
import { EMPTY_WATCH_SNAPSHOT } from "./types";

// Rough blended marginal rate for the "≈ tax saved" line, a
// deliberately conservative ESTIMATE shown with "≈", consistent with
// Taxottic's forecasts-not-advice posture. Not the forecast engine's
// precise number; the watch is a glance.
const ROUGH_MARGINAL_RATE = 0.22;

export type SnapshotInput = {
  readinessScore: number | null;
  ytdDeductionCents: number;
  todayBusinessMiles: number;
  todayDeductionCents: number;
  pendingTrips: Array<{
    id: string;
    distanceMiles: number;
    startedAtISO: string;
    estDeductionCents: number;
  }>;
  /** Generic expense/income items awaiting a business/personal call. */
  pendingExpenses: Array<{
    id: string;
    kind: "expense" | "income";
    label: string;
    note: string;
    amountCents: number;
  }>;
  goals: Array<{
    id: string;
    title: string;
    savedCents: number;
    targetCents: number;
  }>;
  /** TRUE total across every outstanding-tasks source, see
   *  WatchSnapshot.outstandingCount. The route computes this
   *  separately from `pendingTrips`/`pendingExpenses` above, which are
   *  capped preview lists for the swipe deck. */
  outstandingCount: number;
  deductions: WatchDeduction[];
  /** Server-derived "is the phone tracking right now?", true when
   *  the user has emitted a GPS point in the last 5 minutes. Lets
   *  the watch's Auto-track toggle survive snapshot-pull overrides
   *  instead of flipping back to off after each 60s sync. */
  trackingActive?: boolean;
  /** Server-mirrored from profiles.mileage_schedule.autoApplyBusiness.
   *  Auto-applies "business" classification to qualifying trips
   *  without user confirmation when on. */
  autoApplyBusiness?: boolean;
  forecast: WatchSnapshot["forecast"];
  latestBadgeCode: string | null;
  newBadgeCode: string | null;
  companyId: string | null;
  reward: { title: string; detail: string } | null;
};

/** A trip that started on a weekend or outside ~8am-6pm is more
 *  likely personal, surface it so the user double-checks. */
function afterHours(iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getUTCDay(); // 0 Sun, 6 Sat
  const h = d.getUTCHours();
  return day === 0 || day === 6 || h < 8 || h >= 18;
}

export function badgeTitle(code: string): string {
  return code
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function fmtMiles(m: number): string {
  return `${m.toFixed(1)} mi`;
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Pure mapper: already-fetched primitives → WatchSnapshot. No I/O so
 * it is fully unit-tested; the route does the resilient fetching and
 * the client bridge merges device-only mileage flags.
 */
export function buildWatchSnapshot(input: SnapshotInput): WatchSnapshot {
  const snap: WatchSnapshot = {
    ...EMPTY_WATCH_SNAPSHOT,
    confirmations: [],
    deductions: [],
    goals: [],
    mileage: { ...EMPTY_WATCH_SNAPSHOT.mileage },
  };

  if (input.readinessScore != null && Number.isFinite(input.readinessScore)) {
    snap.taxReadinessPct = Math.max(
      0,
      Math.min(100, Math.round(input.readinessScore)),
    );
  }

  // YTD deduction is the sum the route computed from confirmed
  // business trips; the rough saved figure derives from it.
  const ytd = Math.max(0, Math.round(input.ytdDeductionCents));
  snap.ytdDeductionCents = ytd;
  snap.estimatedTaxSavedCents = Math.round(ytd * ROUGH_MARGINAL_RATE);

  const tripCards: WatchConfirm[] = input.pendingTrips.map((t) => {
    const ah = afterHours(t.startedAtISO);
    return {
      id: t.id,
      kind: "trip",
      title: `Drive · ${fmtMiles(t.distanceMiles)}`,
      // Flag out-of-hours drives so the user looks twice.
      subtitle: ah
        ? `${whenLabel(t.startedAtISO)} · after-hours`
        : whenLabel(t.startedAtISO),
      amountCents: Math.max(0, Math.round(t.estDeductionCents)),
      leftLabel: "Business",
      rightLabel: "Personal",
    };
  });
  // Bank-synced expense/income awaiting a business-or-personal call.
  const expenseCards: WatchConfirm[] = input.pendingExpenses.map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.label,
    subtitle: e.note,
    amountCents: Math.max(0, Math.round(e.amountCents)),
    leftLabel: "Business",
    rightLabel: "Personal",
  }));
  snap.confirmations = [...tripCards, ...expenseCards];
  snap.outstandingCount = Math.max(0, Math.round(input.outstandingCount));

  snap.goals = input.goals.map(
    (g): WatchGoal => ({
      id: g.id,
      title: g.title,
      savedCents: Math.max(0, Math.round(g.savedCents)),
      targetCents: Math.max(0, Math.round(g.targetCents)),
    }),
  );

  snap.deductions = input.deductions.map((d) => ({
    name: d.name,
    amountCents: Math.max(0, Math.round(d.amountCents)),
    captured: !!d.captured,
  }));

  snap.mileage.todayMiles = Math.max(0, input.todayBusinessMiles);
  snap.mileage.todayDeductionCents = Math.max(
    0,
    Math.round(input.todayDeductionCents),
  );
  snap.mileage.trackingActive = input.trackingActive === true;
  snap.mileage.autoApplyBusiness = input.autoApplyBusiness === true;

  if (input.forecast) snap.forecast = input.forecast;

  if (input.latestBadgeCode) {
    snap.latestBadge = {
      title: badgeTitle(input.latestBadgeCode),
      symbol: "rosette",
    };
  }
  if (input.newBadgeCode) snap.newBadgeCode = input.newBadgeCode;
  if (input.companyId) snap.companyId = input.companyId;
  if (input.reward) snap.reward = input.reward;

  return snap;
}
