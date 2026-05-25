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
// v31: mileage UX rebuild after the first real-drive day. The
// trip list is now a CLIENT component (TripList.tsx) so dates
// render in the user's local timezone instead of Vercel UTC.
// Classification is a SEGMENTED radiogroup (only one option
// visually active at a time) replacing the three pressable
// pills that read as multi-select. Each row has a delete
// button (with confirm). Trips are GROUPED into Today /
// Yesterday / This week / This month / Older. New
// TrackerStatus strip surfaces "is the tracker actually
// running" with the most recent ingested GPS point timestamp
// — green/amber/red dot + diagnostic checklist when red. New
// ManualLogTrip form for backfilling drives the tracker
// missed. SW bump so v30 clients pull the new markup.
// v32: /mileage/places — fixing "Add a place." Single-field
// AddressAutocomplete now writes the FULL formatted address on
// pick (was dropping city/state/zip), and AddPlaceForm carries
// the picked lat/lng in hidden inputs that the server action
// consumes to skip geocode entirely. New HIDDEN INPUTS need the
// fresh HTML to be wired up, so v31 clients have to drop their
// cached /mileage/places HTML — that's the reason for this bump.
// v33: import review page — 12 new Schedule C categories (state
// & gov fees, COGS, postage/shipping, phone/internet,
// parking/tolls, merchant fees, dues/subs, equipment purchase,
// business gifts, bad debts, pension, bookkeeping) + searchable
// CategoryCombobox replacing the plain <select>. Markup change
// on the review page so v32-cached HTML needs to drop.
// v34: desktop scaling pass after the user reported "everything
// is so small" on a wide monitor. AppHeader height bumps to h-14
// on lg and h-16 on xl; max-w-6xl bumps to max-w-7xl on xl and
// uncapped on 2xl. LeftRail width bumps w-56 → xl:w-60 → 2xl:w-64
// with the header's lg:pl-60 / xl:pl-64 / 2xl:pl-72 padding
// mirror. Page containers across consumer surfaces step
// progressively wider on xl + 2xl so a 1920px+ monitor uses the
// real estate. Pure layout — no JS or data change — but the
// markup is in every consumer page, so v33 clients need to drop
// their cached HTML on next nav.
// v35: bunch of import-review fixes after the user reported (1)
// re-run Bella didn't refresh the page (missing revalidatePath),
// (2) the app crashed with "page could not load" — no error
// boundary, so added app/error.tsx so future throws surface
// inline instead of dumping Next's default crash page, (3)
// please group imported csv into months — debits now group by
// posted_at month with subtotals per month, (4) Bella should
// show what was detected and the relevant IRC — new "Bella's
// pass" summary card at the top + per-row citation strip
// showing Sched C line, IRC §, IRS Pub, and a link out to
// irs.gov, (5) mobile floating menu now anchors to the header
// row centerline instead of viewport middle so it lines up with
// the wordmark.
// v36: credit-card row coloring (user: "if something has a
// negative sign on it when dealing with a credit card the
// amount should be green ... a debit acts like a credit and a
// credit acts like a debit"). Negative-on-credit now renders
// green with a + sign because that's cash returning to the user.
// Also: picker filter now includes 'personal' so charity / SALT
// / volunteer-mileage are tag-able from a credit-card statement,
// and applyTransactions routes personal-scoped picks via
// ignored=true (same path as transfer-scoped) so they label the
// row without inflating Schedule C. Two new categories shipped:
// sponsorship (IRC §162) and volunteer_mileage (IRC §170(j)).
// v37: optimistic slide-off on categorize/ignore (user: "Once
// an item has been allocated or skipped/ignored, please slide
// it off the list ... so the user feels like they are making
// progress going down the list"). TxRow extracted to a Client
// Component that animates out (opacity + translateX + max-height
// collapse over 350ms) BEFORE the server action fires — the
// page revalidates the row gone right after the animation
// completes. Page splits debits into Active (untouched) and
// Tagged (categorized but not yet booked) piles so the active
// list visibly shrinks. Tagged pile lives in a collapsed
// details below in case the user wants to review picks before
// hitting Apply.
// v38: auto-net refund/charge pairs (user: "if a user bought 10
// items and returned 2, bella would see that and based on the
// timeline, merchant id and number, only apply the difference or
// cancel them out completely and mark it as refunded"). Exact-
// amount + first-3-tokens merchant match + 120-day window. Both
// sides marked ignored + applied_category_code='refunded'. New
// 'refunded' transfer-scoped category drives a distinct emerald
// "↺ Netted refund" badge in TxRow. Also: louder "Bella
// suggests: <label>" chip on white-on-gold600 (was nearly
// invisible at gold-800-on-gold-50). Left accent bar (3px gold
// or emerald) on Bella-suggested / refund-netted rows so they
// pop in the active list. Defensive layout: row now wraps
// gracefully on narrow Opera viewports (break-words on mobile,
// truncate on sm+). v37 clients flush their HTML cache.
// v39: real desktop layout fix. The v34 pass added rail-clearing
// pl-60/64/72 to the AppHeader but I forgot to add the same
// padding to the PAGE SECTIONS — so on lg+ the content was
// centered in the full viewport instead of in the post-rail
// viewport, leaving a giant empty gap between the rail and the
// H1. Fixed: every consumer page section now matches the header
// padding pattern. Pure CSS — but every consumer page is in the
// markup so v38 clients must drop their cached HTML for the new
// classes to take effect.
// v40: mileage tracker reliability. User: "I drove around the
// whole day today and nothing was logged. This is now getting
// annoying." Two parts:
//   (1) CapacitorNativeInit now listens for App resume +
//       appStateChange events and re-arms tracking on every
//       foreground. Android (Samsung especially) silently kills
//       the @capgo foreground service when the app backgrounds;
//       resume-on-foreground catches that case so opening the
//       app after a drive auto-restarts the tracker.
//   (2) New /mileage/diagnose self-test page with a Client
//       component that walks every step of the plugin's start
//       path live — native shell, plugin registered, JS import,
//       start() resolution, callbacks firing, first fix lat/lng.
//       Each step lights up green/red so the user can screenshot
//       the exact failure mode on their phone.
// SW bump because new page markup ships.
// v41: THE BIG ONE. User: "the toggle is on... and I can see the
// location icon on my status bar of my phone so where is the
// disconnect?" Diagnosis: every batch the device flushed mid-
// drive was continuous-movement-with-no-stop. The segmenter
// needs a 5-min stationary dwell to CLOSE a trip; it found
// none; returned 0 trips; the ingest route returned ok with
// tripsCreated=0; the device cleared its local buffer; the
// points were lost. Zero rows in mileage_points / mileage_trips
// across the ENTIRE database, ever, was the smoking gun.
//
// Fix: new staging table `mileage_points_raw` (migration
// 20260525000001). Every incoming point lands in staging
// immediately. The ingest route runs segmentation across the
// UNION of (new batch + all unconsumed staging rows for this
// user, last 24h). When a trip closes (real pause finally
// detected), it materialises into mileage_trips +
// mileage_points and marks the contributing staging rows
// consumed. Mid-drive points stay in staging for the next
// batch. Nothing is dropped silently anymore.
//
// Also: flush() now keeps the batch on non-2xx (was clearing
// even on 401/403), logs the response into trackerDiag, and
// the AutoTrackToggle diag line shows
// `flush#N last=ok trips=K left=M` so the user can see from
// the toggle card whether their device is reaching the server.
// Ingest route now console.logs every request — Vercel runtime
// logs will finally show what's happening.
// v42: layout pass — drop content centering on lg+. User: "I do
// not like how it looks. With the menu all the way to the
// left." Root cause: on lg+ the rail sat at left-2 but content
// was mx-auto centered with a max-w, so on a wide monitor the
// content centered in the FULL viewport while the rail was
// pinned to the viewport's left edge → huge empty gap between
// them. Now: on lg+ every page section adds `lg:max-w-none
// lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16` which (a) drops the
// max-w cap, (b) removes the mx-auto centering, (c) adds
// breathing room on the right. Content now fills the post-
// rail area instead of floating in a centered island.
// v43: three concrete UI/UX fixes after the user's "drive a
// thorough audit" feedback —
//  (1) UserMenu dropdown was position:fixed top:50% left:50%
//      (center-screen) which felt completely disconnected from
//      the avatar that triggered it. Now anchors below the
//      button (top: rect.bottom+8, right: viewport-right-edge).
//  (2) AppHeader was max-w-6xl xl:max-w-7xl 2xl:max-w-none
//      mx-auto, which on lg+ centered the row inside a capped
//      box — leaving empty space to the LEFT of the wordmark
//      AND to the RIGHT of the user menu. Now: lg:max-w-none
//      lg:mx-0 lg:pr-6, so the row spans edge-to-edge with the
//      rail-clearing lg:pl-N already there. Wordmark sits flush
//      next to the rail, user menu sits flush near the right
//      edge.
//  (3) my-deductions tile grid bumped from sm:grid-cols-2 →
//      sm:grid-cols-2 xl:grid-cols-3 so the now-wider canvas
//      gets used: Home Office / Vehicle / future major
//      deductions lay out 3-across on a monitor.
// v44: deduction catalog expansion (user: "I believe there are
// so many that we are not showing our clients that need to be
// here ... we can group them by category but we need to give
// them all"). Three migrations applied:
//   20260525000002 — added display_group column +
//     deduction_scope.credit enum value. Backfilled
//     display_group on every existing row.
//   20260525000003 — ~40 new categories: insurance variants
//     (workers comp, liability, vehicle insurance, employee
//     group health), payroll (processing fees, FUTA/SUTA),
//     travel (lodging, per-diem meals, conference fees),
//     vehicle actual-method (fuel, repairs, lease), facility
//     (cleaning, security, trash, snow/landscaping, storage,
//     coworking), education (CE/CPE, certifications,
//     industry journals), startup (startup §195 + org §248),
//     web hosting + cloud storage, Schedule A (charity
//     non-cash, medical mileage, dental/vision, LTC,
//     mortgage points, property tax, IRA, educator), and 8
//     federal tax credits (Child Tax, Dependent Care, EITC,
//     Saver's, AOC, LLC, Residential Energy, Foreign Tax).
// Each carries IRC §, IRS Pub, and irs.gov URL.
//
// CategoryCombobox now renders section headers ("Insurance",
// "Vehicle", "Federal tax credits", etc.) between groups when
// no query is active — so scanning 80+ categories is grouped
// instead of one long alphabetical run. applyTransactions also
// routes credit-scope picks through ignored=true (alongside
// transfer + personal) so credits never inflate Schedule C.
const CACHE_VERSION = "v44";
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
