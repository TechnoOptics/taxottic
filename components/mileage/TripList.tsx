"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { TripThumbnail } from "@/components/maps/TripThumbnail";
import { TripEndpoints } from "@/components/mileage/TripEndpoints";
import { SelectMenu } from "@/components/ui/SelectMenu";

/**
 * Phone-first trip list. Replaces the old "3 pill buttons per row,
 * server timezone, no delete, no grouping" rendering on /mileage.
 *
 * Why client-side:
 *   1. Dates must render in the user's local timezone. Server is UTC;
 *      `new Date(iso).toLocaleString("en-US")` on the server uses Vercel's
 *      UTC clock and the user complained that "the time zone is wrong".
 *      A Client Component runs `toLocaleString()` in the browser, so
 *      times read in the user's local zone.
 *   2. The classification control is a segmented (radio) UI now: only
 *      ONE option can be visually active. The old design used three
 *      independent submit buttons that all looked equally pressable,
 *      so users tapped each in turn and felt like both were
 *      "selected." A radio role + visual mutex fixes the affordance.
 *   3. Delete needs a confirm; useTransition + a server action keeps
 *      the UX snappy without a route refresh.
 *
 * Grouping:
 *   Today
 *   Yesterday
 *   This week (last 7 days, excluding today + yesterday)
 *   This month (last 30 days, excluding this week)
 *   Earlier
 *
 * Computed client-side off the started_at ISO so it respects the
 * user's local day boundary, not UTC midnight.
 */

export type TripRow = {
  id: string;
  startedAtISO: string;
  endedAtISO: string;
  distanceMiles: number;
  /** "passenger" rows do not reach this list (the page holds them back,
   *  see lib/mileage/passenger.ts). The type carries it so the compiler
   *  keeps the reclassify call below honest. */
  classification: "business" | "personal" | "unclassified" | "passenger";
  deductionCents: number;
  /** The classification was ASSUMED, not decided: no saved place backed
   *  it, so the drive is stored at zero cents and stays out of the
   *  deduction total until the driver confirms it. */
  needsConfirmation: boolean;
  points: { lat: number; lng: number; captured_at: string }[];
  /** Which company/business this drive currently belongs to. */
  companyId: string;
};

type Props = {
  trips: TripRow[];
  reclassify: (formData: FormData) => Promise<void>;
  deleteTrip: (formData: FormData) => Promise<void>;
  /** Load this trip's route onto the shared map + scroll/focus there.
   *  Owned by the parent (MileageReview) so only ONE trip is ever in
   *  review at a time. */
  onReview: (tripId: string) => void;
  /** The trip currently being reviewed on the map, if any. Used to
   *  light up that row's Review pill. null = overview (no single trip
   *  focused). */
  reviewingId: string | null;
  /** All businesses the user belongs to. When there's more than one, a
   *  per-trip "Business" picker appears so a drive can be routed to the
   *  right company. With a single company the picker is hidden. */
  companies: { id: string; name: string }[];
  /** Reassign a trip to a different company (server action). */
  moveTripCompany: (formData: FormData) => Promise<void>;
};

type Bucket = {
  key: string;
  label: string;
  trips: TripRow[];
};

/* Intl formatters are built once per module, not once per call. Each
   `toLocaleString` / `toLocaleDateString` call constructs a fresh formatter,
   and this list renders five of them per drive across hundreds of drives.
   Reusing the instances keeps identical output (same default locale, same
   options) at a fraction of the cost. `undefined` locale still means "the
   browser's locale", which is the whole reason this list is a client
   component. */
const MILES_FMT = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});
const USD_FMT = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
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

function fmtMiles(m: number) {
  return MILES_FMT.format(m);
}
function fmtUsd(cents: number) {
  return USD_FMT.format(cents / 100);
}

/** Local-day key like "2026-05-23" in the browser's timezone. */
function localDayKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function groupTrips(trips: TripRow[]): Bucket[] {
  const now = new Date();
  const today = localDayKey(now);
  const yesterday = localDayKey(new Date(now.getTime() - 86_400_000));
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

  const buckets: Record<string, TripRow[]> = {
    today: [],
    yesterday: [],
    week: [],
    month: [],
    earlier: [],
  };

  for (const t of trips) {
    const d = new Date(t.startedAtISO);
    const key = localDayKey(d);
    if (key === today) buckets.today.push(t);
    else if (key === yesterday) buckets.yesterday.push(t);
    else if (d >= weekAgo) buckets.week.push(t);
    else if (d >= monthAgo) buckets.month.push(t);
    else buckets.earlier.push(t);
  }

  return [
    { key: "today", label: "Today", trips: buckets.today },
    { key: "yesterday", label: "Yesterday", trips: buckets.yesterday },
    { key: "week", label: "Earlier this week", trips: buckets.week },
    { key: "month", label: "Earlier this month", trips: buckets.month },
    { key: "earlier", label: "Older", trips: buckets.earlier },
  ].filter((b) => b.trips.length > 0);
}

