"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  zip?: string | null;
  stateCode?: string | null;
  city?: string | null;
};

type CpaResult = {
  name: string;
  rating: number | null;
  user_ratings_total: number | null;
  formatted_address: string | null;
  open_now: boolean | null;
  google_maps_uri: string | null;
  primary_type_display: string | null;
  distance_meters: number | null;
};

/**
 * Find-a-CPA card. When GOOGLE_PLACES_API_KEY is set on the server,
 * we fetch a small live list of nearby tax preparers (sorted by
 * Google rating) right inside the card. Without the key, we degrade
 * gracefully to a "open Google Maps" link.
 *
 * Two location modes:
 *   - Browser geolocation: best results, distance shown per row
 *   - Address-based fallback: uses the company's zip + city + state
 *
 * Geolocation requires user click + browser permission grant; we
 * don't ping it on mount.
 */
export function FindCpaCard({ zip, stateCode, city }: Props) {
  const locationLabel = useMemo(
    () =>
      zip ||
      [city, stateCode].filter(Boolean).join(", ") ||
      stateCode ||
      null,
    [zip, stateCode, city],
  );

  const fallbackQuery = `tax preparer CPA accountant${
    locationLabel ? " near " + locationLabel : ""
  }`;
  const fallbackMapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(
    fallbackQuery,
  )}`;

  const [results, setResults] = useState<CpaResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedGeo, setUsedGeo] = useState(false);

  // On mount, try a text-based search using the address. If the
  // server has no GOOGLE_PLACES_API_KEY it returns results: null and
  // we render the Maps link instead.
  //
  // The May 2026 audit's Low finding: "Searching..." was rendering
  // indefinitely after navigate-away/back. Root cause: `fetch` has
  // no default timeout, so a slow Google Places API call (or an
  // upstream hang) would leave `loading=true` until the user closed
  // the tab. Add an AbortController-backed 8s timeout to match the
  // geolocation call below and fall back to the Maps link on
  // timeout. Cleanup aborts the in-flight request if the component
  // unmounts mid-fetch.
  useEffect(() => {
    if (!locationLabel) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/cpa-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: fallbackQuery }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { results: CpaResult[] | null };
        if (!cancelled) setResults(data.results);
      } catch {
        // Silent: fall back to the Maps link.
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [fallbackQuery, locationLabel]);

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setError("Geolocation isn't available in this browser.");
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch("/api/cpa-search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { results: CpaResult[] | null };
          setResults(data.results);
          setUsedGeo(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Search failed");
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        setError(err.message || "Location permission denied.");
        setLoading(false);
      },
      { timeout: 8000, maximumAge: 60_000 },
    );
  }

  return (
    <div className="card p-6 sm:p-7">
      <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
        Need a tax preparer?
      </div>
      <h2 className="display mt-1 text-xl text-forest-900">
        {results && results.length > 0
          ? "Top-rated CPAs near you"
          : "Find a CPA near you"}
      </h2>

      {results && results.length > 0 ? (
        <ul className="mt-4 grid grid-cols-1 gap-2">
          {results.slice(0, 5).map((r, i) => (
            <li
              key={i}
              className="rounded-lg border border-forest-100 bg-white/80 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-forest-900 truncate">
                    {r.name}
                  </div>
                  {r.formatted_address ? (
                    <div className="text-xs text-ink-muted truncate">
                      {r.formatted_address}
                    </div>
                  ) : null}
                </div>
                {r.rating != null ? (
                  <div className="text-right">
                    <div className="text-sm font-medium text-forest-900 tabular-nums">
                      {r.rating.toFixed(1)}{" "}
                      <span className="text-gold-600">★</span>
                    </div>
                    {r.user_ratings_total != null ? (
                      <div className="text-[10px] text-ink-muted">
                        {r.user_ratings_total.toLocaleString("en-US")} reviews
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="mt-2 flex items-center gap-3 flex-wrap text-[11px] text-ink-muted">
                {r.distance_meters != null ? (
                  <span>
                    {(r.distance_meters / 1609).toFixed(1)} mi away
                  </span>
                ) : null}
                {r.open_now != null ? (
                  <span
                    className={
                      r.open_now ? "text-emerald-800" : "text-red-700"
                    }
                  >
                    {r.open_now ? "Open now" : "Closed"}
                  </span>
                ) : null}
                {r.google_maps_uri ? (
                  <a
                    href={r.google_maps_uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-forest-700 hover:text-forest-900 underline"
                  >
                    Maps →
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-soft leading-relaxed">
          Open Google Maps to see top-rated tax preparers
          {locationLabel ? ` near ${locationLabel}` : " near you"}, sorted by
          real reviews from real businesses. Bring your year-end summary and
          you&apos;ll have a productive 30 minutes.
        </p>
      )}

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <a
          href={fallbackMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary text-sm"
        >
          {results && results.length > 0
            ? "See all on Google Maps"
            : "Open Google Maps results"}
        </a>
        {!usedGeo ? (
          <button
            type="button"
            onClick={useMyLocation}
            disabled={loading}
            className="btn-ghost text-sm"
          >
            {loading ? "Searching..." : "Use my location"}
          </button>
        ) : null}
        {!locationLabel ? (
          <span className="text-xs text-ink-muted">
            Add an address or zip in your business profile for nearer
            matches.
          </span>
        ) : null}
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
      </div>
    </div>
  );
}
