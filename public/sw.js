/**
 * Taxottic service worker.
 * Strategy: network-first for HTML/data, cache-first for static assets.
 * Goal: snappy navigations + survives a brief network blip.
 *
 * Update flow: a new SW takes over as soon as it installs (skipWaiting in
 * the install handler, clients.claim in activate). PWASetup reloads on
 * controllerchange, so the page picks up the new bundle by itself.
 *
 * This used to wait for the user to tap a "New version - Refresh" toast.
 * That deadlocked: the auto-adopt that would have posted SKIP_WAITING
 * without a tap ships in the bundle the OLD worker serves, so it could
 * never install itself. Two devices sat four days behind production as a
 * result. See the v151 note below. The SKIP_WAITING message handler is
 * kept so any client still running the old bundle continues to work.
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
// v45: REAL layout fix after looking at the user's ultrawide via
// computer-use. Even after refreshing to v44, content still capped
// at ~30% of the viewport. Diagnosis: Tailwind sorts variant
// utilities by breakpoint width — so `xl:max-w-6xl` and
// `2xl:max-w-7xl` got emitted AFTER `lg:max-w-none` in the CSS
// output and won on wide monitors. lg:max-w-none was effectively
// dead code. Bulk-stripped the xl/2xl max-w override pairs from
// every consumer page. Now lg:max-w-none wins everywhere ≥ lg.
// v46: LeftRail looks like a real sidebar now. Was a rounded card
// floating at left-2 starting at safe-top+9rem — read as a popup
// detached from the layout. New treatment: position fixed to the
// LEFT EDGE of the viewport, full-height from just under the
// header to the bottom safe-area, flat bg-paper/95 + border-r
// instead of the card shadow + rounded-all-sides. Only the RIGHT
// edge stays rounded (rounded-r-2xl) so there's a soft visual
// seam into the content area.
// v47: IA restructure. LeftRail now company-aware: Dashboard +
// Companies switcher at top, separator, [Company name] header +
// Forecast / Income / Expenses / Mileage / Import / Deductions /
// Chat / Settings underneath. User-level items (Tax profile,
// Goals, Reminders, Billing, Security, Your data, Recycle bin)
// moved entirely into the profile-icon dropdown. CompanyNav 5-tab
// strip neutralized (returns null) — the rail is now the only
// navigation. Mobile menu opener moved from a header-row tab to a
// bottom-left FAB so it stops overlaying the header. Labels:
// Money in → Income, Money out → Expenses, Talk → Chat, Setup →
// Settings (routes unchanged).
// v48: Sticky-rail fix. Discovered via Chrome MCP that the sidebar
// scrolled away with the page because globals.css has an UNLAYERED
// `nav { position: relative }` rule that beats Tailwind's `.fixed`
// regardless of specificity. Added `!fixed` (Tailwind important
// modifier) on the rail className so the rail genuinely stays pinned
// to the viewport at every scroll position.
// v49: Mobile menu opens FROM THE BOTTOM-LEFT FAB. The previous
// drawer covered the entire area below the header which read as
// "the whole app disappeared into a menu." New treatment: the panel
// anchors to the bottom-left FAB position and scales/slides up from
// there, sized to its content (no longer claims the full viewport).
// Backdrop dims everything above.
// v50: Mileage capture rebuild. Three coupled fixes:
//  (1) startMileageTracking now AWAITS the plugin import (capped at
//      5s) on first tap so the very first toggle actually starts the
//      tracker instead of returning "warming" and going silent.
//  (2) AutoTrackToggle subscribes to a new onTrackerStartSettle hook
//      so a bg.start() rejection flips the toggle back off and
//      surfaces a real error — previously the toggle stayed visually
//      ON while LS_ENABLED was silently written to "0", which the
//      user only discovered on next reload.
//  (3) flush() runs every 30 s (was 120 s) AND fires a HEARTBEAT
//      (empty points) while tracking is active so the server keeps
//      re-segmenting the staging pool when the user has parked. The
//      previous cadence meant a 5-min drive ended before any points
//      ever hit the server, so the in-progress trip was never
//      materialized.
// v51: Defer tail-close in segmentation when the user is still
// driving. SW v50 introduced 30s heartbeats while tracking — combined
// with the segmenter's "always close whatever's open at end of
// stream" logic, every heartbeat materialized the in-progress trip
// as a fragment, then subsequent points (after those fragments were
// marked consumed) became their own fragments. A 10-min drive
// produced ~20 tiny trips. Fix: segmentTrips now accepts
// `closeOpenAtEnd` (default true, preserves test semantics); the
// ingest endpoint passes `false` when the most recent staged point
// is < STATIONARY_DWELL_MS (5 min) old. While driving, the tail
// stays in staging; when the user parks and the heartbeats see a
// stale tail, the close fires and one continuous trip materializes.
// v52: CRITICAL pre-drive fix. Forensic on production staging
// (195 unconsumed points, zero materialized trips) revealed the
// Android @capgo plugin reports `speed: 0` on every fix. The
// segmenter's `cur.speedMps >= 0` check trusted that 0 and never
// fell back to haversine, so no segment ever opened. Now: device
// speed > 0 wins (trust the device when it has a real reading);
// 0 or null falls through to haversine-derived speed (which is
// accurate at rest AND in motion). Without this fix, every drive
// on the user's phone would be silently lost.
// v53: Toggle cold-start race recovery. Real-device diag showed
// plug=true imp=true start=true (plugin loaded) BUT
// call=unsupported err=guard_timeout — guardWithTimeout's 5s timeout
// fired before guard() finished caching the plugin ref. Fix: after
// the timeout, re-check the module-level plugin cache; if guard()
// won the race, use it. Also bumped GUARD_TIMEOUT_MS 5s → 10s. Net
// effect: a slow first cold-start now succeeds on the first tap
// instead of needing two.
// v54: CRITICAL drive-killer fix. Real-world drive: tracker showed
// call=already_tracking + cbErr=ALREADY_STARTED + cbs=1, server
// received zero new points across the entire drive. Root cause:
// @capgo plugin's foreground service survived a WebView reload. New
// JS called bg.start(); plugin returned ALREADY_STARTED but DID NOT
// register the new callback. The orphaned old callback (in dead JS
// context) was the sole listener — every GPS fix during the drive
// went to /dev/null. Fix: startMileageTracking now ALWAYS calls
// `await bg.stop()` before `bg.start()` to nuke any orphan service
// before registering our fresh subscription. The pre-stop is wrapped
// in try/catch because "nothing to stop" is the common case.
// v55: CRITICAL last-mile fix. On-device proof finally arrived — a
// clean 1.2 km drive (41 points, 0→22 m/s, 3.8 m accuracy) was
// captured end-to-end while the app was backgrounded (the v54 +
// @capgo onUnbind patch worked). But ZERO trips materialized: the
// drive ended without a 5-min stationary dwell, so the segment
// stayed OPEN, and stopMileageTracking's final flush sent no
// "session ended" signal — the server kept closeOpenAtEnd=false and
// the flush timer was already cleared, so no later heartbeat ever
// closed it. The drive sat stranded open in staging forever. Fix:
// the stop-tracking flush now posts { sessionEnded: true }, and the
// ingest route force-closes the in-progress trip when it sees that
// flag. Toggling off = "I'm done" = materialize the drive now.
// v56: TWO confirmed drive-killers, found via live DevTools forensics on
// the user's actual Galaxy Z Fold5 (every prior "fix" was validated on
// the emulator; the real phone had NEVER sent a single point).
//   (1) bg.start(opts, cb).then().catch() — on Android, start() with a
//       callback is NOT a thenable; calling .then() throws
//       "BackgroundGeolocation.then() is not implemented on android",
//       which tripped the rejection path and flipped tracking OFF +
//       wrote enabled="0" the instant tracking began. Fixed: fire-and-
//       forget start(); report success optimistically; only observe a
//       promise off-native (web shim).
//   (2) flush used fetch({keepalive:true}) — keepalive caps the body at
//       64 KB, so once the buffer passed ~700 points EVERY flush threw
//       "TypeError: Failed to fetch" and the buffer pegged at 5000 with
//       ZERO points reaching the server (proven: a tiny POST returned
//       200, the 179 KB body threw with keepalive, succeeded without).
//       Fixed: drop keepalive + cap each POST to 800 points; a backlog
//       drains over successive ticks. Durability is covered by the
//       localStorage-persisted buffer + retry.
// v57: Trip review UX. The Business/Personal/Review pill no longer
// pre-selects anything (Business/Personal fill only on exact match, so
// an unclassified drive shows nothing selected). "Review" is now an
// action, not a classification: it loads that one drive's route onto
// the map and scrolls/focuses there, and only ONE trip can be in review
// at a time (the range overview is the sole multi-trip view). Bump so
// the new /mileage bundle is picked up on refresh.
// v58: Trip location labels. Each drive now shows its start → end place
// ("Shakopee, MN 55379 → Mounds View, MN 55112") for a report-ready log,
// reverse-geocoded client-side via the already-loaded Google Maps key
// and cached in localStorage (one lookup per distinct place). Saved
// places (e.g. "Office") win over the geocoded address when known.
// v59: Review toggle. Tapping "Review" on the drive that's already in
// review now returns to the all-drives overview (it toggles); tapping
// it on a different drive switches focus to that one.
// v60: "First drive logged" badge. A logged BUSINESS trip now earns its
// own achievement (distinct from the "vehicle" profile-flag badge), so
// tracking mileage is rewarded. Also: the forecast now counts tracked
// mileage when vehicle_method is unset (server fix), so the deduction
// moves the projection.
// v61: Multi-business trip routing. When the user belongs to more than
// one company, each drive shows a "Business" picker to move it to the
// right one (server action moveTripCompany; auth = driver/manager of
// source + member of target). Hidden for single-company users.
// v62: Dark-mode dropdown fix. The app never declared a color-scheme, so
// on a phone in dark mode the Android WebView painted every native
// <select> popup SOLID BLACK — tapping the vehicle-method picker (or any
// dropdown) blanked the screen until you pressed Back. Pin html to
// color-scheme:light so native dropdowns render as readable lists.
// v63: Custom in-app dropdown (SelectMenu). Replaces native <select>
// popups (still rough/dim even with color-scheme:light) with a crisp,
// on-brand in-DOM menu — no OS popup at all. Rolled across the core
// consumer forms: business-profile vehicle method, trip business
// picker, income (month/source), goals (type/company), tax-profile
// (filing status/state), and import row (match type / treat-as).
// v64: Per-employee visibility. Expenses list gains a team-member
// filter (?emp=) + a per-row "added by" tag; the mileage map gains a
// manager-only driver switcher (?driver=) to review any teammate's
// drive log. New client components (EmployeeFilter, DriverPicker).
// v66: Page-eyebrow refinement. The small uppercase kicker above each
// company page title no longer shows the raw company public_id
// (e.g. "CO_Z1UEUQERXT · Banks"). Pages whose H1 is the page title now
// show the friendly company name ("Techno Optics LLC · Tax year 2026");
// pages whose H1 is already the company name drop the identifier and
// keep just the page label ("Banks", "Team") to avoid repeating it.
// v67: Interaction fixes from on-device QA. (1) Killed the uncaught
// "BackgroundGeolocation.then() is not implemented" exception that
// fired on every page load — bg.stop() is callback-style on Android,
// so awaiting it tripped the .then proxy (same root cause as start);
// now fired without awaiting `.then` on native. (2) Dashboard "dismiss
// overdue reminders" X actually dismisses now — the server-action
// <form> in the Server Component was submitting as a plain POST with no
// Next-Action header (action never ran); moved to a client component
// that invokes the action directly. (3) Removed a stray NUL byte from
// the dashboard source.
// v68: Scope the dashboard reminder + goal queries to the signed-in
// user (.eq user_id). RLS lets a super-admin read every user's rows, so
// the consumer dashboard recap was showing OTHER people's overdue
// reminders/goals — and the (correctly user-scoped) dismiss-X could
// never clear them, so the card looked permanently stuck. Now the recap
// only ever shows your own rows.
// v69: iOS safe-area fix — hamburger FAB / header chrome were "lost in
// the status bar" because WKWebView's env(safe-area-inset-*) reporting
// is flaky. CapacitorNativeInit now measures the REAL insets natively
// (capacitor-plugin-safe-area) on iOS and publishes them as CSS-var
// floors (--app-safe-top / --safe-bottom), with screen-size heuristic
// floors for binaries that predate the plugin. All consumers already
// take max(var, env) so the correct signal always wins.
// v70: /debug/device diagnostics page + Settings → Troubleshooting
// entry. An iPhone can't be remote-inspected from a Windows dev box
// (no ADB analogue; Safari Web Inspector is macOS-only; release
// WKWebViews aren't inspectable since iOS 16.4), so the phone itself
// becomes the probe: the page reads env() insets, the CSS-var
// overrides, native SafeArea insets, real header/FAB geometry, app
// build + SW generation into one copyable blob.
// v71: mileage map now shows direction of travel — forward arrowheads
// riding each breadcrumb at a steady cadence, a green start dot, and a
// checkered-flag end disc — so a glance answers "which way did this
// drive go?". Plus: hand-entered (manual) trips now fire the same
// saved-drive push as GPS-tracked ones.
// v72: dashboard calm/editorial redesign — one accent (gold), one card
// treatment (.surface), .kicker-sm eyebrows, generous spacing. Bump so
// installed shells pull the restyled bundle.
// v73: redesign fixes after seeing it live — .surface now genuinely lifts
// (soft shadow in light, lighter-navy + edge in dark; the bare-hairline
// first cut read as ghost cards), and Tailwind's `dark:` variant now
// follows the app's data-theme instead of the OS media query (the two
// dark systems were fighting — e.g. the left rail vanished).
// v74: world-class dashboard hero — a gold readiness ring + a glanceable
// stat band (readiness · mileage YTD · next deadline) opens the page on
// "where do I stand", replacing the flat stack of equal cards. The lone
// mileage tile folds into the band.
// v75: mileage now shows DAY-BY-DAY in the deduction lists — each
// business drive is its own dated line in the Expenses month accordion
// and a per-drive list on My Deductions, instead of a single monthly
// rollup. (Mileage stays its own deduction stream; this is presentation.)
// v76: calmed the app-wide `.card` primitive to match the dashboard's
// `.surface` — dropped the gold ring, inset champagne highlight, and the
// ::before top-edge gold line; now a hairline border + soft shadow
// (lighter-navy in dark). One change brings every screen that uses
// `.card` into the calm system at once.
// v77: clicking a mileage deduction line (Expenses + My Deductions) now
// opens THAT specific drive on the map — /mileage/business?trip=<id>
// scopes the page to the one trip (map auto-fits to its route, list
// shows its details) instead of dumping the user on the full mileage page.
// v78: Deduction explorer promoted to a main left-rail item ("Explore
// deductions"; the existing tab renamed "My deductions"). The explorer
// now also has a "Charitable giving & personal itemized deductions"
// section explaining 501(c)(3) gifts are a §170 Schedule A deduction
// (why they're not on the business Expenses page) with the cash /
// non-cash / volunteer-mileage rules.
// v79: log a charitable gift → earn the gold "Philanthropist" medal.
// New charitable_donations table (personal, kept out of business
// expenses), a log-a-gift form on the explorer, a "give back" year-end
// to-do, and the badge awarded on the first logged donation.
// v80: layout — cap the authenticated content column at 80rem and center
// it in the space right of the rail on large/ultrawide screens (was
// max-w-none, which stretched a single card to ~2,500px on a 3000px+
// display and pushed buttons off-screen). One unlayered CSS rule; rail
// stays attached on laptops.
// v81: left-rail polish — company section header is now a serif monogram
// chip (identity), and the active nav item gets a gold icon + stronger
// gold ring + medium weight so the current page reads clearly.
// v82: Forecast two-column on lg+ — the narrative (hero, year-end view,
// breakdown, chart) flows in the main column while a sticky right panel
// holds the personalized "year-end moves" + quick actions. Uses the
// width with intent instead of one long centered column; collapses to a
// single column (panel last) below lg.
// v83: unified page headers — a shared <PageHeader> (kicker eyebrow +
// serif title + optional subtitle + gold flourish) now drives Expenses,
// My deductions, and the Mileage business-trips pages, ending the
// eyebrow size/tracking + flourish drift between screens.
// v84: fold the logo-led headers (Forecast, Deduction explorer) into the
// same <PageHeader> via an optional `logo` slot — they keep the company
// logo but now share the identical eyebrow/title/flourish. Every content
// screen is on one header primitive.
// v85: Income + Expenses each get an always-visible "Import (CSV) /
// Connect an account" action row under the header (shared
// ImportConnectActions) — previously these only showed in the empty
// state. Income's header also moved onto the shared <PageHeader>.
// v86: Team — added "Team" to the left rail (was only reachable via a
// forecast link), and the team roster now shows each member's YTD
// expenses + BUSINESS mileage (managers only) with a "View expenses"
// link. Privacy: a manager reviewing a teammate's /mileage log now only
// sees BUSINESS drives — their personal + unclassified drives stay
// private.
// v87: battery — the mileage tracker now accepts a recent cached OS-fused
// fix (stale:true) by default instead of forcing a fresh GPS sample on
// every trigger; per the team's own notes this is the biggest Samsung
// battery win, and it can't affect trip distance/deduction. (Ships via
// the web bundle, so no APK rebuild.) Eco mode (100m filter) still
// available for more.
// v88: Team roster fix (part 1) — the Team page rendered an empty roster
// and mislabeled the manager as a plain "member". Made the page
// force-dynamic and moved the roster/invite/financial reads to the service
// client behind the RLS company-access gate.
// v89: Team roster fix (part 2, the REAL cause) — the roster query embedded
// `profile:profiles(...)`, but company_members.user_id has no foreign key to
// profiles (it points at auth.users), so PostgREST could not resolve the
// embed: the query errored and returned null, blanking the roster regardless
// of which client ran it. Now we fetch member rows and their profiles in two
// queries and stitch them by user_id.
// v90: Team — the account creator is now always treated as the company
// manager (a safety net in both the server invite/remove/revoke gate and the
// /manage UI), so whoever created the company can never get locked out of
// inviting teammates even if their membership row is ever missing or demoted.
// v91: native-only gating — a reusable <MobileOnly> gate now fences genuinely
// native capabilities to the mobile app (automatic GPS mileage tracking, watch
// pairing); on the web those controls are replaced by a tasteful "in the
// mobile app" card. Makes the iOS app visibly do things the website can't,
// keeping it clear of App Store Review Guideline 4.2 (Minimum Functionality).
// v92: login — the email path now reveals a "6-digit code" field after the
// magic link is sent (verifyOtp), so anyone who'd rather type a code than
// open their inbox can, and — paired with a Supabase test OTP on the demo
// account — the App Store / Play reviewer can sign in without clicking a link
// in a mailbox they don't control (a hard requirement for review of a
// passwordless, login-gated app).
// v93: review sign-in — the 6-digit code field now also routes through a
// server bypass (/api/auth/demo-login) that signs in one hardwired demo
// account when a fixed code is presented, gated behind REVIEW_DEMO_EMAIL/
// REVIEW_DEMO_CODE env vars (off otherwise). Lets a store reviewer reach a
// seeded demo without inbox access; everyday users fall through to OTP.
// v94: App Store Guideline 3.1.1 — every purchase/upgrade/billing control
// (CheckoutButton, ManageBillingButton, TrialBanner CTA, ProGate CTA, the
// dashboard Pro upsell, UserMenu "Billing & plan", /billing + /pricing buy
// buttons) is now hidden inside the native app via <WebOnly>. Subscriptions
// run through Stripe on the web (not Apple IAP); the app is view+use only.
// v95: login — the 6-digit code field is now reachable via an "Have a
// sign-in code? Enter it" affordance that doesn't require the magic-link
// send to succeed. Fixes store-review sign-in: the demo account's address
// isn't deliverable, so signInWithOtp 400s, but the code (verified by the
// demo-login route) must still be enterable.
// v96: Web Push. Added `push` + `notificationclick` handlers below so
// browsers/desktop PWAs can receive the same notifications the native
// apps do (VAPID subscription created client-side in lib/push/web.ts).
// No caching change; the bump ships the new handlers to existing clients.
// v97: mileage map rendering changes (#382 dashed approximate trips
// with full sparse traces, #383 Directions road-snapping) shipped
// WITHOUT a bump, so WebView clients kept serving the cached pre-#382
// map — reported on a real device as drives still displaying wrong
// while the server data was verified healthy. Bump forces existing
// clients to drop the stale HTML/JS on next nav.
// v98: mileage reliability — TrackingHealthBanner gains the "Run the
// reliability check" link, new /mileage/setup wizard, tracker gains
// device-status heartbeat enrichment + instant permission-downgrade
// reaction. Bump so WebViews drop stale JS (the v96 lesson).
// v99: firm auto battery-exemption — CapacitorNativeInit now
// auto-prompts the "allow background" dialog on every Android device
// when tracking is enabled and the OS is optimizing us, so no driver
// has to find the setup wizard. Client-JS change → bump so WebViews
// drop the v98 cache.
// v100: walk-away drive-end detection — the tracker now closes a
// drive ~30s after the driver walks away from the car (step burst via
// the DeviceStatus plugin) or after a 6-min stationary fallback,
// instead of only the server's 5-min parked timer. Client-JS change
// (native-tracker + wizard row) → bump so WebViews drop v99.
// v101: heartbeat resilience — time-boxed native-bridge reads so a
// wedged plugin can't silently kill device heartbeats (observed on a
// real device: flushes fine, heartbeats stopped), appVersion now sent,
// result surfaced in trackerDiag. Client-JS change → bump.
// v102: QA pass — location-settings deep-link + gate business surfaces
// for members (see #404).
// v103: employee personal-hub gate. An account whose only role is
// being someone else's employee (owns no company) no longer gets the
// personal tax hub for free — the Personal nav is replaced by an
// upgrade upsell, /dashboard sends them to their work home, and the
// /personal/* routes redirect to /personal/upgrade. Owners and
// employees with their own paid plan are unaffected. Client chrome
// (LeftRail/AppHeader) changed → bump.
// v104: tracked business mileage is now spelled out on the company
// forecast (amount, drive count, driver count), and an unconfigured
// has_vehicle no longer silently zeroes a real tracked deduction.
// Forecast markup changed -> bump so WebViews drop v103.
// v105: the personal hub no longer shows tracked BUSINESS mileage in
// its hero band (that is company data on a personal page); the slot now
// shows personal deductions YTD. Dashboard markup changed -> bump.
// v106: OutdatedAppBanner — native shells below the min supported
// build now get a persistent "update to keep tracking" nudge, the
// durable antidote to devices sitting on stale builds and silently
// losing drive capture. New client component -> bump.
// v107: manager Team-tracking-health card on /mileage — flags a
// driver whose phone went silent or has been parked, computed from raw
// uploads so it works on any build. New server markup -> bump.
// v108: audit fixes 1/3 — walk-away close can no longer be dropped by
// a colliding flush (client change), manual/route trips protected from
// machine rewrite. Client JS changed -> bump.
// v109: audit money-math fixes — IRS split-rate 2026 mileage pricing
// (72.5¢ H1 / 76¢ H2), car_truck no longer double-counted under
// standard mileage, projections on elapsed months. Forecast copy
// changed -> bump.
// v110: CPA export now includes tracked mileage (Sched C Line 9),
// excludes personal-reclassified rows; data export role-scoped. Page
// markup changed -> bump.
// v111: buffer carries company provenance (multi-company miles can't
// jump books); team chat gated on the COMPANY plan (employees of a
// paying company stay in). Client JS changed -> bump.
// v112: dead stops no longer sever drives (10-min server dwell,
// 12-min client fallback); chat attachment paths confined. Client JS
// changed -> bump.
// v113: tax-engine corrections — NIIT/EITC see capital gains, AMT
// keeps credits, additional-Medicare withholding credited, QBI cap
// excludes net capital gain, combined 1040 keeps family credits.
// v114: marketing/pricing copy corrected to match shipped reality
// (daily sync not hourly, CPA workpaper not PDF+CSV, no unbuilt
// white-label/API/trial-email claims). Public pages changed -> bump.
// v115: expense sheet expands recurrence like the forecast (same row,
// same number on both screens); trip tax year from local date; render
// window clamped so neighbours can't double-count.
// v115: device-clock skew now shifts a batch instead of collapsing it
// (drives keep their shape), watchdog budget resets on real fixes,
// employee filter gated to manager/lead. Client JS changed -> bump.
// v117: GPS walk-away detection — permission-free fast drive close
// from walking-band GPS drift; restores fast close on Android (no step
// counter) and doubles as a second witness on iOS. Client JS -> bump.
// v118: trip thumbnails — polyline fetch paginated past PostgREST's
// 1000-row cap (most trips had NO preview), dark navy basemap with the
// big map's gold path (was invisible light-on-light), placeholder tile
// for manual trips. Client markup changed -> bump.
// v119: actionable classify banners — Business / Personal buttons
// resolve from the notification without opening the app (background
// POST to /api/push/action + confirmation toast); Review deep-links.
// Trip banners now lead with the snippet ("3.2 mi drive · 7:41 PM").
// v120: GPS walk-away hardened — arms only after a 45s hard stop and
// requires off-axis movement, so highway stop-and-go (walking-pace
// creep) can never close a drive mid-motion again.
// v121: render-time GPS jitter suppression — 50-100m-accuracy scatter
// no longer scribbles routes; noise-circle bounce is dropped from the
// drawn track (segmentation unchanged).
// v122: iOS background revival — native SLC capture + disk buffer,
// drained on page load. Also fixes the iOS DeviceStatus plugin never
// having been compiled into the app at all.
// v123: Background App Refresh now travels to the server and shows
// as its own "blocked" state (it silently defeats every iOS relaunch
// path); native Visits monitoring added as a second revival trigger.
// v124: flush now removes uploaded points by identity, so buffer
// eviction during an in-flight POST can no longer delete unsent fixes.
// v125: device-status plugin no longer gated on isPluginAvailable —
// that probe was silently returning false on BOTH platforms, so device
// truth (permissions, battery, low-power) was never reported at all.
// v126: mileage uploads now use the NATIVE http stack on device.
// Android throttles WebView-issued requests after ~5 min in the
// background, which stalled flushes mid-drive and grew the buffer
// toward eviction. Web is unchanged.
// v127: heartbeat now carries the OS's own reason for the last
// process death (Android ApplicationExitInfo / iOS MetricKit), so
// "tracking stopped" becomes a named cause instead of a guess.
// v128: a stationary phone's sparse GPS drift no longer draws as a
// zigzag or counts as distance — dwell anchors snap to the last real
// position instead of carrying the noisy coordinate.
// v128: heartbeat reads device status through the STATIC import.
// The old aliased dynamic import could resolve to a separate lazy
// chunk; when it failed to load in time every device field went null
// at once — on both platforms, which is why it looked native.
// v130: pending synced bank/Stripe transactions can finally be
// resolved in place — category picker + "Not business" on each pending
// row, so the action item can actually be cleared.
// v131: design-system alignment with Techottic. New semantic surface
// tokens drive the card / input / button / nav primitives, cards and
// buttons lost their hover lift, page headers dropped a size step, and
// the left rail moved to the tinted-accent active state. Markup and CSS
// both changed, so cached shells must not be reused.
// v132: the mileage tracker's watchdog can finally fire while the app
// is backgrounded. It used to return early unless the page was visible,
// which is precisely when there was nothing left to fix (the resume
// listeners had already re-armed). It now proves its own timer ran on
// schedule instead of using visibility as a proxy for that.
// v133: heartbeats are now appended to history rather than only
// overwriting the latest row, so a multi-hour blackout stops erasing
// its own evidence. The device-status bridge reads also report an
// outcome alongside their value, so a null field now says WHY it is
// null (no bridge / plugin missing / timed out / OS had nothing)
// instead of being indistinguishable from every other cause.
// v134: learned-place geofences restart tracking after the OS kills
// the app overnight, which is why the first drive of the day was being
// missed while every later drive recorded perfectly. The server
// clusters each driver's own history into home, work and habitual
// stops; the device registers those as geofences, and driving out of
// one restarts capture even though nothing of ours survived the night.
// The mileage page now also shows whether that net is armed, and says
// so plainly when an automatic restart ran and could not see location.
// v135: device truth (location permission, battery optimization,
// Background App Refresh) stops reporting NULL. The heartbeat used to
// read it live through the JS bridge every five minutes, which is to
// say almost always while the app was backgrounded, and the read timed
// out. Those values change when a person changes them, so the device
// now captures them whenever the app is genuinely foregrounded and
// every heartbeat sends the cached value plus its age, falling back to
// the cache only when the live read fails. The heartbeat also records
// how long each bridge read took, how late its own timer ran, and
// whether the app was foreground at the time, so the remaining question
// of why the live read hangs is answered by measurement rather than by
// argument.
// v136: a pending synced transaction on the banks page is readable again
// on a narrow screen. The resolve controls used to sit in the same flex
// row as the transaction text, and because only the text column was
// allowed to shrink it collapsed to zero width on a foldable cover
// screen, rendering the merchant and the note one character per line
// down a card several thousand pixels tall. The controls now sit on
// their own row beneath the transaction, so the text keeps the full
// width of the card at every size.
// v137: emoji that were standing in as icons are now outline SVGs. The
// header notification bell, the rows of the outstanding-items popup and
// its slim banner, the dashboard quick actions and plan locks, the
// mileage team, review, saved-places and needs-a-call markers, the sync
// freshness pill, the manager-note and mobile-only cards, the warning
// banners, and the four public calculators all drew a vendor emoji
// bitmap where an icon belonged. They share one set now
// (components/ui/Icons.tsx) on the same 24x24 currentColor frame the
// left rail already used, so every glyph takes the surrounding text
// colour on the light and dark surfaces alike. Markup changed on those
// pages, so the bump keeps v136 clients from hydrating new server HTML
// against cached chunks.
// v138: a drive the tracker only ASSUMED was business no longer counts
// as a deduction on its own. Auto-apply files a drive the moment it
// materialises, but when no saved place can decide it falls back to a
// blanket "business", and three of the four companies have no saved
// places at all, so every one of their drives was that guess. Those
// drives now store a zero deduction and carry a quiet "Assumed
// business, confirm" badge on /mileage with a one-tap Confirm that
// writes the real figure. They still appear automatically with no push,
// no bell entry and no popup. Markup changed on the trip list, so the
// bump keeps v137 clients from hydrating new server HTML against cached
// chunks.
// v142: chat is an inbox instead of a forced redirect into General.
// /chat listed nothing and redirected straight into the default
// channel, so the direct-message and group features that shipped in
// April were unreachable: production had zero DMs ever created. The
// page now lists conversations with New message and New group as its
// first two controls, General survives unchanged as one row among
// them, and an unread dot is backed by a new reads table. Markup
// changed across the chat surface, so cached shells must not be reused.
// v143: Fold cover screen fixes. The income year-to-date rows
// overflowed their grid column (a grid item defaults to min-width:auto
// and the rows use truncate, so min-content was the full untruncated
// string) and Edit/Remove were literally untappable. The main menu did
// not scroll: its height cap sat on a plain-block wrapper so the nav
// never became a scroll container, and the page behind moved instead.
// The profile menu measured its cap from the viewport top rather than
// its anchor, so Sign out sat below the fold with no way to scroll to
// it; Switch accounts and Sign out are now pinned outside the scroll
// region and the long segments collapse.
// v144: a waiting service worker is now adopted automatically on
// cold start, on resume, and whenever the page is hidden, instead of
// only on a tap of the "New version" toast. The geofence import fix sat
// live in production for hours while the affected phone kept running
// the broken bundle, because nobody knew there was a toast to tap. The
// toast still applies mid-session, when swapping the bundle under an
// open form would lose typed input.
// v146: frame-budget work. The header gold sweep panned
// background-position, which cannot be composited, on a header that
// renders on 95 authenticated pages: it alone accounted for roughly 20
// percent of idle main-thread paint (371ms to 0ms per 2.5s). Rewritten
// as a composited transform. Also stepped the gold-shine and reward-tile
// animations, and stopped the profile menu and bell re-measuring their
// anchor on every scroll event when the anchor sits in a fixed header.
// v147: nested-anchor hydration fix. Nineteen public page headers wrapped
// <Wordmark> (which renders its own link to home) in a second link, so the
// served HTML had an <a> inside an <a>. The parser closes the outer anchor
// early, the parsed DOM stops matching the tree React expects, and seven of
// the eight public pages threw minified React error #418 in production.
// The redundant wrappers are gone and the header markup changed on every one
// of those pages, so cached shells must not be reused.
// v148: legal pages rewritten to describe what the app actually
// does. The privacy policy said location is "never shared", which was
// untrue: coordinates go to Google for static maps and geocoding, and
// business drives go to the employer. It also stated no location
// retention window, and omitted document OCR, device telemetry, chat,
// encrypted TINs and the learned home/work places entirely. New
// /legal/location-monitoring page, and the tracking consent screen no
// longer claims location is never shared or that turning tracking off
// retains nothing. Footer attribution is now "Powered by Techno Optics
// LLC".
// v151: the service worker now takes over on install instead of
// waiting to be invited. A new worker only stopped waiting when the page
// posted SKIP_WAITING, and the auto-adopt that would post it without a
// tap ships in the bundle the OLD worker serves, so the fix could never
// install itself. Measured: both drivers sat on a v135-to-v141 bundle for
// four days while production served v148, so every capture fix in that
// window reached nobody.
// v153: payload cuts that are really memory cuts. The Supabase
// browser client came out of the root layout (a 19-line component whose
// own comment calls it inert on web was dragging auth, postgrest,
// realtime and websocket onto every route), /mileage/business went from
// 995 KB decoded to 652 KB with paging, and 40 public routes became
// static. Framed as speed when written, but ApplicationExitInfo on the
// owner's Fold5 shows the app being killed with reason=3 LOW_MEMORY at
// 142 MB and 256 MB RSS, so shrinking the process is what keeps the
// tracker alive.
// v154: iOS vehicle-presence signals reach the client. Car audio
// route is polled on each CoreLocation wake rather than observed, since
// an NSNotification only reaches a running process and surviving
// backgrounding would need an always-active audio session in an app that
// plays no audio. Events carry source event vs poll so a consumer can
// never read "we looked at 08:14" as "the car connected at 08:14".
// Also drains the seven-day CoreMotion history, which can prove a drive
// happened but never where it went, so a gap is reported and never
// filled.
// v155: "Re-run Bella" reported an opaque error. Every failure inside
// the categorize pass escaped the Server Action uncaught, so React
// redacted it in production and the user saw "An error occurred in the
// Server Components render ... A digest property is included" instead
// of the reason, with nothing in the logs either. The action now
// catches, logs the real cause, and redirects back with ?error=; the
// import review page renders that banner. Also fixes the output-token
// arithmetic: 150 rows per model call could not fit a 4000-token cap,
// so a large import could only come back truncated, and truncation was
// misreported as invalid JSON. 60 rows per call against 8000 tokens.
// v156: the app remembers whether the user last worked in the Personal
// or the Business workspace (profiles.workspace_mode) and /dashboard
// restores the business side instead of resetting the rail to Personal
// on every sign-in and app open. LeftRail gained the mode-sync effect
// and a 44px toggle, so the markup changed and stale clients need the
// new bundle.
// v157: bank import privacy. bank_imports and bank_transactions were
// readable by every company member, so an expenser could read the
// owner's imported bank statements (merchant, amount, date) and the
// notification bell surfaced them on every page. RLS is now
// own-rows-or-manager, and /c/[id]/banks plus the import routes gate on
// role before rendering. The markup of those pages changed for
// non-managers (banks now 404s, "Past imports" lists only your own), so
// cached shells must not be reused. The same release scopes the watch /
// home-screen-widget snapshot, which was reading bank rows through the
// service-role client; that needs no cache bump of its own because
// /api/ is never cached (see the fetch handler), but it ships here.
// v158: batch selection on the import review screen. Every expense
// candidate gained a checkbox, a select-all header and a bottom action
// bar, and the old "Apply manually selected" button was removed, so the
// markup and the server actions behind it both changed. A cached shell
// posting to an action that no longer exists is the failure this bump
// prevents.
// v159: two changes land together. First, dead-code removal:
// BellaFAB and StudioFamilyFAB (both zero call sites, both running a
// per-frame conic-gradient animation), their .bella-fab CSS chain, the
// unused .header-glow-line rules, and components/ui/Primitives.tsx are
// deleted. Nothing rendered changes, but globals.css does, so the bump
// stops v157 clients serving the old stylesheet. Second, the splash
// screens now show the brand mark on Android and iOS instead of a flat
// navy rectangle; those are native platform assets outside the SW's
// reach and need no cache bump of their own, but they ship in this same
// release. Also lands the mileage re-render plausibility gate (FMEA
// C6, server-only, no client markup change, no bump needed for it).
// v161: the landing page carries real photography now, six licensed
// photographs plus a new three-audience band, so the home markup grew
// by about 1,700px. A cached v160 shell would serve the old page with
// none of the images.
// v162: PWASetup no longer adopts a waiting worker while the page is
// hidden. Adopting reloads the page, and a reload in a backgrounded iOS
// WebView boots a fresh page life that calls the tracker's
// `await stopBgSafely(bg)` (which kills the live background service)
// and is then suspended by iOS before `bg.start()` re-arms it. That is
// how a phone loses a whole day of drives without anyone touching it.
// A worker installed while hidden now stays waiting until the app is
// next foregrounded. Every device must reach v162 to stop losing
// background tracking, which is precisely why this bump matters.
// v163: carries the REAL fix for the tracker-disarming reload (#525).
// v162 shipped only the adopt() gate, which this worker bypasses entirely
// by calling self.skipWaiting() in its own install handler below, so the
// unconditional reload on controllerchange kept tearing down backgrounded
// pages and leaving background location stopped. #525 defers that reload
// while the page is hidden.
//
// Read the irony before removing this comment: bumping this constant is
// what makes a device fetch the new worker, which self-skips, claims, and
// fires controllerchange. On a device still running the v162 bundle that
// reload is still unconditional, so THIS deploy is the last time the old
// bug can fire on any given phone. After it, the page defers instead.
// Taking that hit once is the only way to deliver the fix at all.
// v164: the worker no longer stores a signed-in user's HTML, and sign-out
// now drops every cache it owns.
//
// The navigation handler cached every OK response, ignoring the
// `private, no-store, must-revalidate` that lib/supabase/middleware.ts sets
// on every authenticated response precisely to prevent cross-tenant cache
// leaks. So a signed-in user's rendered pages sat in Cache Storage, survived
// sign-out untouched, and the offline fallback could serve them to whoever
// used the device next. It now honours that header, and UserMenu posts
// CLEAR_CACHES on sign-out to remove what earlier versions already wrote.
//
// This bump matters more than most: a device only gets the fix by fetching
// this file, and the stale pages it removes were written by the versions
// before it.
// v165: the heartbeat now says why it failed, on the phone.
//
// trackerDiag.hbLastResult has recorded every heartbeat outcome for a long
// time and NOTHING EVER RENDERED IT, so when both devices went 27+ hours
// with no heartbeat row while GPS upload kept working perfectly, there was
// no way to tell whether the POST was failing, throwing, or never being
// attempted. It is now persisted across reloads and shown on the mileage
// diagnostics screen.
// v166: the heartbeat gets its own timer.
//
// It rode the flush interval (`flushCount % 10`), but points have TWO
// upload triggers and the heartbeat had one: a location callback flushes
// directly when the buffer fills, so a page life where the flush INTERVAL
// was never installed uploaded GPS perfectly and never reported health
// once. A real device did exactly that for 27 hours, blinding every alarm
// that reads heartbeats. Now armed from the location callback too: if we
// are capturing, we are reporting.
const CACHE_VERSION = "v166";
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
  // Take over immediately instead of waiting to be invited.
  //
  // This line replaces a deliberate "do NOT self.skipWaiting() here", and
  // the reason it has to change is a deadlock that was measured on two real
  // devices, not a preference.
  //
  // The old design: a new worker installs, then waits. It only stops waiting
  // when the PAGE posts SKIP_WAITING, which the page only does when the user
  // taps a toast. An auto-adopt was later added to PWASetup so the page would
  // post it on cold start and resume without a tap. But PWASetup ships in the
  // BUNDLE, and the bundle is served by the currently active worker. So the
  // fix that stops a worker waiting can only run once that worker is already
  // active. It cannot install itself.
  //
  // Measured consequence: both drivers' devices sat on a bundle from the
  // v135 to v141 range for four days while production served v148. Their
  // heartbeats carried the v135 probe fields and null for every v141 geofence
  // field, which is how the stale range was pinned. Every capture fix shipped
  // in that window reached nobody, and the missing drives that prompted this
  // investigation were being diagnosed against code the phones were not
  // running.
  //
  // A waiting worker cannot be rescued from the page, but it can decide for
  // itself. skipWaiting() is evaluated in the NEW worker, so it needs no
  // cooperation from the old bundle. activate() already calls clients.claim(),
  // and both old and new PWASetup reload on controllerchange, so control
  // transfers cleanly.
  //
  // The cost is real and accepted: a bundle swap can now interrupt an open
  // form mid-session. For a background mileage tracker where a stale bundle
  // means silently lost tax records, that trade is the right way round. The
  // SKIP_WAITING message handler below is kept so older clients still work.
  self.skipWaiting();
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

/**
 * May this response be written to Cache Storage?
 *
 * Reads the header the SERVER already sends rather than inventing a second,
 * divergent idea of what is private. lib/supabase/middleware.ts sets
 * `private, no-store, must-revalidate` on every response served to an
 * authenticated user (see its "defence in depth against cross-tenant cache
 * leaks" comment), so honouring no-store and private is exactly equivalent
 * to "do not store a signed-in user's page", and stays correct if the set of
 * authenticated routes changes.
 */
