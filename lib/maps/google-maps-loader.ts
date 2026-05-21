// Minimal Google Maps JS loader — zero dependency.
//
// We avoid @vis.gl/react-google-maps / @react-google-maps/api AND
// @types/google.maps: new deps are bundle weight + a lockfile/CI
// surface (a repeated pain point). All we need is the
// `window.google.maps` global, typed loosely. This injects the
// script once, dedupes concurrent callers, and fails
// loudly-but-safely when the key is absent so the UI shows a
// "Maps not configured" panel instead of a blank crash.
//
// Key handling (security): NEXT_PUBLIC_GOOGLE_MAPS_API_KEY only.
// The key is restricted in Google Cloud by HTTP referrer
// (taxottic.com + the Capacitor WebView origin) and to the Maps
// JavaScript API — that referrer restriction is what makes a
// public client key safe. Never commit the key; never log it.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type GoogleMapsApi = any;

declare global {
  interface Window {
    google?: { maps?: GoogleMapsApi };
    __taxotticMapsPromise?: Promise<GoogleMapsApi>;
  }
}

export class MapsKeyMissingError extends Error {
  constructor() {
    super(
      "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set. Add it in Vercel " +
        "env (HTTP-referrer restricted to taxottic.com + the app " +
        "WebView origin, Maps JavaScript API only).",
    );
    this.name = "MapsKeyMissingError";
  }
}

/**
 * Resolve with the `google.maps` namespace once the JS API is
 * ready. Idempotent across the tab (one <script>, one in-flight
 * promise).
 */
export function loadGoogleMaps(): Promise<GoogleMapsApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("loadGoogleMaps called on the server"));
  }
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (window.__taxotticMapsPromise) return window.__taxotticMapsPromise;

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return Promise.reject(new MapsKeyMissingError());

  window.__taxotticMapsPromise = new Promise<GoogleMapsApi>(
    (resolve, reject) => {
      const existing = document.getElementById(
        "gmaps-js",
      ) as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener("load", () =>
          resolve(window.google!.maps),
        );
        existing.addEventListener("error", () =>
          reject(new Error("Google Maps script failed to load")),
        );
        return;
      }
      const s = document.createElement("script");
      s.id = "gmaps-js";
      s.async = true;
      s.defer = true;
      // The site-wide Referrer-Policy is `strict-origin-when-cross-
      // origin` (next.config.ts), which on a cross-origin request to
      // Google sends ONLY the bare origin as the Referer header — no
      // path. Google Cloud's website restrictions match against the
      // Referer, so the whitelist entry needs to be `https://
      // taxottic.com` (and the `*.` subdomain variant), not just
      // `https://taxottic.com/*`. We standardise here by explicitly
      // pinning the script's referrerPolicy to "origin" so the
      // request always sends the origin (regardless of the document
      // policy), which is the format both the docs and our Cloud
      // restrictions are now configured for. Without this pin, a
      // future Referrer-Policy change anywhere in the app could
      // silently break the Maps load.
      s.referrerPolicy = "origin";
      // geometry — encodePath() for the mileage breadcrumb polylines.
      // places  — the Autocomplete widget on the business address.
      // Both ship in one script load; pulling `places` here is what
      // makes <AddressAutocomplete> light up (no extra request).
      //
      // Cache-buster (`&t=…`) is critical: Maps API responses ship
      // with `Cache-Control: public, max-age=1800` — including the
      // ERROR responses. We hit this in production: while the key
      // was misconfigured (referrer didn't match), Google returned
      // 503 with that 30-minute cache header, so every subsequent
      // page load — long after we fixed the referrer config — kept
      // serving the cached 503 from disk. The browser's `<script>`-
      // tag cache is harder to bust than fetch(); a unique query
      // param per page-load forces a fresh GET. The Maps script
      // itself isn't billed per load, so this costs nothing.
      const cacheBuster = Date.now().toString(36);
      s.src =
        "https://maps.googleapis.com/maps/api/js?v=quarterly&libraries=geometry,places&t=" +
        cacheBuster +
        "&key=" +
        encodeURIComponent(key);
      s.onload = () => {
        if (window.google?.maps) resolve(window.google.maps);
        else reject(new Error("Google Maps loaded but global missing"));
      };
      s.onerror = () =>
        reject(new Error("Google Maps script failed to load"));
      document.head.appendChild(s);
    },
  );
  return window.__taxotticMapsPromise;
}
