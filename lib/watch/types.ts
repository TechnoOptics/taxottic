// The single source of truth for the watch payload. Mirror any change
// here in ios/TaxotticWatch/WatchConnectivityManager.swift
// (struct WatchSnapshot) and the README's bridge contract.

export type WatchSnapshot = {
  /** 0–100 overall tax-readiness (drives the hero dial). */
  taxReadinessPct: number;
  ytdDeductionCents: number;
  /** Rough marginal-rate estimate of tax saved by those deductions. */
  estimatedTaxSavedCents: number;
  /** Consecutive active days. 0 until the streak source is wired. */
  streakDays: number;
  nextQuarterly?: {
    label: string;
    dueISO: string; // "2026-06-15"
    amountCents: number;
  };
  pendingTrip?: {
    id: string;
    summary: string; // "12.4 mi · today 9:14 AM"
    estDeductionCents: number;
  };
  latestBadge?: {
    title: string;
    symbol: string; // SF Symbol name
  };
};

export const EMPTY_WATCH_SNAPSHOT: WatchSnapshot = {
  taxReadinessPct: 0,
  ytdDeductionCents: 0,
  estimatedTaxSavedCents: 0,
  streakDays: 0,
};