function isStorable(res) {
  const cc = (res.headers.get("Cache-Control") || "").toLowerCase();
  return !cc.includes("no-store") && !cc.includes("private");
}

/**
 * Drop every cache this worker owns.
 *
 * Sign-out clears cookies, but cookies were never what leaked: the RUNTIME
 * cache held the previous user's rendered HTML, and nothing removed it. On a
 * shared or family device the next person could be served it from the
 * offline fallback path. isStorable above stops NEW authenticated pages
 * being written; this removes what is already there, including on devices
 * that cached pages under earlier versions of this worker.
 */
async function clearAllCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
}

self.addEventListener("message", (event) => {
  if (!event.data) return;
  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  // Posted by the sign-out path. waitUntil so the deletion is not cut short
  // when the page navigates away immediately afterwards, which is exactly
  // what sign-out does.
  if (event.data.type === "CLEAR_CACHES") {
    event.waitUntil(
      clearAllCaches().then(() => {
        // Tell the caller it is safe to continue. Sign-out does not block on
        // this (a cache purge must never be able to trap someone in a
        // session), but a caller that wants to wait can.
        if (event.source && "postMessage" in event.source) {
          try {
            event.source.postMessage({ type: "CACHES_CLEARED" });
          } catch {
            /* the page navigated away, which is the normal case */
          }
        }
      }),
    );
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
          // NEVER STORE A SIGNED-IN USER'S HTML.
          //
          // This used to cache every OK navigation. lib/supabase/middleware.ts
          // sets `private, no-store, must-revalidate` on every response served
          // to an authenticated user, explicitly as defence against
          // cross-tenant cache leaks, and this handler ignored it. So a
          // signed-in user's rendered page (dashboard, forecast, a client's
          // books) was written to the Cache Storage of a shared device and
          // outlived sign-out: nothing cleared it, and the offline fallback
          // below would happily serve it back to whoever used the device
          // next.
          //
          // Respecting the header the server already sends is the fix, rather
          // than the SW inventing its own idea of what is private. Public
          // marketing routes are unaffected and stay cacheable, which is what
          // the offline shell is actually for.
          if (res.ok && isStorable(res)) {
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          }
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

// --- Web Push (v96) ---------------------------------------------------
// Parity with the native apps' push: the server's Phase-3 send path will
// POST a Web Push message (via VAPID) to the subscription stored in
// device_tokens (platform:"web"). The payload shape is shared across all
// three platforms: { title, body, url?, data? }.
//
// Defensive parsing: a payload-less push (some providers send an empty
// "ping" to wake the SW) still shows a generic notification rather than
// throwing; a push handler that throws makes the browser show its own
// "This site has been updated in the background" fallback, which is worse.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Non-JSON body (plain text): use it as the body.
    try {
      payload = { body: event.data ? event.data.text() : "" };
    } catch {
      payload = {};
    }
  }

  const title = payload.title || "Taxottic";
  // Interactive categories get one-tap classify buttons: the user
  // answers Business / Personal straight from the banner; Review opens
  // the app on the item. Everything else stays a plain notification.
  const category =
    (payload.data && payload.data.category) || payload.category || "";
  const interactive =
    category === "TRIP_CLASSIFY" || category === "CLARIFY";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/icon-192.png",
    // Coalesce updates about the same thing (e.g. a quarterly reminder)
    // instead of stacking duplicates.
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
    ...(interactive
      ? {
          actions: [
            { action: "business", title: "Business" },
            { action: "personal", title: "Personal" },
            { action: "review", title: "Review" },
          ],
        }
      : {}),
    // Carried through to notificationclick so the tap can route + attribute.
    data: {
      url: payload.url || "/",
      actionId: payload.actionId || "",
      ...(payload.data || {}),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = new URL(data.url || "/", self.location.origin).href;
  const tapped = event.action || "";

  // One-tap classify: Business / Personal resolve ENTIRELY in the
  // background — no app launch. The endpoint re-validates the session
  // and row ownership server-side (a notification tap is untrusted);
  // a silent confirmation banner replaces the prompt on success.
  if (tapped === "business" || tapped === "personal") {
    event.waitUntil(
      (async () => {
        let ok = false;
        try {
          const res = await fetch("/api/push/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ actionId: tapped, data }),
          });
          ok = res.ok;
        } catch {
          /* offline or logged out */
        }
        await self.registration.showNotification(
          ok
            ? `Marked ${tapped === "business" ? "business" : "personal"} ✓`
            : "Couldn't save — tap to review",
          {
            body: ok ? "" : "Open the app to classify this drive.",
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            tag: event.notification.tag || "classify-result",
            data: { url: targetUrl },
            ...(ok ? {} : {}),
          },
        );
        if (ok) {
          // Auto-dismiss the confirmation after a few seconds where
          // supported; harmless where not.
          setTimeout(async () => {
            const shown = await self.registration.getNotifications({
              tag: event.notification.tag || "classify-result",
            });
            for (const n of shown) n.close();
          }, 4000);
        }
      })(),
    );
    return;
  }

  // "Review" (or a plain tap) falls through to the app-open path below.
  event.waitUntil(
    (async () => {
      // Best-effort server attribution, mirrors the native
      // pushNotificationActionPerformed → /api/push/action call. Fire and
      // forget; navigation must not wait on it.
      if (data.actionId || (data.data && Object.keys(data.data).length)) {
        try {
          await fetch("/api/push/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              actionId: data.actionId || "",
              data: data.data || {},
            }),
          });
        } catch {
          /* offline / logged out; the navigation below still happens */
        }
      }

      // Focus an already-open Taxottic tab if one exists, else open a new
      // one. Match on origin so any of our tabs can be reused.
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              /* cross-origin nav guard; focus alone is enough */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
