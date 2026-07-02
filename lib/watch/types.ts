// Single source of truth for the watch payload. Mirror any change
// here in ios/TaxotticWatch/Models.swift (struct WatchSnapshot) and
// the README bridge contract.

export type WatchConfirm = {
  id: string;
  /** trip | expense | income — drives the swipe-deck copy. */
  kind: "trip" | "expense" | "income";
  title: string; // "Drive · 12.4 mi" / "Lunch · Sweetgreen"
  subtitle: string; // "today 9:14 AM" / "needs a category"
  amountCents: number; // value at stake (deduction or amount)
  leftLabel: string; // swipe-left commits this (e.g. "Business")
  rightLabel: string; // swipe-right commits this (e.g. "Personal")
};

export type WatchGoal = {
  id: string;
  title: string;
  savedCents: number;
  targetCents: number;
};

export type WatchDeduction = {
  name: string;
  amountCents: number; // estimated value
  captured: boolean;
};

export type WatchSnapshot = {
  /** 0–100 overall tax-readiness (hero dial). */
  taxReadinessPct: number;
  ytdDeductionCents: number;
  /** Rough marginal-rate estimate of tax saved by deductions. */
  estimatedTaxSavedCents: number;
  streakDays: number;

  /** Real-time forecast window. Omitted until phone-computed so the
   *  watch never shows a fabricated tax figure. */
  forecast?: {
    label: string; // "2026 federal estimate"
    /** Positive = owe, negative = refund. */
    netCents: number;
    effectiveRatePct: number;
    ytdIncomeCents: number;
  };

  /** The swipe deck: trips / expenses / income awaiting one gesture. */
  confirmations: WatchConfirm[];

  /** TRUE total count across every outstanding-tasks source (unclassified
   *  drives + pending transactions) — NOT capped like `confirmations`,
   *  which only ships a preview page's worth for the swipe deck. This is
   *  the stable primitive a watch-face complication / tile badge binds
   *  to, so it doesn't have to infer a count from an array length that's
   *  deliberately truncated. Mirrors the phone's header-bell count
   *  (lib/tasks/outstanding.ts) so the number on the wrist always
   *  matches the number in the app. */
  outstandingCount: number;

  /** Top available deductions (captured + still on the table). */
  deductions: WatchDeduction[];

  /** Active savings / tax goals. */
  goals: WatchGoal[];

  mileage: {
    trackingActive: boolean;
    autoApplyBusiness: boolean;
    todayMiles: number;
    todayDeductionCents: number;
  };

  latestBadge?: { title: string; symbol: string };
  /** Set to the badge code when a medal was JUST earned — the watch
   *  fires the celebration overlay + a haptic, one-shot. */
  newBadgeCode?: string;
  /** A rewarding moment to celebrate on the wrist — a goal reached,
   *  or a new business-deduction category unlocked. One-shot overlay. */
  reward?: { title: string; detail: string };

  /** The user's primary company id. Not shown on the watch — the
   *  phone bridge needs it to arm mileage tracking from the wrist. */
  companyId?: string;
};

export const EMPTY_WATCH_SNAPSHOT: WatchSnapshot = {
  taxReadinessPct: 0,
  ytdDeductionCents: 0,
  estimatedTaxSavedCents: 0,
  streakDays: 0,
  confirmations: [],
  outstandingCount: 0,
  deductions: [],
  goals: [],
  mileage: {
    trackingActive: false,
    autoApplyBusiness: false,
    todayMiles: 0,
    todayDeductionCents: 0,
  },
};
