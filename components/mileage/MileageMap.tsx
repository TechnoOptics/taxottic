"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadGoogleMaps,
  MapsKeyMissingError,
  type GoogleMapsApi,
} from "@/lib/maps/google-maps-loader";

export type MapPoint = { lat: number; lng: number };
export type MapTrip = {
  id: string;
  classification: "business" | "personal" | "unclassified";
  points: MapPoint[];
  /** Who drove this trip. When a map shows 2+ distinct drivers, each is
   *  given a unique line colour (see DRIVER_PALETTE) so the trails are
   *  told apart at a glance; single-driver maps keep the classification
   *  colours. Optional so single-user views need pass nothing. */
  driverId?: string | null;
  driverName?: string | null;
  /** Reconstructed from sparse GPS (a recovery), not a full-fidelity
   *  capture. Drawn DASHED so a coarse segment reads as "approximate",
   *  never as a claimed road route. */
  approximate?: boolean;
};
export type MapPlace = {
  id: string;
  kind: "home" | "office" | "client" | "other";
  label?: string | null;
  lat: number;
  lng: number;
};

// Breadcrumb colours: business is the brand gold (so the user's
// deductible drives glow on the dial), personal a warm amber, and
// unclassified a soft cream "needs review". On the navy-themed dial
// these read instantly against the dark sea + roads.
const TRIP_COLOR: Record<MapTrip["classification"], string> = {
  business: "#F2D896",
  personal: "#D97706",
  unclassified: "#A78EBF",
};

// Per-driver palette for multi-driver maps (e.g. the firm / manager team
// view). Twelve qualitative hues chosen to stay legible against the navy
// #1d2843 dial and to read as distinct from each other and from the green
// start dot. Assigned deterministically by sorted driver id, so a given
// driver keeps the same colour across renders within one map.
const DRIVER_PALETTE = [
  "#7DD3FC", // sky
  "#FCA5A5", // rose
  "#86EFAC", // green
  "#FDBA74", // orange
  "#C4B5FD", // violet
  "#F9A8D4", // pink
  "#67E8F9", // cyan
  "#FDE047", // yellow
  "#A3E635", // lime
  "#5EEAD4", // teal
  "#D8B4FE", // purple
  "#FED7AA", // peach
];

/** Build a stable driverId → colour map from the trips on a map. Only
 *  meaningful when 2+ distinct drivers are present; callers gate on
 *  `.size >= 2`. Sorted so colour assignment is deterministic regardless
 *  of trip order. */
