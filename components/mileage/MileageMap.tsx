"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
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
};
export type MapPlace = {
  id: string;
  kind: "home" | "office" | "client" | "other";
  label?: string | null;
  lat: number;
  lng: number;
};

// Breadcrumb colours: business reads "money/deductible" green,
// personal a warm amber, unclassified a muted grey "needs review".
const TRIP_COLOR: Record<MapTrip["classification"], string> = {
  business: "#16a34a",
  personal: "#d97706",
  unclassified: "#71717a",
};
const PLACE_GLYPH: Record<MapPlace["kind"], string> = {
  home: "🏠",
  office: "🏢",
  client: "📍",
  other: "⚲",
};

export function MileageMap({
  trips,
  places,
  height = 420,
}: {
  trips: MapTrip[];
  places: MapPlace[];
  height?: number;
}) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "no-key" | "error"
  >("loading");

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
        });
        const bounds = new maps.LatLngBounds();
        let plotted = 0;

        for (const t of trips) {
          if (t.points.length < 2) continue;
          const path = t.points.map((p) => ({ lat: p.lat, lng: p.lng }));
          const line = new maps.Polyline({
            path,
            strokeColor: TRIP_COLOR[t.classification],
            strokeOpacity: 0.9,
            strokeWeight: 4,
            map,
          });
          overlays.push(line);
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
          // Single point would zoom to street level absurdly.
          const once = maps.event.addListenerOnce(map, "idle", () => {
            if (map.getZoom() > 16) map.setZoom(15);
          });
          overlays.push(once);
        } else {
          map.setCenter({ lat: 39.5, lng: -98.35 }); // US centroid
          map.setZoom(4);
        }
        setState("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState(e instanceof MapsKeyMissingError ? "no-key" : "error");
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
  }, [trips, places]);

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
        style={{ height }}
        aria-label="Mileage breadcrumb map"
      />
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
      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-muted">
          Loading map…
        </div>
      )}
    </div>
  );
}
