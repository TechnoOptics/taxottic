"use client";

import { useTransition } from "react";

/**
 * The way back out of "Passenger".
 *
 * A passenger drive is excluded from the log, the map and every total, but
 * the row is deliberately kept: a one-tap control on a phone needs an undo,
 * and destroying captured mileage is not something this product does. That
 * promise is only real if the driver can actually reach the drive again,
 * which is what this section is.
 *
 * Collapsed by default, because on a correct day it holds nothing the
 * driver needs to look at. The count sits in the summary so a mis-tap is
 * visible without opening it.
 */

export type ExcludedTripRow = {
  id: string;
  startedAtISO: string;
  endedAtISO: string;
  distanceMiles: number;
};

const MILES_FMT = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});
const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export function ExcludedTrips({
  trips,
  reclassify,
}: {
  trips: ExcludedTripRow[];
  reclassify: (formData: FormData) => Promise<void>;
}) {
  if (trips.length === 0) return null;

  return (
    <details className="mt-6 card p-0 overflow-hidden">
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-3 text-sm text-forest-900 hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400">
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full bg-forest-200"
        />
        <span className="min-w-0 flex-1">
          Excluded as passenger
          <span className="ml-2 text-ink-muted">
            {trips.length} {trips.length === 1 ? "drive" : "drives"}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-ink-muted">
          Not in your totals
        </span>
      </summary>

      <div className="border-t border-forest-100 px-4 py-3">
        <p className="text-[11px] text-ink-muted leading-relaxed">
          These drives were kept so your GPS trail has no unexplained gap,
          and so a wrong tap can be undone. They count for nothing until you
          put one back.
        </p>
        <ul className="mt-3 grid gap-2">
          {trips.map((t) => (
            <ExcludedRow key={t.id} trip={t} reclassify={reclassify} />
          ))}
        </ul>
      </div>
    </details>
  );
}

function ExcludedRow({
  trip,
  reclassify,
}: {
  trip: ExcludedTripRow;
  reclassify: (fd: FormData) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  // Straight back through the same server action the list uses, so the
  // deduction is recomputed on the way out exactly as it was zeroed on the
  // way in. There is no restore-specific code path to drift.
  const restore = (classification: "business" | "personal") => {
    const fd = new FormData();
    fd.set("trip_id", trip.id);
    fd.set("classification", classification);
    startTransition(() => {
      void reclassify(fd);
    });
  };

  const start = new Date(trip.startedAtISO);
  const end = new Date(trip.endedAtISO);

  return (
    <li
      className={
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-forest-100 bg-forest-50/50 px-3 py-2 " +
        (pending ? "opacity-60" : "")
      }
      aria-busy={pending}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-forest-900 truncate">
          {DATE_FMT.format(start)}{" "}
          <span className="text-ink-muted">
            · {TIME_FMT.format(start)} → {TIME_FMT.format(end)}
          </span>
        </div>
        <div className="text-[11px] text-ink-muted mt-0.5">
          {MILES_FMT.format(Number(trip.distanceMiles))} mi · excluded
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-[11px] text-ink-muted">Put back as</span>
        <button
          type="button"
          onClick={() => restore("business")}
          disabled={pending}
          aria-label="Restore this drive as a business trip"
          className="h-8 px-3 text-[11px] font-medium rounded-full border border-emerald-300 text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
        >
          Business
        </button>
        <button
          type="button"
          onClick={() => restore("personal")}
          disabled={pending}
          aria-label="Restore this drive as a personal trip"
          className="h-8 px-3 text-[11px] font-medium rounded-full border border-amber-300 text-amber-800 hover:bg-amber-50 disabled:opacity-60"
        >
          Personal
        </button>
      </div>
    </li>
  );
}
