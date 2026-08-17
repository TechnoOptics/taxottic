"use client";

// "Recover lost drives".
//
// A drive can reach the server and still never reach the map. The live
// upload path only ever re-segments the last 24 hours and the page render
// only 7 days, so once a drive ages past that, nothing the driver can
// press will look at it again. This control is that missing path: it
// sweeps 45 days of staged points and closes drives whose phone went dark
// without ever parking.
//
// The design rule here is that the REPORT is the feature, not the button.
// A sweep that says "done" while leaving twenty thousand points stranded
// is worse than no button at all, because it converts a visible problem
// into an invisible one. So every point the sweep could not turn into a
// drive is named, counted, and explained, including the case where the
// honest answer is "this data is corrupt and recovering it would invent
// miles you did not drive".

import { useState } from "react";
import { RefreshIcon } from "@/components/ui/Icons";

type Span = { startIso: string; endIso: string; points: number };

type Report = {
  pointsFound: number;
  forcedClose: boolean;
  tripsCreated: number;
  milesRecovered: number;
  remaining: {
    total: number;
    stationary: number;
    recoverable: number;
    recording: number;
    contaminated: number;
    contaminatedClusters: number;
    worstMph: number;
    contaminatedSpans: Span[];
  };
};

// Pinned to en-US like every other formatter in the app: the runtime
// locale would render the same drive differently on a phone set to en-GB,
// and these timestamps are how a driver matches a refused stretch against
// their own memory of the day.
function whenLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

const countFmt = new Intl.NumberFormat("en-US");

/** One line of the report. The dot colour is the only ornament, and it
 *  encodes whether the line needs the driver to do something. */
function Line({
  tone,
  children,
}: {
  tone: "good" | "warn" | "neutral";
  children: React.ReactNode;
}) {
  const dot =
    tone === "good"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-400"
        : "bg-gold-400";
  return (
    <li className="flex gap-2.5 items-start">
      <span
        aria-hidden="true"
        className={"mt-1.5 size-2 shrink-0 rounded-full " + dot}
      />
      <span className="text-[13px] text-forest-900 leading-relaxed">
        {children}
      </span>
    </li>
  );
}

export function RecoverLostDrives() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mileage/recover", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body?.ok) {
        setError(
          "The search could not finish. Your drives are unchanged. Try again in a moment.",
        );
        setReport(null);
        return;
      }
      setReport(body as Report);
    } catch {
      setError(
        "The search could not reach the server. Your drives are unchanged.",
      );
      setReport(null);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 text-xs text-forest-700 hover:text-forest-900 underline underline-offset-2"
        >
          <RefreshIcon className="size-4 shrink-0" />
          Missing a drive? Search for drives that never arrived
        </button>
      </div>
    );
  }

  const r = report?.remaining;

  return (
    <section
      className="mt-3 card p-4 grid gap-3"
      aria-label="Recover lost drives"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="display text-base text-forest-900">
          Recover lost drives
        </h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-ink-muted hover:text-forest-900"
        >
          Close
        </button>
      </div>

      <p className="text-[12px] text-ink-muted leading-relaxed">
        Searches the last 45 days of recorded location for drives that were
        captured but never turned into a trip, and closes any that your
        phone left open. Safe to run more than once.
      </p>

      <div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="btn-primary h-10 text-sm disabled:opacity-60"
        >
          {busy ? "Searching..." : "Search the last 45 days"}
        </button>
      </div>

      <div aria-live="polite">
        {error ? (
          <p className="text-[13px] text-amber-700 leading-relaxed">{error}</p>
        ) : null}

        {report && r ? (
          <ul className="grid gap-2 mt-1">
            {report.tripsCreated > 0 ? (
              <Line tone="good">
                Recovered {report.tripsCreated}{" "}
                {report.tripsCreated === 1 ? "drive" : "drives"}
                {report.milesRecovered > 0
                  ? ` (${report.milesRecovered.toFixed(2)} business miles)`
                  : ""}
                . They are in your drive list now.
              </Line>
            ) : (
              <Line tone="neutral">
                No new drives to recover. Every drive that could be closed is
                already in your list.
              </Line>
            )}

            {r.recording > 0 ? (
              <Line tone="neutral">
                A drive is being recorded right now ({r.recording} fixes). It
                was left open on purpose, and it will appear once you have
                been parked for ten minutes.
              </Line>
            ) : null}

            {r.contaminated > 0 ? (
              <Line tone="warn">
                {r.contaminated} location fixes across{" "}
                {r.contaminatedClusters}{" "}
                {r.contaminatedClusters === 1 ? "stretch" : "stretches"} could
                not be recovered. Your phone uploaded the same drive more than
                once, so the fixes jump between two places at up to{" "}
                {countFmt.format(r.worstMph)} mph. Any distance built from that
                would be invented rather than driven, so the drive was left
                alone.
                <ul className="mt-1.5 grid gap-0.5">
                  {r.contaminatedSpans.map((s) => (
                    <li
                      key={s.startIso}
                      className="text-[12px] text-ink-muted tabular-nums"
                    >
                      {whenLabel(s.startIso)} to {whenLabel(s.endIso)} (
                      {s.points} fixes)
                    </li>
                  ))}
                </ul>
                <span className="block mt-1.5 text-[12px] text-ink-muted">
                  To claim one of these, rebuild it from your route below and
                  check the miles against your odometer.
                </span>
              </Line>
            ) : null}

            {r.recoverable > 0 ? (
              <Line tone="warn">
                {r.recoverable} fixes look like driving but did not close into
                a trip. This is unexpected. Please report it so it can be
                looked at.
              </Line>
            ) : null}

            {r.stationary > 0 ? (
              <Line tone="neutral">
                {countFmt.format(r.stationary)} fixes hold no drive: they are
                your phone parked or drifting a few metres, which is not a
                trip. They are kept for 45 days and then cleared. Nothing to
                do.
              </Line>
            ) : null}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
