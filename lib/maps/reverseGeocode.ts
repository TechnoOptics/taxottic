// Client-side reverse geocoding for trip endpoints, turns a raw
// lat/lng into a human "City, ST ZIP" label so the drive log reads
// "Shakopee, MN 55379 → Mounds View, MN 55112" for reporting.
//
// Uses the Google Maps JS Geocoder that's already loaded for the
// breadcrumb map (no new key, no new script, the existing referrer-
// restricted NEXT_PUBLIC key permits the geocoder, verified on-device).
//
// Heavily cached: results are deduped in-memory AND persisted to
// localStorage keyed by coords rounded to ~11 m, so the same endpoint
// is only geocoded ONCE across trips and sessions. That keeps the
// Geocoding API call count (and cost) to roughly the number of distinct
// places the user actually drives between, not the number of trips.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadGoogleMaps } from "@/lib/maps/google-maps-loader";

export type PlaceLabel = {
  /** "Shakopee, MN 55379", the short reporting label. */
  short: string;
  /** "3700 Molina St, Shakopee, MN 55379, USA", full address, tooltip. */
  full: string;
  /** Business / POI name when the endpoint is at one ("Walmart",
   *  "Starbucks", a client's office). null for a residential street or
   *  highway shoulder. Resolved via a nearby Places lookup; the drive
   *  log shows this in place of the bare city when present. */
  name?: string | null;
};

// Bumped .revgeo. → .revgeo2. so cache entries written before the
// business-name field get re-resolved once (still one lookup per ~11 m
// place, so the added Places cost stays bounded to distinct endpoints).
const LS_PREFIX = "taxottic.revgeo2.";
const mem = new Map<string, Promise<PlaceLabel | null>>();

/** Round to 4 dp (~11 m) so near-identical fixes share a cache entry. */
function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/** Nearest prominent establishment to a coordinate, via the Places
 *  library (already loaded for the breadcrumb map + address
 *  autocomplete, no new key/script). Lets a trip endpoint read
 *  "Walmart" instead of just "Shakopee, MN". Returns null when there's
 *  nothing named within ~100 m (a residential street, a highway), so
 *  the caller falls back to the city label. */
function findNearbyName(
  maps: any,
  lat: number,
  lng: number,
): Promise<{ name: string; vicinity: string | null } | null> {
  return new Promise((resolve) => {
    try {
      if (!maps.places?.PlacesService) {
        resolve(null);
        return;
      }
      const svc = new maps.places.PlacesService(document.createElement("div"));
      svc.nearbySearch(
        { location: { lat, lng }, radius: 100 },
        (results: any[] | null, status: string) => {
          const ok = status === maps.places?.PlacesServiceStatus?.OK;
          const top = results && results[0];
          if (ok && top?.name) {
            resolve({
              name: String(top.name),
              vicinity: top.vicinity ? String(top.vicinity) : null,
            });
          } else {
            resolve(null);
          }
        },
      );
    } catch {
      resolve(null);
    }
  });
}

export function reverseGeocode(
  lat: number,
  lng: number,
): Promise<PlaceLabel | null> {
  if (
    typeof window === "undefined" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return Promise.resolve(null);
  }
  const k = cacheKey(lat, lng);

  const inFlight = mem.get(k);
  if (inFlight) return inFlight;

  // Persisted cache (survives reloads).
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + k);
    if (raw) {
      const p = Promise.resolve(JSON.parse(raw) as PlaceLabel);
      mem.set(k, p);
      return p;
    }
  } catch {
    /* private mode / quota, fall through to a live lookup */
  }

  const p = (async (): Promise<PlaceLabel | null> => {
    try {
      const maps = await loadGoogleMaps();
      const geo = new maps.Geocoder();
      const label = await new Promise<PlaceLabel | null>((resolve) => {
        geo.geocode(
          { location: { lat, lng } },
          (results: any[] | null, status: string) => {
            if (status === "OK" && results && results[0]) {
              const r = results[0];
              const comp = (t: string): string | null => {
                const c = r.address_components?.find((x: any) =>
                  x.types?.includes(t),
                );
                return c ? c.short_name : null;
              };
              const locality =
                comp("locality") ||
                comp("sublocality") ||
                comp("neighborhood") ||
                comp("administrative_area_level_2");
              const area = comp("administrative_area_level_1");
              const zip = comp("postal_code");
              const cityState = [locality, area].filter(Boolean).join(", ");
              const short =
                [cityState, zip].filter(Boolean).join(" ") ||
                r.formatted_address ||
                `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
              resolve({ short, full: r.formatted_address ?? short });
            } else {
              resolve(null);
            }
          },
        );
      });
      if (label) {
        // Enrich with a business/POI name when the endpoint sits at one
        // (a Walmart, a client's office, a restaurant). Keep the city
        // label as the fallback when there's nothing named here.
        const poi = await findNearbyName(maps, lat, lng);
        if (poi?.name) {
          label.name = poi.name;
          label.full = poi.vicinity
            ? `${poi.name}, ${poi.vicinity}`
            : `${poi.name} · ${label.full}`;
        }
        try {
          window.localStorage.setItem(LS_PREFIX + k, JSON.stringify(label));
        } catch {
          /* quota, in-memory cache still helps this session */
        }
      }
      return label;
    } catch {
      return null;
    }
  })();

  mem.set(k, p);
  return p;
}