export function TripList({
  trips,
  reclassify,
  deleteTrip,
  onReview,
  reviewingId,
  companies,
  moveTripCompany,
}: Props) {
  if (trips.length === 0) {
    return (
      <p className="mt-3 text-sm text-ink-muted">
        No drives recorded in this window. The phone logs a trip
        automatically when you drive and then stop for 5+ minutes.
      </p>
    );
  }

  const buckets = groupTrips(trips);

  return (
    <div className="mt-3 grid gap-6">
      {buckets.map((bucket) => (
        <section key={bucket.key}>
          <h3 className="text-[11px] uppercase tracking-[0.22em] text-gold-700">
            {bucket.label}
            <span className="ml-2 text-ink-muted normal-case tracking-normal">
              {bucket.trips.length}{" "}
              {bucket.trips.length === 1 ? "drive" : "drives"}
            </span>
          </h3>
          <ul className="mt-2 grid gap-2">
            {bucket.trips.map((t) => (
              <TripCard
                key={t.id}
                trip={t}
                reclassify={reclassify}
                deleteTrip={deleteTrip}
                onReview={onReview}
                reviewing={reviewingId === t.id}
                companies={companies}
                moveTripCompany={moveTripCompany}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TripCard({
  trip,
  reclassify,
  deleteTrip,
  onReview,
  reviewing,
  companies,
  moveTripCompany,
}: {
  trip: TripRow;
  reclassify: (fd: FormData) => Promise<void>;
  deleteTrip: (fd: FormData) => Promise<void>;
  onReview: (tripId: string) => void;
  reviewing: boolean;
  companies: { id: string; name: string }[];
  moveTripCompany: (fd: FormData) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const moveFormRef = useRef<HTMLFormElement | null>(null);

  // First + last GPS fix = the drive's start / end, for reverse-geocoded
  // place labels ("Shakopee, MN → Mounds View, MN"). A drive carries
  // hundreds of fixes and this list renders hundreds of drives, so the sort
  // is memoised: it used to run twice per row per render (once here, once
  // inline in the TripThumbnail prop below) and every re-render of any row
  // in the list paid for it again. `trip.points` is the identity to key on -
  // the array is replaced wholesale when the server action revalidates.
  const sortedPts = useMemo(
    () =>
      [...trip.points].sort((a, b) => (a.captured_at < b.captured_at ? -1 : 1)),
    [trip.points],
  );
  const startPt = sortedPts[0];
  const endPt = sortedPts[sortedPts.length - 1];
  const thumbPts = useMemo(
    () => sortedPts.map((p) => ({ lat: p.lat, lng: p.lng })),
    [sortedPts],
  );

  const start = new Date(trip.startedAtISO);
  const end = new Date(trip.endedAtISO);

  // Module-level formatters (declared at the top of this file). Constructing
  // a DateTimeFormat is the expensive half of toLocaleDateString, and doing
  // it three times per row dominated mount time on a long list. Timezone is
  // still the browser's: the module is evaluated in the browser, which is
  // the whole reason this list is a client component.
  const dateLabel = DATE_FMT.format(start);
  const timeLabel = `${TIME_FMT.format(start)} → ${TIME_FMT.format(end)}`;

  // Both actions are AWAITED inside an async transition.
  //
  // They used to be `startTransition(() => void action(fd))`. That has two
  // faults and they hide each other. The promise is floated, so
  // reclassifyTrip's "You can't re-classify this trip." and deleteTrip's
  // "You can't delete this trip." never reached anyone: a refused
  // classification looked exactly like an accepted one, on the control
  // that decides whether a drive is a deduction. And because the
  // transition callback returned immediately, `pending` flipped back on
  // the next render, so the opacity, the aria-busy and every
  // `disabled={pending}` below were decorative. Awaiting inside an async
  // transition fixes both: React 19 holds isPending for the whole
  // round-trip, and a rejection lands somewhere the driver can read it.
  const runTripAction = (
    action: (fd: FormData) => Promise<void>,
    fd: FormData,
  ) => {
    setError(null);
    startTransition(async () => {
      try {
        await action(fd);
      } catch (err) {
        setError(
          err instanceof Error && err.message
            ? err.message
            : "That did not save. Try again.",
        );
      }
    });
  };

  // "passenger" comes through here too: it is the same server action, so a
  // refused exclusion surfaces the same way a refused classification does.
  const doReclassify = (
    c: "business" | "personal" | "unclassified" | "passenger",
  ) => {
    // Re-sending the CURRENT classification is normally a no-op, but on an
    // assumed drive it is the confirmation: the same server action clears
    // needs_confirmation and writes the real deduction, so "Confirm" needs
    // no parallel code path of its own.
    if (c === trip.classification && !trip.needsConfirmation) return;
    const fd = new FormData();
    fd.set("trip_id", trip.id);
    fd.set("classification", c);
    runTripAction(reclassify, fd);
  };

  const doDelete = () => {
    const fd = new FormData();
    fd.set("trip_id", trip.id);
    runTripAction(deleteTrip, fd);
  };

  return (
    <li
      className={
        "card p-3 sm:p-4 grid gap-3 " +
        (pending ? "opacity-60" : "")
      }
      aria-busy={pending}
    >
      <div className="flex items-start gap-3 min-w-0">
        <TripThumbnail
          points={thumbPts}
          classification={
            trip.classification === "business" ||
            trip.classification === "personal"
              ? trip.classification
              : "unclassified"
          }
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-forest-900 truncate">
            {dateLabel}{" "}
            <span className="text-ink-muted">· {timeLabel}</span>
          </div>
          <div className="text-xs text-ink-muted mt-0.5">
            {fmtMiles(Number(trip.distanceMiles))} mi
            {trip.classification === "business" && !trip.needsConfirmation
              ? ` · ${fmtUsd(Number(trip.deductionCents))} deduction`
              : ""}
          </div>
          {startPt && endPt ? (
            <TripEndpoints
              startLat={startPt.lat}
              startLng={startPt.lng}
              endLat={endPt.lat}
              endLng={endPt.lng}
              className="mt-1"
            />
          ) : null}
        </div>
        {/* Delete affordance. Two-tap with confirm, destructive
            actions should never be one click on a touch device. */}
        {confirmingDelete ? (
          <div className="flex gap-1 shrink-0">
            <button
              type="button"
              onClick={doDelete}
              disabled={pending}
              className="text-[11px] px-2.5 h-8 rounded-full bg-rose-600 text-white font-medium disabled:opacity-60"
            >
              Delete?
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={pending}
              className="text-[11px] px-2.5 h-8 rounded-full border border-forest-200 text-forest-800 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={pending}
            aria-label="Delete trip"
            className="shrink-0 size-8 grid place-items-center rounded-full text-ink-muted hover:text-rose-600 hover:bg-rose-50 disabled:opacity-60"
          >
            <svg
              viewBox="0 0 20 20"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 7h12M8 7V4h4v3M6 7l1 11h6l1-11M9 10v5M11 10v5" />
            </svg>
          </button>
        )}
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-900 leading-snug"
        >
          This drive was not changed. {error}
        </div>
      ) : null}

      {/* Assumed-classification notice. The drive landed automatically
          with no place evidence behind the call, so it is stored at zero
          cents and stays out of the deduction until the driver confirms.
          Deliberately quiet and on-page only: no push, no bell entry, no
          popup. The nagging stayed gone, the guess just stopped counting
          as a deduction on its own. */}
      {trip.needsConfirmation ? (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-amber-900">
              {trip.classification === "personal"
                ? "Assumed personal, confirm"
                : "Assumed business, confirm"}
            </div>
            <div className="text-[11px] text-amber-800 mt-0.5 leading-snug">
              No saved place matched this drive, so it is not in your
              deduction yet.
            </div>
          </div>
          <button
            type="button"
            onClick={() => doReclassify(trip.classification)}
            disabled={pending}
            className="shrink-0 text-[11px] font-medium px-3 h-8 rounded-full bg-amber-600 text-white disabled:opacity-60"
          >
            Confirm
          </button>
        </div>
      ) : null}

      {/* Classification + review controls.
          - Business / Personal are toggles that fill in ONLY when that
            is the trip's actual classification. An unclassified drive
            shows NOTHING selected (the ask: the pill must never be
            pre-selected). Tapping one sets the classification.
          - "Review" is NOT a classification, it's an action that loads
            this trip's route onto the shared map and scrolls there. It
            fills in only while THIS trip is the one being reviewed, and
            only one trip can be in review at a time (the parent owns
            reviewingId), so it can't read as "pre-selected" either. */}
      <div className="grid grid-cols-3 rounded-full bg-forest-50 p-1 gap-1">
        <button
          type="button"
          aria-pressed={trip.classification === "business"}
          aria-label="Mark this trip business"
          onClick={() => doReclassify("business")}
          disabled={pending}
          className={
            "h-9 text-xs font-medium rounded-full transition-colors disabled:opacity-60 " +
            (trip.classification === "business"
              ? "bg-emerald-600 text-white shadow-sm"
              : "text-forest-800 hover:bg-cream")
          }
        >
          Business
        </button>
        <button
          type="button"
          aria-pressed={trip.classification === "personal"}
          aria-label="Mark this trip personal"
          onClick={() => doReclassify("personal")}
          disabled={pending}
          className={
            "h-9 text-xs font-medium rounded-full transition-colors disabled:opacity-60 " +
            (trip.classification === "personal"
              ? "bg-amber-500 text-white shadow-sm"
              : "text-forest-800 hover:bg-cream")
          }
        >
          Personal
        </button>
        <button
          type="button"
          aria-pressed={reviewing}
          aria-label="Review this trip on the map"
          onClick={() => onReview(trip.id)}
          className={
            "h-9 text-xs font-medium rounded-full transition-colors inline-flex items-center justify-center gap-1 " +
            (reviewing
              ? "bg-forest-900 text-cream shadow-sm"
              : "text-forest-800 hover:bg-cream")
          }
        >
          <svg
            viewBox="0 0 20 20"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 2.5c-3.3 0-6 2.6-6 5.9 0 4.2 6 9.1 6 9.1s6-4.9 6-9.1c0-3.3-2.7-5.9-6-5.9Z" />
            <circle cx="10" cy="8.2" r="2" />
          </svg>
          {reviewing ? "Reviewing" : "Review"}
        </button>
      </div>

      {/* "I was a passenger".
          Deliberately NOT a fourth segment in the control above. That row
          is a mutex over the ways a drive can be FILED; this is the way a
          drive leaves the log entirely, which is a different kind of act,
          and a fourth segment would also crush all four touch targets on a
          phone. So: quiet, separate, and stating its own consequence,
          including that it can be undone. Restoring happens in the
          "Excluded as passenger" section under the list. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 -mt-1">
        <button
          type="button"
          onClick={() => doReclassify("passenger")}
          disabled={pending}
          aria-label="Mark this trip as one you rode in, not drove"
          className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-forest-200 text-[11px] font-medium text-forest-800 hover:border-gold-300 hover:bg-cream disabled:opacity-60"
        >
          {/* Steering wheel, crossed out: you were not the one driving. */}
          <svg
            viewBox="0 0 20 20"
            className="size-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="7" />
            <circle cx="10" cy="10" r="1.7" />
            <path d="M3.2 9.2h5.1M11.7 9.2h5.1" />
            <path d="M4.6 15.4 15.4 4.6" />
          </svg>
          Passenger
        </button>
        <span className="min-w-0 text-[11px] text-ink-muted leading-snug">
          You were riding, not driving. Takes this drive out of your log and
          your deduction. You can put it back.
        </span>
      </div>

      {/* Business picker, only when the user belongs to more than one
          company. Routes this drive to the right business; the IRS
          deduction is unchanged (rate-based). Auto-submits on change. */}
      {companies.length > 1 ? (
        <form
          ref={moveFormRef}
          action={moveTripCompany}
          className="flex items-center gap-2 -mt-1"
        >
          <input type="hidden" name="trip_id" value={trip.id} />
          <span className="text-[11px] uppercase tracking-[0.16em] text-gold-700 shrink-0">
            Business
          </span>
          <SelectMenu
            name="company_id"
            ariaLabel="Move this drive to a different business"
            defaultValue={trip.companyId}
            disabled={pending}
            className="flex-1 min-w-0"
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
            onValueChange={() => moveFormRef.current?.requestSubmit()}
          />
        </form>
      ) : null}
    </li>
  );
}
