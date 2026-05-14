/**
 * Google Places (New API) wrapper for the find-a-CPA card. Returns
 * a small list of tax preparers ranked by Google's review signals.
 *
 * Two paths:
 *   1. With lat/lng (browser geolocation): use Nearby Search ranked
 *      by relevance, biased to a 25km radius.
 *   2. With a postal address only: use Text Search with the location
 *      string baked into the query.
 *
 * Without GOOGLE_PLACES_API_KEY set, returns null and the UI falls
 * back to the open-Google-Maps link. No paid API call ever fires
 * unless the key is configured.
 */

export type CpaResult = {
  name: string;
  rating: number | null;
  user_ratings_total: number | null;
  formatted_address: string | null;
  open_now: boolean | null;
  google_maps_uri: string | null;
  primary_type_display: string | null;
  // Distance in meters when computed from a lat/lng query.
  distance_meters: number | null;
};

type SearchInput =
  | { kind: "geo"; lat: number; lng: number; query?: string }
  | { kind: "text"; query: string };

const PLACES_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_NEARBY_URL =
  "https://places.googleapis.com/v1/places:searchNearby";

const FIELDS = [
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.currentOpeningHours.openNow",
  "places.primaryTypeDisplayName",
  "places.location",
].join(",");

export async function searchCpas(
  input: SearchInput,
  limit = 6,
): Promise<CpaResult[] | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": FIELDS,
  };

  let body: unknown;
  let url: string;

  if (input.kind === "geo") {
    url = PLACES_NEARBY_URL;
    body = {
      includedTypes: ["accounting"],
      maxResultCount: limit,
      languageCode: "en",
      regionCode: "us",
      locationRestriction: {
        circle: {
          center: { latitude: input.lat, longitude: input.lng },
          radius: 25000,
        },
      },
      rankPreference: "POPULARITY",
    };
  } else {
    url = PLACES_TEXT_URL;
    body = {
      textQuery: input.query,
      includedType: "accounting",
      pageSize: limit,
      languageCode: "en",
      regionCode: "us",
    };
  }

  // Cap the upstream Google Places call at 6 seconds. Without this,
  // a slow Google response (or a network blip on the Vercel edge)
  // leaves the route handler hung — clients abort their fetch on
  // their own 8-second timer but the server-side request keeps
  // running, burning a serverless invocation. Reported in the May
  // 2026 weekly re-audit ("/api/cpa-search POST stays pending").
  const upstream = new AbortController();
  const upstreamTimeout = setTimeout(() => upstream.abort(), 6000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: upstream.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      // Treat upstream timeout the same as a missing API key — the
      // route handler returns `results: null` and the client falls
      // back to the Google Maps link.
      return null;
    }
    throw err;
  } finally {
    clearTimeout(upstreamTimeout);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Places API ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    places?: Array<{
      displayName?: { text?: string };
      formattedAddress?: string;
      rating?: number;
      userRatingCount?: number;
      googleMapsUri?: string;
      currentOpeningHours?: { openNow?: boolean };
      primaryTypeDisplayName?: { text?: string };
      location?: { latitude: number; longitude: number };
    }>;
  };

  return (data.places ?? []).map((p) => {
    const distance =
      input.kind === "geo" && p.location
        ? haversine(
            input.lat,
            input.lng,
            p.location.latitude,
            p.location.longitude,
          )
        : null;
    return {
      name: p.displayName?.text ?? "Unnamed",
      rating: p.rating ?? null,
      user_ratings_total: p.userRatingCount ?? null,
      formatted_address: p.formattedAddress ?? null,
      open_now: p.currentOpeningHours?.openNow ?? null,
      google_maps_uri: p.googleMapsUri ?? null,
      primary_type_display: p.primaryTypeDisplayName?.text ?? null,
      distance_meters: distance,
    };
  });
}

function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
