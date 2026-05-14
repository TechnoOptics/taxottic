/**
 * Taxottic service worker.
 * Strategy: network-first for HTML/data, cache-first for static assets.
 * Goal: snappy navigations + survives a brief network blip.
 *
 * Update flow: when a new SW version is installed, it sits in the "waiting"
 * state until the client explicitly tells it to take over. The client (see
 * PWASetup) shows a "New version - Refresh" toast and posts SKIP_WAITING
 * when the user taps it.
 */
// Bump on every behavior change to this SW. Bumping forces existing
// clients to drop stale caches in the `activate` handler below.
// v8 (May 2026): stop caching /_next/* — Next content-hashes its
// chunks, the browser's HTTP cache handles freshness, and caching
// them in the SW was the root cause of a persistent React #418
// hydration error after deploys (old client chunks hydrating against
// new server HTML).
// v9 (May 2026 Round-2): bumping to invalidate caches alongside the
// MedalCelebration Math.random fix (which was *also* a #418 source
// on the dashboard), the dashboard recap-card markup change, and
// the host-aware login/callback redirects. A no-op for the SW logic
// itself; the bump forces the activate handler to drop the v8 caches
// so the new server HTML hydrates against newly-fetched chunks even
// for clients that still had a v8 SW controlling them.
// v10 (May 2026 Round-2 follow-up): bumping again for the next-audit
// UX changes — dashboard "Coming up" urgency colors, achievements
// next-up row, expenses/income empty-state CTAs, vendor autocomplete.
// All HTML/markup tweaks; bumping prevents v9 clients from hydrating
// new server HTML against cached v9 chunks.
const CACHE_VERSION = "v10";
const STATIC_CACHE = `taxottic-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `taxottic-runtime-${CACHE_VERSION}`;

const PRECACHE = ["/", "/login", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(PRECACHE).catch(() => {
        // If a path is unreachable (e.g. /login redirects), don't break install
      }),
    ),
  );
  // NOTE: do NOT self.skipWaiting() here. We want the new SW to wait so the
  // client can prompt the user before we replace the running version.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/auth/")) return;

  // SKIP /_next/* entirely. Next.js content-hashes its JS chunks and
  // static assets — the filename changes on every deploy, so the
  // browser's HTTP cache handles freshness correctly. Caching them
  // in the service worker means old chunks survive deploys, and a
  // returning visitor gets new server HTML hydrating against old
  // client code → React error #418 (hydration mismatch). The May
  // 2026 weekly audit re-confirmed #418 after a build cycle; the
  // root cause was THIS code path. Removing /_next/* from the SW
  // cache fixes it without losing PWA offline capability for the
  // assets that actually benefit from caching (fonts, images).
  if (url.pathname.startsWith("/_next/")) {
    return; // fall through to default browser fetch
  }

  // Other static assets — cache-first is fine because these don't
  // version-skew the React tree.
  if (
    url.pathname.startsWith("/fonts/") ||
    /\.(png|svg|jpg|jpeg|webp|woff2|ttf|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        });
      }),
    );
    return;
  }

  // HTML / RSC: network-first, fall back to cache, then offline shell.
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          return new Response(
            "<!doctype html><html><body style=\"font-family:system-ui;padding:2rem;color:#0f2d24\"><h1>You are offline</h1><p>Reconnect to use Taxottic.</p></body></html>",
            { headers: { "Content-Type": "text/html" } },
          );
        }),
    );
  }
});
