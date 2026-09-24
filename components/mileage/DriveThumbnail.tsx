"use client";

import { useEffect, useRef, useState } from "react";
import { TripThumbnail } from "@/components/maps/TripThumbnail";
import type { RoutePoint } from "@/components/mileage/MileageMap";

/** One GPS fix of a drive, as the route hands it over. One definition,
 *  two names: the list has always called it this, and MileageMap owns
 *  the shape because it owns the batch that produces it. Type-only, so
 *  nothing of that module is pulled into a row's bundle. */
export type DrivePoint = RoutePoint;
type Pt = DrivePoint;

const SIZE = 64;

/**
 * A drive's map, fetched when the row is nearly on screen.
 *
 * The page used to fetch every row's polyline on the server before it
 * sent a byte, in a loop that could make sixty sequential database
 * round trips. Most of those rows were never scrolled to. The reader
 * needs the distance, the times and the places, and this is decoration
 * that arrives when it is about to be seen.
 *
 * Three rules hold this together:
 *
 *  1. One request per row, ever. `asked` is a ref, not state, so it
 *     survives every re-render of the list, and the observer is
 *     disconnected the moment it fires. Scrolling a row out of view and
 *     back does not ask again: the answer is already here, or it is
 *     never coming.
 *  2. A failure is silent. The route answers `{ points: [] }` for a
 *     trip that is not the caller's, so an empty array is a normal
 *     answer, not an error, and an aborted fetch is treated the same
 *     way. Either way the row keeps its geometry and its text.
 *  3. Nothing is drawn until there is something to draw. No spinner: a
 *     row without a map is still a readable row, and a spinner that
 *     cannot resolve is worse than a quiet gap.
 *  4. The request is a LAST resort. A list that already holds this
 *     drive's route hands it over (`points`), and one that is still
 *     fetching it says so (`deferToList`), because scrolling a full
 *     page used to fire one single-id request per row for routes the
 *     list was already holding. The fetch stays for the row the list
 *     could not cover, which is exactly what it is good at.
 */
export function DriveThumbnail({
  tripId,
  classification = "unclassified",
  points,
  deferToList = false,
  onPoints,
}: {
  tripId: string;
  classification?: "business" | "personal" | "unclassified";
  /** This drive's route, when the list that holds this row already has
   *  it. Drawn instead of fetched, and still only once the row is near
   *  the viewport. Not reported back through `onPoints`: it came from
   *  the parent, which already has it. */
  points?: Pt[];
  /** The list is fetching this drive's route in a batch. Wait for it
   *  rather than asking for the same route again. Without this a row
   *  cannot tell "the batch has not landed" from "the batch is not
   *  bringing one", and racing the batch is what made every route on a
   *  scrolled page arrive twice. */
  deferToList?: boolean;
  /**
   * The route, handed to the row once, whatever the answer was (an empty
   * array included). The row uses the first and last fix to name the two
   * ends of a drive that matched no saved place, so the map is not the
   * only thing this fetch pays for. Kept in a ref below so that a parent
   * which passes a fresh closure on every render cannot re-arm the
   * observer and buy a second request.
   */
  onPoints?: (points: Pt[]) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const asked = useRef(false);
  const [shown, setShown] = useState<Pt[] | null>(null);
  const report = useRef(onPoints);
  // Read through a ref for the same reason `onPoints` is: the effect
  // below must see the latest array without a fresh array identity from
  // a parent re-arming the observer. Whether there IS one is a boolean,
  // which is stable, so that can be a real dependency.
  const supplied = useRef(points);
  const hasSupplied = (points?.length ?? 0) > 0;
  useEffect(() => {
    supplied.current = points;
  }, [points]);
  // Assigned in an effect, not during render: the point is only that the
  // fetch below calls the LATEST callback without the observer effect
  // depending on it, so a parent that passes a fresh closure every render
  // cannot re-arm the observer.
  useEffect(() => {
    report.current = onPoints;
  }, [onPoints]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A route is on its way from the list. Do nothing at all, not even
    // observe: when it lands this effect runs again with an answer.
    if (deferToList) return;
    if (asked.current) return;
    const deliver = (pts: Pt[]) => {
      setShown(pts);
      report.current?.(pts);
    };
    // The row's one shot, on screen. Either the list already had this
    // route, or nobody has it and the row asks for its own.
    const resolve = () => {
      asked.current = true;
      const given = supplied.current;
      if (given && given.length > 0) {
        setShown(given);
        return;
      }
      void load(tripId, deliver);
    };
    // No IntersectionObserver (very old WebView): resolve straight away
    // rather than leave every row blank forever.
    if (typeof IntersectionObserver === "undefined") {
      resolve();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || asked.current) return;
        io.disconnect();
        resolve();
      },
      // 200px of runway, so the map is usually there by the time the row
      // reaches the eye.
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [tripId, deferToList, hasSupplied]);

  return (
    <div
      ref={ref}
      data-drive-thumbnail={tripId}
      // The box is reserved from the first paint whether or not a map
      // ever lands in it, so the row does not jump when one does.
      className="shrink-0"
      style={{ width: SIZE, height: SIZE }}
    >
      {shown ? (
        <TripThumbnail
          points={shown.map((p) => ({ lat: p.lat, lng: p.lng }))}
          classification={classification}
          size={SIZE}
        />
      ) : null}
    </div>
  );
}

/** Fetch this drive's route. Every outcome ends in an array. */
async function load(tripId: string, set: (pts: Pt[]) => void) {
  try {
    const res = await fetch(
      `/api/mileage/drives?trip=${encodeURIComponent(tripId)}`,
    );
    const json = res.ok ? await res.json() : null;
    set((json?.points ?? []) as Pt[]);
  } catch {
    // Offline, aborted, or a body that is not JSON. The drive itself is
    // already on the page; the map is the only thing missing.
    set([]);
  }
}
