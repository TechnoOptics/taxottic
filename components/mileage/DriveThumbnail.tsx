"use client";

import { useEffect, useRef, useState } from "react";
import { TripThumbnail } from "@/components/maps/TripThumbnail";

type Pt = { lat: number; lng: number; captured_at: string };

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
 */
export function DriveThumbnail({
  tripId,
  classification = "unclassified",
}: {
  tripId: string;
  classification?: "business" | "personal" | "unclassified";
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const asked = useRef(false);
  const [points, setPoints] = useState<Pt[] | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (very old WebView): ask straight away
    // rather than leave every row blank forever.
    if (typeof IntersectionObserver === "undefined") {
      if (!asked.current) {
        asked.current = true;
        void load(tripId, setPoints);
      }
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || asked.current) return;
        asked.current = true;
        io.disconnect();
        void load(tripId, setPoints);
      },
      // 200px of runway, so the map is usually there by the time the row
      // reaches the eye.
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [tripId]);

  return (
    <div
      ref={ref}
      data-drive-thumbnail={tripId}
      // The box is reserved from the first paint whether or not a map
      // ever lands in it, so the row does not jump when one does.
      className="shrink-0"
      style={{ width: SIZE, height: SIZE }}
    >
      {points ? (
        <TripThumbnail
          points={points.map((p) => ({ lat: p.lat, lng: p.lng }))}
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