function buildDriverColors(trips: MapTrip[]): Map<string, string> {
  const ids = Array.from(
    new Set(
      trips
        .map((t) => t.driverId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ).sort();
  const out = new Map<string, string>();
  ids.forEach((id, i) => out.set(id, DRIVER_PALETTE[i % DRIVER_PALETTE.length]));
  return out;
}
const PLACE_GLYPH: Record<MapPlace["kind"], string> = {
  home: "🏠",
  office: "🏢",
  client: "📍",
  other: "⚲",
};

// Taxottic navy/gold map skin: water + roads in deep navy, parks +
// landscape muted, every label cream-on-navy. Designed to pair with
// the app's #1d2843 → #121a2a gradient, the map reads as the next
// surface in the same dial, not as a Google-default white slab. The
// JSON is the standard Google Maps Style spec.
const MAP_STYLE_TAXOTTIC: Array<Record<string, unknown>> = [
  { elementType: "geometry", stylers: [{ color: "#1d2843" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#cbb78b" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#121a2a" }] },
  { featureType: "administrative", elementType: "geometry",
    stylers: [{ color: "#243150" }] },
  { featureType: "administrative.country",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d5bb7e" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#fbf7e9" }] },
  { featureType: "administrative.neighborhood",
    elementType: "labels.text.fill",
    stylers: [{ color: "#a89878" }] },
  { featureType: "poi", elementType: "geometry",
    stylers: [{ color: "#243150" }] },
  { featureType: "poi", elementType: "labels.text.fill",
    stylers: [{ color: "#7d8aa8" }] },
  { featureType: "poi.park", elementType: "geometry",
    stylers: [{ color: "#1e2f3d" }] },
  { featureType: "poi.park", elementType: "labels.text.fill",
    stylers: [{ color: "#9aa8b4" }] },
  { featureType: "road", elementType: "geometry",
    stylers: [{ color: "#2f3e63" }] },
  { featureType: "road", elementType: "geometry.stroke",
    stylers: [{ color: "#121a2a" }] },
  { featureType: "road", elementType: "labels.text.fill",
    stylers: [{ color: "#cbb78b" }] },
  { featureType: "road.arterial", elementType: "geometry",
    stylers: [{ color: "#34466e" }] },
  { featureType: "road.highway", elementType: "geometry",
    stylers: [{ color: "#5b4a1f" }] },
  { featureType: "road.highway", elementType: "geometry.stroke",
    stylers: [{ color: "#3b2f12" }] },
  { featureType: "road.highway", elementType: "labels.text.fill",
    stylers: [{ color: "#f2d896" }] },
  { featureType: "transit", elementType: "geometry",
    stylers: [{ color: "#243150" }] },
  { featureType: "transit.station", elementType: "labels.text.fill",
    stylers: [{ color: "#a89878" }] },
  { featureType: "water", elementType: "geometry",
    stylers: [{ color: "#0f1626" }] },
  { featureType: "water", elementType: "labels.text.fill",
    stylers: [{ color: "#56678a" }] },
];

// The map ALWAYS uses the dark navy/gold skin, even though the app pages
// are now light-themed. That's deliberate: a dark dial gives the mileage
// breadcrumb strong contrast against the light (cream/white) page surface,
// and keeps the gold trip lines + markers legible. (An earlier light-map
// variant read as a washed-out grey slab on the light background.)

/** Haversine distance in miles between two lat/lng pairs. Used to
 *  reason about the user's "unlocked" map extent without dragging in
 *  a geo library. Close enough for tier-bucketing trip lengths. */
function haversineMiles(a: MapPoint, b: MapPoint): number {
  const R = 3958.7613; // earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Sum a polyline's leg lengths in miles. */
function polylineMiles(points: MapPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMiles(points[i - 1], points[i]);
  }
  return total;
}

/** Gamified zoom floor: the map can't be zoomed out past this until
 *  the user has logged a long-enough single business trip. Cadence
 *  feels rewarding, local errands keep the dial close, road-trips
 *  open the country. Zooms are Google Maps zoom levels (0 = whole
 *  world, 21 = building). The bands map roughly to:
 *    < 1 mi   → block-level
 *    < 5 mi   → neighbourhood
 *    < 25 mi  → city
 *    < 100 mi → metro / state
 *    < 500 mi → multi-state region
 *    ≥ 500 mi → whole country
 */
function unlockedMinZoom(longestBusinessMiles: number): number {
  if (longestBusinessMiles >= 500) return 4;
  if (longestBusinessMiles >= 100) return 6;
  if (longestBusinessMiles >= 25) return 8;
  if (longestBusinessMiles >= 5) return 10;
  if (longestBusinessMiles >= 1) return 12;
  return 13;
}

/** Human label for the next unlock tier so the overlay can nudge the
 *  user toward their next "zoom out" achievement. Returns null once
 *  the user is at the country tier (everything is already unlocked). */
function nextUnlockHint(longestBusinessMiles: number): {
  needMiles: number;
  label: string;
} | null {
  if (longestBusinessMiles < 1)
    return { needMiles: 1, label: "neighbourhood view" };
  if (longestBusinessMiles < 5)
    return { needMiles: 5, label: "city view" };
  if (longestBusinessMiles < 25)
    return { needMiles: 25, label: "metro / state view" };
  if (longestBusinessMiles < 100)
    return { needMiles: 100, label: "regional view" };
  if (longestBusinessMiles < 500)
    return { needMiles: 500, label: "country view" };
  return null;
}

export function MileageMap({
  trips,
  places,
  height = 420,
  focusMode = false,
}: {
  trips: MapTrip[];
  places: MapPlace[];
  height?: number;
  /** When reviewing a single trip we relax the gamified zoom floor so
   *  the whole route fits regardless of its length/classification, and
   *  hide the "unlock" nudge (irrelevant when looking at one drive). */
  focusMode?: boolean;
}) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "no-key" | "error"
  >("loading");
  // Gamified extent: longest single business trip in miles. Drives the
  // map's zoom-out floor (see unlockedMinZoom). Recomputed whenever the
  // trips prop changes so a fresh long drive immediately opens up more
  // of the world. Business-only, personal drives don't unlock the
  // dial because the deduction map is the business view.
  const longestBusinessMiles = (() => {
    let max = 0;
    for (const t of trips) {
      if (t.classification !== "business") continue;
      if (t.points.length < 2) continue;
      const len = polylineMiles(t.points);
      if (len > max) max = len;
    }
    return max;
  })();
  const minZoom = focusMode ? 3 : unlockedMinZoom(longestBusinessMiles);
  const unlockHint = focusMode ? null : nextUnlockHint(longestBusinessMiles);

  // Per-driver colouring. Only kicks in when the map shows 2+ distinct
  // drivers (the firm / manager team view); a single driver's map keeps
  // the classification colours. Memoised so the map effect's dep stays
  // stable between renders when `trips` is unchanged. When active, the
  // legend below lists each driver + swatch instead of the classification
  // key, and personal/unreviewed trips are drawn a touch fainter so the
  // deductible business trails still stand out.
  const driverColors = useMemo(() => buildDriverColors(trips), [trips]);
  const colorByDriver = driverColors.size >= 2;
  // Legend rows for the multi-driver map: name + swatch, sorted by name.
  const driverLegend = useMemo(
    () =>
      colorByDriver
        ? Array.from(driverColors.entries())
            .map(([id, color]) => ({
              id,
              color,
              name:
                trips.find((t) => t.driverId === id)?.driverName?.trim() ||
                `Driver ${id.slice(0, 4)}`,
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        : [],
    [colorByDriver, driverColors, trips],
  );

  useEffect(() => {
    let cancelled = false;
    const overlays: any[] = [];

    loadGoogleMaps()
      .then((maps: GoogleMapsApi) => {
        if (cancelled || !divRef.current) return;
        const map = new maps.Map(divRef.current, {
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          // Brand dial: navy/gold theme + a zoom floor that opens up
          // only as the user logs longer drives (see unlockedMinZoom).
          // Always the dark skin so it contrasts with the light page.
          styles: MAP_STYLE_TAXOTTIC,
          minZoom,
          maxZoom: 18,
          // Cooperative gestures: on mobile a ONE-finger drag scrolls the
          // page (not the map) and TWO fingers are required to pan/zoom the
          // map, so the map no longer hijacks the page scroll. On desktop,
          // scroll-zoom needs ⌘/Ctrl held. ("greedy" let one finger pan the
          // map, trapping the user mid-scroll.)
          gestureHandling: "cooperative",
          backgroundColor: "#121a2a",
        });
        const bounds = new maps.LatLngBounds();
        let plotted = 0;

        for (const t of trips) {
          if (t.points.length < 2) continue;
          const path = t.points.map((p) => ({ lat: p.lat, lng: p.lng }));
          // Line colour: each driver's own colour on a multi-driver map,
          // otherwise the classification colour. When colouring by driver
          // we fade personal / unreviewed trips a touch so the deductible
          // business trails still read strongest.
          const driverColor =
            colorByDriver && t.driverId
              ? driverColors.get(t.driverId)
              : undefined;
          const lineColor = driverColor ?? TRIP_COLOR[t.classification];
          const lineOpacity =
            colorByDriver && t.classification !== "business" ? 0.6 : 0.95;
          // Drop a faint dark "shadow" beneath the gold so the line
          // doesn't get lost against the road colour, then the real
          // breadcrumb on top.
          const shadow = new maps.Polyline({
            path,
            strokeColor: "#0d121f",
            strokeOpacity: 0.7,
            strokeWeight: 6,
            map,
          });
          // Approximate (recovered) trips draw DASHED: the solid stroke
          // is suppressed and a dash icon repeats along the path, so a
          // sparse trace never reads as a precise road route.
          const isApprox = t.approximate === true;
          const line = new maps.Polyline({
            path,
            strokeColor: lineColor,
            strokeOpacity: isApprox ? 0 : lineOpacity,
            strokeWeight: 4,
            // Direction of travel: arrowheads riding the breadcrumb at a
            // steady cadence. Same fill as the trip colour with the dark
            // shadow tone as outline so they read on both the navy water
            // and the lighter road strokes.
            icons: [
              ...(isApprox
                ? [
                    {
                      icon: {
                        path: "M 0,-1 0,1",
                        strokeOpacity: 0.9,
                        strokeColor: lineColor,
                        scale: 3,
                      },
                      offset: "0",
                      repeat: "14px",
                    },
                  ]
                : []),
              {
                icon: {
                  path: maps.SymbolPath.FORWARD_CLOSED_ARROW,
                  scale: 2.6,
                  fillColor: lineColor,
                  fillOpacity: 1,
                  strokeColor: "#0d121f",
                  strokeWeight: 1,
                },
                offset: "10%",
                repeat: "96px",
              },
            ],
            map,
          });
          overlays.push(shadow, line);
          // Start + end markers so a glance answers "which way did this
          // drive go?", green dot = where the trip began, navy/gold
          // checkered-flag disc = where it ended. Kept deliberately small
          // so the overview with many trips stays readable; the title
          // tooltips disambiguate on hover/long-press.
          const startMarker = new maps.Marker({
            position: path[0],
            map,
            title: "Trip start",
            zIndex: 5,
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: 5.5,
              fillColor: "#34D399",
              fillOpacity: 1,
              strokeColor: "#0d121f",
              strokeWeight: 2,
            },
          });
          const endMarker = new maps.Marker({
            position: path[path.length - 1],
            map,
            title: "Trip end",
            zIndex: 6,
            label: { text: "🏁", fontSize: "11px" },
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: "#121a2a",
              fillOpacity: 1,
              strokeColor: "#F2D896",
              strokeWeight: 2,
            },
          });
          overlays.push(startMarker, endMarker);
          path.forEach((c) => bounds.extend(c));
          plotted++;
        }

        for (const pl of places) {
          const m = new maps.Marker({
            position: { lat: pl.lat, lng: pl.lng },
            map,
            label: {
              text: PLACE_GLYPH[pl.kind] ?? "•",
              fontSize: "16px",
            },
            title: pl.label ?? pl.kind,
          });
          overlays.push(m);
          bounds.extend({ lat: pl.lat, lng: pl.lng });
          plotted++;
        }

        if (plotted > 0) {
          map.fitBounds(bounds, 48);
          // Single point would zoom to street level absurdly; cap the
          // initial frame and let the user dive deeper themselves.
          const once = maps.event.addListenerOnce(map, "idle", () => {
            if (map.getZoom() > 16) map.setZoom(15);
            // If the auto-fit zoomed us beyond what the user has
            // unlocked, snap to the unlocked floor so the gamified
            // boundary still holds on initial load.
            if (map.getZoom() < minZoom) map.setZoom(minZoom);
          });
          overlays.push(once);
        } else {
          // Empty state: centre on whatever place we have (home or
          // first known point), else the rough US centroid. Don't
          // throw the user out to zoom-4 unless we truly have nothing
          //, that wide a view felt "broken" in user testing.
          const home = places.find((p) => p.kind === "home") ?? places[0];
          if (home) {
            map.setCenter({ lat: home.lat, lng: home.lng });
            map.setZoom(Math.max(minZoom, 13));
          } else {
            map.setCenter({ lat: 39.5, lng: -98.35 });
            map.setZoom(minZoom);
          }
        }
        setState("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // `instanceof MapsKeyMissingError` can be FALSE across module
        // boundaries in production bundles (two copies of the class,
        // identity mismatch), even when the rejection IS that error.
        // Fall back to checking `.name` so the friendly "Map not
        // configured" panel still wins when the key is genuinely
        // absent.
        const err = e as { name?: string };
        const isKeyMissing =
          e instanceof MapsKeyMissingError || err?.name === "MapsKeyMissingError";
        setState(isKeyMissing ? "no-key" : "error");
      });

    return () => {
      cancelled = true;
      overlays.forEach((o) => {
        try {
          if (typeof o?.setMap === "function") o.setMap(null);
          else if (typeof o?.remove === "function") o.remove();
        } catch {
          /* overlay already gone */
        }
      });
    };
  }, [trips, places, minZoom, colorByDriver, driverColors]);

  if (state === "no-key") {
    return (
      <div
        className="card flex items-center justify-center text-center p-6 text-sm text-ink-soft"
        style={{ height }}
      >
        <div>
          <div className="font-medium text-forest-900 mb-1">
            Map not configured
          </div>
          Set <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in the
          deployment env (HTTP-referrer restricted to taxottic.com
          + the app WebView, Maps JavaScript API). Trips + the
          deduction below still work without the map.
        </div>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div
        className="card flex items-center justify-center text-sm text-red-700"
        style={{ height }}
      >
        Couldn&apos;t load the map. The mileage + deduction figures
        below are unaffected.
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={divRef}
        className="rounded-2xl overflow-hidden border border-forest-100"
        style={{ height, backgroundColor: "#121a2a" }}
        aria-label="Mileage breadcrumb map"
      />
      {colorByDriver ? (
        // Multi-driver map: colour = who drove. List each driver + swatch
        // (capped so the chip can't swallow the map), with a note that
        // fainter lines are personal / unreviewed drives.
        <div className="absolute bottom-3 left-3 card px-3 py-2 text-[11px] max-w-[70%]">
          <div className="text-[10px] uppercase tracking-[0.16em] text-gold-700 mb-1">
            Drivers
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {driverLegend.slice(0, 8).map((d) => (
              <span key={d.id} className="flex items-center gap-1 min-w-0">
                <span
                  className="inline-block w-3 h-1.5 rounded shrink-0"
                  style={{ background: d.color }}
                />
                <span className="truncate max-w-[8rem]">{d.name}</span>
              </span>
            ))}
            {driverLegend.length > 8 ? (
              <span className="text-ink-muted">
                +{driverLegend.length - 8} more
              </span>
            ) : null}
          </div>
          <div className="text-[10px] text-ink-muted mt-1">
            Fainter lines are personal / unreviewed.
          </div>
        </div>
      ) : (
        <div className="absolute bottom-3 left-3 card px-3 py-2 text-[11px] flex gap-3">
          <span className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-1.5 rounded"
              style={{ background: TRIP_COLOR.business }}
            />
            Business
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-1.5 rounded"
              style={{ background: TRIP_COLOR.personal }}
            />
            Personal
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-1.5 rounded"
              style={{ background: TRIP_COLOR.unclassified }}
            />
            Review
          </span>
        </div>
      )}
      {/* Gamified unlock chip, top-right corner of the map. Shows the
          next "zoom out" milestone so the bound dial doesn't feel
          arbitrary. Disappears when everything is already unlocked. */}
      {unlockHint && (
        <div
          className="absolute top-3 right-3 card px-3 py-2 text-[11px] leading-tight max-w-[180px]"
          title={`Longest business drive: ${longestBusinessMiles.toFixed(1)} mi`}
        >
          <div className="text-[10px] uppercase tracking-[0.16em] text-gold-700">
            Map unlocks at
          </div>
          <div className="mt-0.5 text-ink-soft">
            <span className="font-semibold text-gold-700">
              {unlockHint.needMiles} mi
            </span>{" "}
            <span>drive → {unlockHint.label}</span>
          </div>
          <div className="text-[10px] text-ink-muted mt-0.5">
            longest so far: {longestBusinessMiles.toFixed(1)} mi
          </div>
        </div>
      )}
      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-muted">
          Loading map…
        </div>
      )}
    </div>
  );
}
