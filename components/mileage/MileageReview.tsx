"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MileageMap,
  type MapTrip,
  type MapPlace,
} from "@/components/mileage/MileageMap";
import { TripList, type TripRow } from "@/components/mileage/TripList";

/**
 * Owns the shared "which trip is being reviewed" state so the trip list
 * and the map stay in lockstep. The user's brief:
 *
 *   - The Business / Personal / Review pill must never be pre-selected.
 *     (Handled in TripList: Business/Personal fill only on exact match;
 *     Review fills only while actively reviewing.)
 *   - Clicking "Review" loads that trip's route onto the map and moves
 *     screen focus to the map so they can look at the drive.
 *   - Only ONE trip can be in review at a time. The default (no focus)
 *     is the range overview, the one place multiple drives show at
 *     once ("weekly overview").
 *
 * focusedId === null  → overview: the map plots every trip in range.
 * focusedId === <id>  → review: the map plots ONLY that trip, with the
 *                        gamified zoom-floor relaxed (focusMode) so the
 *                        whole route fits regardless of its length.
 */
export function MileageReview({
  mapTrips,
  places,
  tripRows,
  reclassify,
  deleteTrip,
  companies,
  moveTripCompany,
}: {
  mapTrips: MapTrip[];
  places: MapPlace[];
  tripRows: TripRow[];
  reclassify: (formData: FormData) => Promise<void>;
  deleteTrip: (formData: FormData) => Promise<void>;
  companies: { id: string; name: string }[];
  moveTripCompany: (formData: FormData) => Promise<void>;
}) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);

  const focusedTrip = focusedId
    ? (mapTrips.find((t) => t.id === focusedId) ?? null)
    : null;
  // Review mode shows just the one drive; overview shows them all.
  const shownTrips = focusedTrip ? [focusedTrip] : mapTrips;

  // Toggle: tapping Review on the trip that's already in review takes
  // you BACK to the all-drives overview. Tapping it on a different trip
  // switches the focus to that one. (Only one trip in review at a time.)
  const onReview = useCallback((tripId: string) => {
    setFocusedId((prev) => (prev === tripId ? null : tripId));
  }, []);

  // When a trip becomes the focused one, move screen focus to the map
  // and scroll it into view so the user is looking at the route they
  // asked to review. Runs after the focused-trip render commits.
  useEffect(() => {
    if (!focusedId) return;
    const el = mapWrapRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.focus({ preventScroll: true });
  }, [focusedId]);

  const focusedRow = focusedId
    ? (tripRows.find((t) => t.id === focusedId) ?? null)
    : null;

  return (
    <>
      <div
        ref={mapWrapRef}
        tabIndex={-1}
        className="mt-6 outline-none scroll-mt-24"
        aria-label={
          focusedTrip ? "Reviewing a single drive" : "All drives in range"
        }
      >
        {focusedRow ? (
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0 text-sm text-forest-900 truncate">
              <span className="text-[11px] uppercase tracking-[0.18em] text-gold-700 mr-2">
                Reviewing
              </span>
              {tripLabel(focusedRow)}
            </div>
            <button
              type="button"
              onClick={() => setFocusedId(null)}
              className="shrink-0 text-xs px-3 h-8 inline-flex items-center gap-1 rounded-full border border-forest-200 text-forest-800 hover:border-gold-300"
            >
              ← All drives
            </button>
          </div>
        ) : null}
        <MileageMap
          trips={shownTrips}
          places={places}
          focusMode={!!focusedTrip}
        />
      </div>

      <h2 className="display text-xl text-forest-900 mt-8">Trips</h2>
      <TripList
        trips={tripRows}
        reclassify={reclassify}
        deleteTrip={deleteTrip}
        onReview={onReview}
        reviewingId={focusedId}
        companies={companies}
        moveTripCompany={moveTripCompany}
      />
    </>
  );
}

/** Short "Tue, Jun 1 · 10:14 AM → 10:52 AM" label, local timezone. */
function tripLabel(t: TripRow): string {
  const start = new Date(t.startedAtISO);
  const end = new Date(t.endedAtISO);
  const date = start.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = `${start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })} → ${end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
  return `${date} · ${time}`;
}
