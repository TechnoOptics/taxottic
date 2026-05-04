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
const CACHE_VERSION = "v7";
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

  // Static assets: cache-first.
  if (
    url.pathname.startsWith("/_next/static/") ||
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
