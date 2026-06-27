"use client";

import { useEffect, useState } from "react";
import { reverseGeocode, type PlaceLabel } from "@/lib/maps/reverseGeocode";

/**
 * Shows the start → end place of a trip ("Shakopee, MN 55379 → Mounds
 * View, MN 55112") for an at-a-glance, report-ready drive log.
 *
 * Reverse-geocodes the first + last GPS fix of the route via the cached
 * client geocoder (see lib/maps/reverseGeocode). Renders a quiet
 * "Locating…" placeholder while the lookup runs, and falls back to the
 * raw coords if Google can't resolve a place. `savedStart` / `savedEnd`
 * (a known saved place like "Office") win over the geocoded label when
 * present, since the user's own name for a spot beats a street address.
 */
export function TripEndpoints({
  startLat,
  startLng,
  endLat,
  endLng,
  savedStart,
  savedEnd,
  className,
}: {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  savedStart?: string | null;
  savedEnd?: string | null;
  className?: string;
}) {
  const [start, setStart] = useState<PlaceLabel | null>(null);
  const [end, setEnd] = useState<PlaceLabel | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      savedStart ? Promise.resolve(null) : reverseGeocode(startLat, startLng),
      savedEnd ? Promise.resolve(null) : reverseGeocode(endLat, endLng),
    ])
      .then(([s, e]) => {
        if (!alive) return;
        setStart(s);
        setEnd(e);
      })
      .finally(() => {
        if (alive) setDone(true);
      });
    return () => {
      alive = false;
    };
  }, [startLat, startLng, endLat, endLng, savedStart, savedEnd]);

  // Priority: the user's own saved-place name → the business/POI name
  // from Places ("Walmart") → the bare city label. Full address stays
  // in the title tooltip.
  const startText = savedStart || start?.name || start?.short || null;
  const endText = savedEnd || end?.name || end?.short || null;

  if (!done && !startText && !endText) {
    return (
      <div className={"text-xs text-ink-muted " + (className ?? "")}>
        Locating route…
      </div>
    );
  }

  return (
    <div
      className={"text-xs text-forest-800 leading-snug " + (className ?? "")}
      title={[start?.full, end?.full].filter(Boolean).join("  →  ")}
    >
      <span aria-hidden="true" className="text-ink-muted">
        📍{" "}
      </span>
      <span className="font-medium">{startText ?? "Unknown start"}</span>
      <span className="text-ink-muted"> → </span>
      <span className="font-medium">{endText ?? "Unknown end"}</span>
    </div>
  );
}
