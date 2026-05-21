// Server-side address → lat/lng helper. Uses the same Google Maps
// API key as the JS loader, just from the server (so the key doesn't
// leak in client JS for this code path, and the network request is
// our own — no browser referrer policy to worry about).
//
// Same env var as everything else: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.
// "Public" is a misnomer for server-side reads — Next.js exposes it
// to both runtimes, and the key already ships in client bundles, so
// re-using it on the server is no leak.

import "server-only";

export type GeocodeResult = {
  lat: number;
  lng: number;
  formattedAddress: string;
};

export type GeocodeError =
  | { code: "no_key" }
  | { code: "not_found" }
  | { code: "rate_limited" }
  | { code: "network" };

/**
 * Geocode a free-form address (or a Places Autocomplete output) to
 * lat/lng using Google's Geocoding API. Returns null + a `code` on
 * any failure — callers translate to a user-facing message. Keeps the
 * server action stupid: it doesn't need to know about Google error
 * shapes.
 */
export async function geocodeAddress(
  query: string,
): Promise<{ ok: true; result: GeocodeResult } | { ok: false; error: GeocodeError }> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return { ok: false, error: { code: "no_key" } };
  const clean = query.trim();
  if (!clean) return { ok: false, error: { code: "not_found" } };

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", clean);
  url.searchParams.set("region", "us");
  url.searchParams.set("key", key);

  try {
    const res = await fetch(url.toString(), {
      // The key is referrer-restricted to taxottic.com on the JS side,
      // but the Geocoding API is a server-side endpoint that accepts
      // the key as a query param without referrer enforcement, so this
      // works from a Vercel server function. (Referrer restrictions
      // are an HTTP-Referer header check; server-to-server calls don't
      // carry one, and Google's server-side endpoints fall back to the
      // key itself being valid.)
      headers: { Accept: "application/json" },
      // 8 s is generous; geocoding is normally < 300 ms.
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 429) {
      return { ok: false, error: { code: "rate_limited" } };
    }
    if (!res.ok) {
      return { ok: false, error: { code: "network" } };
    }
    const body = (await res.json()) as {
      status?: string;
      results?: Array<{
        geometry?: { location?: { lat?: number; lng?: number } };
        formatted_address?: string;
      }>;
    };
    if (body.status === "OVER_QUERY_LIMIT") {
      return { ok: false, error: { code: "rate_limited" } };
    }
    const first = body.results?.[0];
    const loc = first?.geometry?.location;
    if (
      !first ||
      !loc ||
      typeof loc.lat !== "number" ||
      typeof loc.lng !== "number"
    ) {
      return { ok: false, error: { code: "not_found" } };
    }
    return {
      ok: true,
      result: {
        lat: loc.lat,
        lng: loc.lng,
        formattedAddress: first.formatted_address ?? clean,
      },
    };
  } catch {
    return { ok: false, error: { code: "network" } };
  }
}
