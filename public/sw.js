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
// v11 (May 2026): mobile-responsive pass — page-wrapper padding
// `px-6` → `px-4 sm:px-6` across 35+ files, card internal padding
// gets a mobile shrink (`p-5 sm:p-7` patterns), ReadinessHelp
// popover viewport-clamped. Pure CSS/markup changes; bump invalidates
// stale HTML caches so phone users actually see the new spacing on
// their next visit.
// v12 (May 2026 Round-5): /c/{id}/team and /tax-preparer redirect
// shims + inline edit on income & expense rows + confirm-on-Remove.
// Markup changes warrant a cache flush so the v11 clients pick up
// the new server HTML on next visit.
// v13 (May 2026 Round-6): brand refresh — the new chart-arrow icon
// shipped with the SAME urls as the old marks (icon-mark.svg,
// icon-mark-cream.svg, favicon-*.png, icon-*.png). Cache-first SW
// kept serving the OLD bytes for every returning visitor, so the
// loading screen and PWA icon never updated. Bumping the version
// drops `taxottic-runtime-v12` in activate() and forces the next
// fetch of every brand asset to hit the network, picking up the new
// PNG-in-SVG wrappers from public/brand/. Pure cache-bust; SW logic
// is unchanged.
// v14 (May 2026 Round-7): user reported the phone WebView wasn't
// picking up the dozen merged PRs (rail polish, mileage explainer,
// crash fix, etc). The PRs landed without an SW version bump, so
// the "New version available" toast never fired and the runtime
// cache kept serving the previous HTML. Bumping forces the
// activate() handler to drop taxottic-runtime-v13, the
// updatefound listener fires, the user sees the Refresh toast,
// taps it, and lands on the latest build. Pure cache-bust; same
// pattern as v13.
// v15 (May 2026 Round-7 follow-up): the v14 cache was holding on
// to the chunk graph from PR #194 so the toggle-init timeout
// fix in PR #197 wasn't reaching the Galaxy Z Fold5 WebView even
// after deploy. Bump to force activate() to drop the v14 cache
// and pull fresh chunks on the next nav. Pure cache-bust; SW
// logic unchanged. No way around this until we move static
// assets to a content-hashed CDN path (then SW caching becomes
// safe-by-default because URLs rotate).
// v16 (May 2026 Round-7 last bump): pairs with PR #199 which
// switches AutoTrackToggle's init from awaiting the @capgo
// dynamic import to a synchronous Capacitor availability check.
// Without bumping the SW, v15 keeps cache-first-serving the
// pre-#199 chunks and the toggle stays hung. Pure cache-bust.
// v17 (May 2026): pairs with the fire-and-forget bg.start() fix
// in native-tracker.ts. The previous awaited start() hung until
// the foreground service was fully up + first GPS fix arrived,
// leaving the toggle in a permanent "loading" state. v17 forces
// fresh chunks so the new fire-and-forget code reaches the WebView.
// v18 (May 2026): pairs with the mobile-sheet w-56 + UserMenu
// centered-on-viewport changes. Bumping ensures the new CSS
// classes + style positioning reach the WebView.
// v19 (May 2026): pairs with the toggle's optimistic-flip
// refactor. The toggle now flips visually IMMEDIATELY on tap
// and fires the native start/stop in the background. Bumping
// the SW invalidates the v18 chunks so the new
// non-blocking onToggle reaches the WebView.
// v20 (May 2026): pairs with the start()/callback diagnostic
// breadcrumb additions so we can finally see what bg.start()
// returns on Samsung WebViews.
// v21: auto-kick startMileageTracking on mount if persisted=true
// so we can finally observe the native call's actual return.
// v22: trace startMileageTracking entry/exit at every branch so
// call=untouched gets replaced with call=entered/no_bg/already_tracking/calling/...
// v23: don't await guard() in startMileageTracking, use cached
// plugin ref. Warm the @capgo import on mount so the cache is
// populated before any tap.
// v24: new /mileage/schedule page + ScheduleForm component +
// profiles.mileage_schedule JSONB column.
// v25: eco mode added to /mileage/schedule + native tracker reads
// localStorage eco flag to pick distanceFilter and stale options.
// v26: snapshot now returns real trackingActive (derived from
// recent mileage_points) + persisted autoApplyBusiness so the
// watch toggles stop flipping back. Also: vibrate + auto-nav on
// the wear app when a new pending trip lands.
// v27: wear auto-nav + vibrate fix (use `received` flag instead
// of seen.isEmpty so an empty-then-full sequence still buzzes).
// v28: phone-side swipe-to-classify deck. New route
// /mileage/classify (server component + ClassifyDeck client
// component) + pending-trip banner on /mileage. Markup change on
// /mileage so the v27 cache would serve stale HTML without the
// banner; bump forces fresh fetch.
// v29: mileage cross-page propagation fix. /c/{id}/money-out had
// `.select("miles, deduction_cents")` against mileage_trips —
// wrong column (it's distance_miles), so PostgREST errored out
// and the "Miles driven" tile was permanently zero no matter how
// many trips got classified business. Fixed the column + the
// reducer, broadened revalidatePath fan-out from both classify
// actions so my-deductions + forecast + savings-goals refresh on
// flip, force-dynamic'd money-out, and polished /mileage stats +
// mobile trip rows. Bump so phone WebViews drop v28 HTML and
// pull the corrected markup on next nav.
// v30: LeftRail is now FLOATING below the header — moved its
// top anchor from safe-top + 0.5rem (which lined it up with the
// TAXOTTIC wordmark in the header strip) to safe-top + 9rem,
// which lines the first menu item up with the company-name row
// ("Techno Optics LLC · this week") that sits below the H1 on
// authenticated pages. Pure CSS — no JS or markup change — but
// bumping the SW so existing clients drop the v29 HTML cache
// and pick up the new rail position on next nav.
const CACHE_VERSION = "v30";
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
