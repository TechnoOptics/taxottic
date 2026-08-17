# Performance baseline

> ## STATUS 2026-08-17: SUPERSEDED IN PART, SEE THE RUNTIME PASS BELOW
>
> A second pass on 2026-08-17 measured server render cost directly against
> the live database and found that two of the four claims below do not
> survive measurement:
>
> - Claim 2 ("`/mileage/business` bounded") shipped a bound that barely
>   bites. The page still ships **12,168 lat/lng values / 776 KB** of
>   polyline, against the 12,186 / 929 KB it was supposed to fix.
> - Claim 4 is correct about `/dashboard` writes and about the two false
>   N+1 sightings, but `/dashboard` still had a serial pair of counts.
>
> It also found the render stall that the earlier freshness work did not
> address: `/mileage` was paging **6,745 rows over 7 sequential HTTP
> round trips** on every single load. See
> [Runtime pass, 2026-08-17](#runtime-pass-2026-08-17).
>
> ## STATUS 2026-08-16: ALL FOUR RECOMMENDATIONS HAVE SHIPPED
>
> This document still reads as a to-do list, and it is not one. Verified
> against `main` on 2026-08-16:
>
> | # | Recommendation | State |
> | --- | --- | --- |
> | 1 | Lazy-load the Supabase browser client | **Shipped.** `components/CapacitorAuth.tsx` does the dynamic `import()` inside the effect, behind the `isNativeApp()` guard, with the 261 KB -> 200 KB measurement recorded in its own comment. |
> | 2 | Bound `/mileage/business` | **Shipped**, and deliberately as a VISIBLE bound rather than a silent truncation. It also fixed a pre-existing quiet truncation where `.limit(1000)` capped the totals sweep. |
> | 3 | Move `headers()` out of the root layout | **Shipped.** `app/layout.tsx` carries an explicit "Do not reintroduce headers(), cookies() or any other dynamic API here" guard comment. |
> | 4 | Blocking writes + N+1 off `/dashboard` | **Shipped.** The recycle-bin sweep moved to `app/api/cron/recycle-bin-purge`; the remaining `.update()` runs only on the stale-`active_platform` branch, not per render; and the loops that look like N+1 are a `Promise.all` and an `.in(companyIds)` batch, which is the opposite.
>
> Below, "Probe reverted. No source change is committed with this
> document." was true when written and is no longer. The probe was
> subsequently committed.
>
> **Any new performance work needs a fresh measurement.** These numbers
> are from `b6faa71` (1.3.6) on 2026-08-01; main is now 1.3.11 with a
> fortnight of changes on top. Acting on them as if they were current is
> the same mistake this document was written to prevent.


## Runtime pass, 2026-08-17

Measured against `origin/main` at `b49c4ff`, in an isolated worktree, on a
production build (`next build`, exit 0 before and after). Scope: server
render cost and post-load responsiveness. Cold start, the WebView load
path, fonts and the service worker were another pass's subject and are
untouched here.

### How these numbers were obtained

Each page's data-fetch sequence was reproduced query-for-query in a
throwaway Vitest harness and timed with `performance.now()`, running
against the **live production database** with the service-role client and
the owner's real user id. Three runs each; the spread is quoted, not an
average. The harness was strictly read-only: `finalizeUserTrips` was never
invoked against production, only its read half (the paged staging-pool
fetch) was replicated, so no row was written, and no migration was run.

Two caveats on reading the absolute milliseconds:

- They include this workstation's round-trip to Supabase, which is longer
  than Vercel's. **The round-trip COUNT is the latency-independent fact**,
  and that is what the fixes change: 7 sequential HTTP pages became 1, and
  6 sequential reads became 1 parallel batch.
- They are one account's data. That account is the owner's, which is the
  account the "slow and unresponsive" report came from.

### `/mileage`, the confirmed culprit

The 2.5 s `Promise.race` budget was replaced by `settleWithinBudget` in
earlier work, which fixed the stale-list symptom. **The stall itself was
never addressed**: the page still awaited finalize for up to 2.5 s.

Root cause of why that budget was actually being spent, which had not been
diagnosed before: `finalizeUserTrips` begins by paging its whole
unconsumed staging pool out of PostgREST, 1000 rows per HTTP round trip,
and the page handed it a **7-day** window. Raw points are only marked
consumed inside a formed trip's time range, so points that never become a
trip (parked, sub-threshold, GPS noise) are **never consumed and never
shrink the pool**. Live figures at time of measurement:

| Pool | Rows |
| --- | --- |
| Unconsumed, all time | 21,270 |
| Unconsumed, 7-day window (what the render fetched) | 6,745 |
| Unconsumed, 6-hour window | 27 |

So every single load re-read a week of residue that the cron and the
ingest path had already rejected dozens of times, and created nothing.

| Measurement | Before | After |
| --- | --- | --- |
| Staging-pool fetch | **1,055 / 1,147 / 1,545 ms**, 7 HTTP pages, 6,745 rows | **77 / 89 / 118 ms**, 1 HTTP page, 27 rows |
| Six independent reads (trips, places, last point, last trip, self health, team health) | **586 / 817 / 838 ms** serial | **201 / 306 / 371 ms** in one `Promise.all` |

Net: roughly **1.3-1.8 s off every `/mileage` render**.

The fix is a window, not a skipped guard. `finalize` still runs on the
render path, with the same `forceClose: false` contract and every
integrity check intact. What changed is how far back it looks, and that is
safe because the render path is the *third* line of defence:

- `/api/mileage/ingest` finalizes a **24-hour** window on every device
  upload;
- the `mileage-finalize` cron finalizes a **45-day** window every **10
  minutes**.

`RENDER_FRESHNESS_WINDOW_MS` is 6 hours, which is 36 cron ticks of slack.
The ordering invariant (render < ingest < cron) is pinned by
`lib/mileage/finalize-freshness.test.ts` against the real windows parsed
out of those two routes, so widening it back, or narrowing either backstop
under it, fails the suite.

### `/dashboard`

The previous pass's claims were re-checked rather than trusted, and its
two "false positive" warnings were correct: the `Promise.all` and the
`.in(companyIds)` batch are genuinely parallel, and `computeReadiness`
fans out inside a `Promise.all` (1 company on this account, so no fan-out
at all in practice). The blocking recycle-bin sweep is indeed gone.

One real serial pair remained, and was fixed:

| Measurement | Before | After |
| --- | --- | --- |
| The two `monthly_expenses` counts | **305 / 311 ms** serial | **178 / 225 ms** in one `Promise.all` |

`runTrialGuard` was measured and **deliberately left alone**: on the
steady-state path it is a single `profiles` read that early-returns on
`trial_validated_at` (measured 128-239 ms). It could in principle be
merged with the `active_platform` read a few lines above it, but that read
gates a `redirect()`, and hoisting a guard that can WRITE above a redirect
changes behaviour for a ~150 ms gain. Not worth it.

### `/mileage/business`, an open judgement call, NOT changed

The "visible bound" recorded as shipped above does not actually reduce the
payload much, because `PAGE_SIZE = 100` covers 100 of this account's 101
year-to-date business drives.

| Measurement | Value |
| --- | --- |
| Polyline fetch | **1,158 / 1,193 ms**, 7 sequential HTTP pages |
| Rows returned | 6,084 |
| Serialized payload | **776 KB** |
| lat/lng values shipped to the client | **12,168** (the figure this was meant to fix was 12,186) |

This is left unchanged on purpose: every way to fix it is a **user-visible
UX trade**, and that is a product decision, not a performance one. The
options, with the lever each pulls:

1. **Lower `OVERVIEW_POLY_POINTS` from 60 to ~20.** Roughly a 3x payload
   cut. Route thumbnails on the overview get visibly coarser; the
   single-trip view is unaffected since it uses its own
   `SINGLE_TRIP_POLY_POINTS = 250`.
2. **Lower `PAGE_SIZE` from 100 to 25.** Roughly a 4x cut and turns the
   7-page polyline fetch into ~2. Costs more pagination clicks for anyone
   reviewing a full year.
3. **Drop overview polylines entirely and render each row's thumbnail
   lazily on scroll.** Largest win, biggest change, and it moves cost from
   server render to client interaction rather than removing it.
4. **Leave it.** It is ~1.2 s on a page people open far less often than
   `/mileage`.

A number is needed for how often `/mileage/business` is opened before
choosing; nobody should pick from this list on taste alone.

### What could not be verified in this pass

- **No end-to-end authenticated page timing.** Timing a real `/mileage`
  request against `next start` needs a signed-in session as the owner.
  Creating one means handling their credentials, so it was not done. The
  numbers above are the server data-fetch cost, which is where essentially
  all of the wall clock goes on these routes (the JSX render is
  microseconds against 1.4 s of I/O), but they are not a measured TTFB.
- **Only one account's data.** 6,745 rows of residue is this owner's pool.
  A driver with a smaller pool was already fast, and a heavier one was
  slower still; the shape of the fix does not depend on the size.
- **Why the residue exists at all** is out of scope here and was not
  changed. Marking never-consumed raw points as consumed would shrink the
  pool permanently, but that is a mileage-pipeline correctness decision
  with re-render implications, not a rendering optimisation, and it is not
  this pass's call to make.

---

Measured 2026-08-01 against `origin/main` at `b6faa71` (release 1.3.6), in an
isolated worktree. Nothing in this pass was optimised. The only code edits made
were two temporary build probes, both reverted; they are labelled below.

This document exists because this project has repeatedly lost time to confident
hypotheses that turned out wrong. Every number here says how it was obtained.
Claims that are mechanism-level rather than measured are labelled as such, and
there is an explicit list of what could not be measured.

## Contents

- [How things were measured](#how-things-were-measured)
- [What could not be measured](#what-could-not-be-measured)
- [1. Bundle and payload](#1-bundle-and-payload)
- [2. Server timing](#2-server-timing)
- [3. Database](#3-database)
- [4. Runtime rendering](#4-runtime-rendering)
- [5. Frame rate](#5-frame-rate)
- [6. Perceived speed](#6-perceived-speed)
- [Ranked opportunities](#ranked-opportunities)
- [Not worth doing](#not-worth-doing)
- [The honest answer on 120fps](#the-honest-answer-on-120fps)
- [Found while measuring, not a performance item](#found-while-measuring-not-a-performance-item)

## How things were measured

| Source | What it gave |
| --- | --- |
| `npm run build` in the worktree | route table, compile times, static vs dynamic split |
| `.next/static/chunks` inspected with `gzip -c9` and string fingerprinting | per-chunk raw and gzip sizes, chunk identity |
| `next start -p 3111` plus scripted `curl` and `fetch` | which chunks each route actually requests, real payloads |
| Two temporary build probes (reverted) | proved two causal claims instead of asserting them |
| `curl -w` against `https://taxottic.com`, 9 samples per path | anonymous production TTFB |
| Chrome MCP against production in the user's live session | authenticated page TTFB, payload, DOM shape, relayout cost |
| In-app Browser pane against `localhost:3111` | cold-load long tasks on a build we control |
| Supabase MCP, read only: `pg_stat_statements`, `pg_stat_user_tables`, `get_advisors` | real query cost, real table sizes, advisor findings |
| Source reading | query shapes, animation properties, splash handover, service worker strategy |

Environment caveat that applies to every timing number: the client is an
M-series Mac on a wired connection in the same region as the Vercel edge.
A phone on LTE is slower on network and roughly 4x to 6x slower on
single-threaded CPU. Numbers below are therefore a floor, not a user experience.

Note on the build output: Next 16 with Turbopack no longer prints a "First Load
JS" column in the route table. Bundle numbers here were reconstructed from
`.next/static` plus the script tags each route actually emits.

## What could not be measured

State these plainly rather than guessing around them.

- **Native cold launch time on a real device.** Not measured. Would need a
  device build plus Chrome remote debugging or Safari Web Inspector.
- **Actual frame rate and dropped frames during scroll.** Not measured. Both
  browser contexts available in this environment reported
  `document.visibilityState === "hidden"`, which suppresses paint timing entries
  and throttles `requestAnimationFrame`. FCP, LCP and frame intervals collected
  in that state were garbage (one sample reported FCP at 37 seconds) and have
  been discarded rather than reported.
- **Hydration cost on authenticated pages specifically.** The 129 ms long task
  below is the shared shell on a near-empty page. The equivalent figure for the
  expenses page was not captured.
- **React re-render counts.** No profiler build was available.
- **Real mobile network conditions.**

## 1. Bundle and payload

### Build

`next build` (Turbopack, Next 16.2.4): compiled in 13.6 s, TypeScript in 14.3 s,
exit 0. 218 route entries.

**3 routes are statically prerendered. All three are icon routes**
(`/icon.png`, `/apple-icon.png`, `/opengraph-image`). Every real page, including
`/pricing`, `/guides/*`, `/legal/*`, `/compare/*` and `/calculators`, is
server-rendered on demand.

### Shared JS, present on every route

Measured by fetching `/login` and `/pricing` from the local production server and
intersecting their script tags.

| Chunk | Raw | Gzip | Identity |
| --- | ---: | ---: | --- |
| `0_9a-o91gyc4f.js` | 227 KB | 70.9 KB | react-dom (`createRoot`) |
| `0k0m3x_pyl53o.js` | 237 KB | 61.7 KB | `@supabase/supabase-js` (GoTrue, RealtimeClient, phoenix, WebSocket) |
| `09--zvwnf4z2b.js` | 150 KB | 40.3 KB | Next app-router client runtime |
| `03~yq9q893hmn.js` | 113 KB | 39.4 KB | core-js polyfills, tagged `noModule` |
| 8 others | 224 KB | 49.9 KB | app shell, layout client components |
| **Total, 12 chunks** | **951 KB** | **262 KB** | |

The polyfill chunk carries a `noModule` attribute. Verified in a real browser on
`/` that it is **not** fetched (`polyfillFetched: false`). Effective shared JS on
the path a modern WebView actually takes:

**223 KB gzip, roughly 770 KB decoded, on every single route.**

Confirmed independently in-browser on the marketing home page: 15 JS files,
236 KB encoded, 823 KB decoded.

Other shell assets: one stylesheet, 22.5 KB gzip. Seven self-hosted woff2 files,
144 KB total, `display: swap`.

### Probe 1 (reverted): what pulls Supabase into every route

`components/CapacitorAuth.tsx` is 19 lines, is mounted in the root layout, and
its own comment says it "is an inert no-op" on web. It statically imports
`@/lib/supabase/client` and calls `createClient()` eagerly in a `useEffect`.
That drags the entire Supabase browser client, including the realtime transport,
into the shared bundle on every route including anonymous marketing pages.

Probe: changed that one static import to a dynamic `import()` inside the effect,
rebuilt, and re-measured the shared chunk set.

| | Shared chunks | Gzip | Modern-path gzip (excl. polyfill) |
| --- | ---: | ---: | ---: |
| Before | 12 | 262 KB | 223 KB |
| After | 11 | 201 KB | 162 KB |

**61 KB gzip and 236 KB decoded come off every route.** The Supabase chunk is
absent from `/pricing` after the change. Only 7 files in the codebase import the
browser client at all, and realtime is used by exactly 3 components
(`components/firm/ActivityList.tsx`, `components/chat/ConversationView.tsx`,
`components/client/FromYourFirmRealtime.tsx`).

Probe reverted. No source change is committed with this document.

### HTML payload per route

Authenticated pages, fetched from the live session. "Decoded" is what the phone
must parse; "wire" is the brotli-compressed transfer, obtained from Resource
Timing on a request crafted to bypass the service worker.

| Route | Decoded HTML | Wire (br) | DOM nodes |
| --- | ---: | ---: | ---: |
| `/mileage/business` | **929 KB** | **156 KB** | 2,634 |
| `/c/[publicId]/expenses` | 702 KB | 39 KB | 4,472 |
| `/c/[publicId]/deductions` | 437 KB | not sampled | not sampled |
| `/c/[publicId]/forecast` | 402 KB | 34 KB | 1,964 |
| `/dashboard` | 381 KB | 21 KB | 3,073 |
| `/c/[publicId]/banks` | 280 KB | 23 KB | 1,480 |
| `/c/[publicId]/income` | 105 KB | 14 KB | not sampled |
| `/mileage` | 82 KB | 18 KB | 683 |
| `/settings` | 62 KB | 13 KB | 265 |
| `/mileage/classify` | 27 KB | not sampled | not sampled |

Between 92% and 99% of each response is the inlined RSC flight payload
(`self.__next_f.push`). On `/dashboard`, 373 KB of the 381 KB.

**Brotli does most of the work.** 702 KB of expenses HTML is 39 KB on the wire.
Payload size is therefore a CPU cost, not a bandwidth cost, with one exception:
`/mileage/business` at 156 KB brotli is the largest single response in the app.

### Third-party payload

Google Maps JS API, loaded on the mileage pages:

- `/mileage`: 26 requests, 189 KB transferred, **1.49 MB decoded**.
- `/mileage/business`: 60 requests, **1.62 MB decoded**.

The loader script alone (`maps/api/js`) is 689 KB decoded, then pulls
`util.js` 309 KB, `common.js` 127 KB, `map.js` 81 KB, `marker.js` 66 KB,
`poly.js` 54 KB and more.

## 2. Server timing

### Anonymous, production, 9 samples per path, median TTFB

| Path | min | median | p90 |
| --- | ---: | ---: | ---: |
| `/icon.svg` (CDN static asset) | 122 ms | **150 ms** | 197 ms |
| `/robots.txt` (route handler, excluded from middleware) | 170 ms | 233 ms | 264 ms |
| `/pricing` | 196 ms | 268 ms | 327 ms |
| `/legal/privacy` | 215 ms | 285 ms | 421 ms |

150 ms is this machine's network floor to the edge. A purely static legal page
costs roughly 135 ms above that floor because it is dynamically rendered and
passes through the auth middleware on every hit.

Every dynamic page returns `cache-control: private, no-cache, no-store,
max-age=0, must-revalidate` with `x-vercel-cache: MISS`. **Nothing is cached at
the CDN.** That includes every SEO page.

### Authenticated, production, median of 3 fetches

`/mileage` 154 ms, `/settings` 170 ms, `/dashboard` 172 ms, `/reminders` 174 ms,
`/mileage/classify` 181 ms, `/firm/mileage` 193 ms, `/c/…/forecast` 194 ms,
`/goals` 197 ms, `/c/…/expenses` 237 ms, `/c/…/banks` 244 ms, `/c/…/income`
269 ms, `/mileage/business` 251 ms to 650 ms.

**Server response time is not the headline problem for this account.** The
spread across pages is roughly 100 ms, and the floor is set by network plus
middleware, not by page data. This contradicts the natural hypothesis that
server time dominates, and it is the main reason to read the rest of this
document before optimising anything.

### Probe 2 (reverted): why every route is dynamic

`app/layout.tsx` calls `headers()` inside `generateMetadata`, at line 62, to read
the host so admin subdomains get `noindex`. Using `headers()` in the root layout
opts every route that inherits it out of static generation.

Probe: replaced that one call with a constant, rebuilt, and counted the route
table.

| | Static routes | Dynamic routes |
| --- | ---: | ---: |
| Before | 3 (icons only) | 215 |
| After | **40** | 174 |

The 37 pages that become static are exactly the ones that should be: all eleven
`/guides/*`, all nine `/legal/*`, both `/compare/*`, `/pricing`, `/pricing/firms`,
`/calculators`, `/firms`, `/help`, `/changelog`, `/enterprise-welcome`,
`/account/suspended`, `/mileage/setup` and `/login`.

Probe reverted.

### Query shape per page (source reading, not timing)

- **`/dashboard`**: 25 `.from()` calls and 2 `.rpc()` calls across 7 `Promise.all`
  groups, but around 11 sequential `await` points overall.
  `lib/dashboard/readiness.ts` `computeReadiness` runs once per company
  (`app/dashboard/page.tsx:391`) and itself does up to 4 sequential round trips.
  Two blocking **writes** sit on the render path:
  `runTrialGuard` (`:631`) and `purgeExpiredRecycleBin` (`:641`).
- **`/mileage`**: 14 `await` points, **0 `Promise.all`**. Fully serial.
- **`/mileage/business`**: trips capped at 1000, then polylines fetched via
  `mileage_trip_polylines` in a serial loop of up to 60 pages, at up to 250
  points per trip. On the real account measured, the resulting HTML contained
  **12,186 lat/lng values**. At the coded cap that is 250,000, roughly 20x more.
- **`/c/[publicId]/banks`**: 500 transactions in one query, as documented in the
  source comment at `:163`.

## 3. Database

This section is the strongest correction to intuition in the whole document.

### Actual table sizes

Only three tables in the entire database exceed 300 live rows:

| Table | Live rows | Size | seq scans | idx scans |
| --- | ---: | ---: | ---: | ---: |
| `mileage_points` | 63,046 | 14 MB | 635 | 270,815 |
| `mileage_points_raw` | 62,463 | 26 MB | **197,592** | 247,469 |
| `auth.refresh_tokens` | 574 | 656 kB | 99,503 | 12,280 |

Every other table, including `account_transactions`, `monthly_expenses`,
`mileage_trips`, `companies` and `profiles`, is under 300 rows.

### Real query cost, from `pg_stat_statements`

| Statement | Calls | Mean | Total |
| --- | ---: | ---: | ---: |
| `mileage_broken_trips(p_since, p_lim)` RPC | 2,387 | **404 ms** | **964 s** |
| `SELECT name FROM pg_timezone_names` | 312 | 232 ms | 72 s |
| `mileage_points` with lateral trip join | 605 | 27.8 ms | 17 s |
| everything else | | < 30 ms | < 10 s |

`mileage_broken_trips` is the self-healing reconcile function. Its body runs a
correlated `count(distinct r.captured_at)` over `mileage_points_raw` per trip,
which is what drives the 197,592 sequential scans on a 26 MB table. It is called
by the `*/10 * * * *` `mileage-finalize` cron. **It is server cost, not user
cost.** No user is waiting on it.

`pg_timezone_names` is Supabase tooling, not the app.

**No user-facing page query appears above 30 ms mean.**

### Advisors

`get_advisors(performance)` returns 350 findings: 110
`multiple_permissive_policies`, 105 `auth_rls_initplan` (policies calling
`auth.uid()` per row instead of `(select auth.uid())`), 75
`unindexed_foreign_keys`, 59 `unused_index`.

These are real and worth fixing eventually. At current row counts they cannot be
costing measurable time, and `pg_stat_statements` confirms it: nothing they
apply to shows up as slow. Treat them as scale hygiene with a trigger condition
(revisit when any of these tables passes roughly 100k rows), not as today's work.

The 59 unused indexes are a small write-amplification cost on the mileage ingest
path, which is the one write path with real volume.

## 4. Runtime rendering

### JS boot cost

Cold load of `/login` against the local production server, no network latency,
M-series Mac:

- **One 129 ms long task**, starting at 24 ms.
- `domInteractive` 18 ms, `domComplete` 213 ms.
- The page has **132 DOM nodes**.

The page is essentially empty, so that 129 ms is the shared bundle evaluating
plus the shell hydrating. It is paid on every full page load, which on the
native apps means every cold launch and every hard reload. Warm loads with the
JS in the HTTP cache showed no long task at all, which is consistent.

Scaled by the usual 4x to 6x factor for a mid-range Android phone, that single
task is roughly 500 ms to 800 ms of blocked main thread. **Unverified on device.**

### Layout cost

Forced full-document relayout after a style invalidation, median of 15
iterations, production pages in Chrome on an M-series Mac:

| Page | DOM nodes | Median relayout | Worst |
| --- | ---: | ---: | ---: |
| `/c/[publicId]/expenses` | 4,472 | not sampled | **10.3 ms** |
| `/dashboard` | 3,073 | **7.4 ms** | 13.2 ms |
| `/mileage/business` | 2,634 | 6.2 ms | 10.1 ms |
| `/c/[publicId]/forecast` | 1,964 | 3.0 ms | 5.5 ms |
| `/mileage` | 683 | 2.1 ms | 6.6 ms |

The 60 fps frame budget is 16.7 ms. The 120 fps budget is 8.3 ms. On a desktop
machine, the dashboard already spends 7.4 ms of a 8.3 ms budget on layout alone
if something invalidates it. See the frame rate section.

### Un-virtualised lists

`/c/[publicId]/expenses` renders, in one pass with no windowing:

- **665** `input` / `select` / `textarea` elements
- **375** `button` elements
- **286** inline `svg` elements

`/mileage/business` has a scroll height of 8,490 px with 274 `img` thumbnails
(correctly `loading="lazy"`, see `components/maps/TripThumbnail.tsx`) and 143
canvas elements belonging to the single Google vector map that is rendering the
whole trip set at once.

### What is not a runtime problem

HTML parsing. `DOMParser` on the 702 KB expenses response takes **5.0 ms**; on
the 929 KB `/mileage/business` response, **3.4 ms**. Parsing is not where the
time goes.

`components/HeaderScrollHider.tsx` looks like scroll thrash but is not: it is
`requestAnimationFrame`-throttled with hysteresis, so it toggles the body class
twice per scroll session, not per frame.

## 5. Frame rate

### iOS

`ios/App/App/Info.plist` **does not contain `CADisableMinimumFrameDurationOnPhone`**
(verified by grep; the full key list was dumped and it is absent).

Without that key, iOS caps the app, and therefore its WKWebView content, at
60 Hz on ProMotion iPhones. **120 fps is currently impossible on iOS, and no
amount of web-side work changes that.** Adding the key raises the ceiling; it
does not by itself produce 120 fps, and it increases power draw.

### Android

There is no app-side switch. Chromium's WebView composites at whatever refresh
rate the window is currently running at, and on adaptive-refresh Android panels
the OS decides that based on what is on screen and the device's power state.
The app can influence it only by presenting content the compositor recognises as
continuously animating.

### What the app actually asks the compositor to do

These are in `app/globals.css` and run on every authenticated screen:

| Selector | Animation | Property animated | Compositor-friendly |
| --- | --- | --- | --- |
| `.app-header::after` | `co-header-shimmer` 14 s infinite | `background-position` | No, repaints |
| `.app-header` | none, but always-on `backdrop-filter: blur(14px) saturate(140%)` | filter over live content | No, GPU filter re-run |
| `.app-header` on `body.app-scrolled` | blur raised to 18px | filter | No |
| `.bella-fab` | `bella-spin` 6 s linear infinite | conic gradient ring | No |
| `.reward-tile-inner.is-earned` | `reward-drift` 16 s infinite | `background-position` across 4 layers, one an `feTurbulence` SVG noise texture, with `background-blend-mode: overlay` | No, expensive |
| `.co-gold-pan` text | `co-gold-pan` 8 s infinite | `background-position` on clipped gradient text | No |
| `app/loading.tsx` | `taxottic-pulse` 1.7 s infinite | `transform` and `opacity` **and `filter: drop-shadow`** | Partly, the drop-shadow repaints |
| `slideUpFromCorner`, `fadeIn` | | `transform`, `opacity` | Yes |

The header is `position: sticky` with an always-on `backdrop-filter`, so every
scroll frame requires re-blurring the content passing underneath it, in addition
to repainting the shimmer sweep.

This is mechanism, from source. **The per-frame cost was not measured on a
device.** But the codebase already contains a first-hand account of exactly this
class of bug: the comment in `app/loading.tsx` documents a Galaxy Z Fold5
rendering the whole loading screen solid black because of a full-screen
`filter: blur()`, confirmed with logcat as continuous WebView `onDraw` calls.
The same GPU path is still in use on the header of every page.

## 6. Perceived speed

### Splash handover

`capacitor.config.ts` sets `launchShowDuration: 1500`. There is **no
`SplashScreen.hide()` call anywhere in the web code** (grepped across `app`,
`components`, `lib`).

So the splash disappears on a fixed 1500 ms timer regardless of whether the
WebView has painted. If the remote page is slower than 1500 ms, the user sees the
flat `#121a2a` background between splash and content. If it is faster, they wait
out the timer on a splash for no reason. Neither is measured on device; both
follow directly from the config.

### Cold launch is a full network page load

`server.url` is `https://taxottic.com`. Every cold launch pays DNS, TLS,
middleware auth, SSR, then 223 KB gzip of JS, then the 129 ms-class boot task.

### Service worker

`public/sw.js` (CACHE_VERSION v143), fetch handler at line 885:

- `/_next/*` is deliberately skipped, with a good documented reason (caching
  hashed chunks across deploys caused React #418 hydration mismatches).
- Fonts and images: cache-first.
- **HTML and RSC: network-first**, with cache used only when the network throws.

Consequence: no navigation can paint before the network answers. There is no
stale-while-revalidate path, so the SW currently buys offline resilience but
zero perceived speed.

### Loading states

`app/loading.tsx` exists at the root, so client-side navigations do get a
branded loading screen rather than a frozen one. That part is fine.

However: **1 `loading.tsx` and 0 `<Suspense>` boundaries across 142 pages.** A
page streams nothing until every one of its queries has resolved. On
`/dashboard`, that means the user waits for the trial guard write, the recycle
bin sweep, and the per-company readiness fan-out before a single byte of the
page appears.

## Ranked opportunities

Ranked by user-visible win divided by risk and effort, not by how interesting
the fix is.

### 1. Lazy-load the Supabase browser client out of the root layout

- **Evidence**: Probe 1. Shared bundle 262 KB gzip to 201 KB gzip; on the modern
  path 223 KB to 162 KB. `components/CapacitorAuth.tsx:4`.
- **Win**: 61 KB gzip and 236 KB decoded off every route, including anonymous
  marketing pages. Directly reduces the 129 ms boot task, which is the largest
  single blocking item on cold launch.
- **Risk**: Low. The probe built clean. Needs a native smoke test that the
  `appUrlOpen` OAuth listener still installs, since that is the component's only
  real job.
- **Effort**: About an hour plus a device check.

### 2. Bound the `/mileage/business` payload

- **Evidence**: 929 KB decoded, 156 KB brotli, 12,186 lat/lng values in one
  response, with a coded cap of 1000 trips x 250 points (250,000 points) and a
  serial polyline loop of up to 60 RPC pages. `app/mileage/business/page.tsx:120`
  and `:130`.
- **Win**: The single largest response in the app, on a page that is already the
  slowest to respond (up to 650 ms). Heavy-driving accounts will be far worse
  than the account measured.
- **Risk**: Low technically, but constrained by the mileage integrity rule: never
  hide or invent miles. Pagination or map clustering must come with an explicit
  "showing N of M trips" affordance, and the totals must stay computed over the
  full set.
- **Effort**: Half a day.

### 3. Make the always-on animations compositor-friendly

- **Evidence**: The table in section 5. `background-position` and
  `backdrop-filter` animations running infinitely on every authenticated screen,
  plus the project's own documented Fold5 GPU-filter incident.
- **Win**: This is the main lever on the owner's actual goal, which is
  smoothness rather than raw speed. Also a battery win, since these animations
  never let the compositor idle.
- **Risk**: Medium, and it is design risk rather than technical risk. The
  shimmer and the frosted header are deliberate brand choices. The fix is to
  keep the look and change the mechanism (pre-rendered gradient moved with
  `transform: translateX`, a static translucent header instead of a live
  `backdrop-filter`, `will-change` scoped to the animating element).
- **Effort**: Half a day, plus a device profile to confirm. Do the device
  measurement first so the win is quantified rather than assumed.

### 4. Static-render the public pages

- **Evidence**: Probe 2. Removing one `headers()` call in `app/layout.tsx:62`
  turns 3 static routes into 40. All public pages currently return `no-store`
  with `x-vercel-cache: MISS` and cost roughly 135 ms above the CDN floor.
- **Win**: 37 pages move from server-rendered on every hit to CDN-served. Helps
  signed-out first impressions, crawler budget, and `/login`, which is the first
  screen of a cold launch for any signed-out user.
- **Risk**: Medium-low. The `headers()` call exists to force `noindex` on
  `hq.` and `enterprise.` hosts, which matters. The fix is to move host-aware
  metadata into the admin route segments or a route group rather than delete it,
  and to verify the admin hosts still emit `noindex` afterwards.
- **Effort**: Half a day including verification.

### 5. Take the writes and the N+1 off the `/dashboard` render path

- **Evidence**: `app/dashboard/page.tsx:631` (`runTrialGuard`), `:641`
  (`purgeExpiredRecycleBin`), `:391` (`computeReadiness` per company, itself up
  to 4 sequential queries). Around 11 sequential await points overall.
- **Win**: Shortens the critical path of the most-visited authenticated page.
  Combined with a `<Suspense>` boundary this is also what would let the page
  stream its shell before the data lands.
- **Risk**: Low-medium. Both writes exist for real reasons (trial fraud,
  recycle-bin accuracy). Move them to a cron or a fire-and-forget post-render
  action; do not delete them.
- **Effort**: Half a day.

### 6. Add `<Suspense>` boundaries to the three heaviest pages

- **Evidence**: 0 `<Suspense>` across 142 pages; `/dashboard`, `/mileage` and
  `/c/[publicId]/expenses` all block on their full data set.
- **Win**: Converts "blank for the whole TTFB" into "shell immediately, content
  fills in". This is a perceived-speed win with no change to raw speed, which is
  usually the better trade on mobile.
- **Risk**: Low. Standard App Router pattern.
- **Effort**: Half a day per page.

### 7. Add `CADisableMinimumFrameDurationOnPhone` to `ios/App/App/Info.plist`

- **Evidence**: The key is absent; iOS caps ProMotion opt-out apps at 60 Hz.
- **Win**: Removes the hard 60 Hz ceiling on iOS. Only meaningful **after**
  item 3, because compositor-hostile frames will not reach 120 fps anyway.
- **Risk**: Low, but it raises power draw. Requires a real iOS build to verify,
  since web CI does not compile iOS.
- **Effort**: Minutes to change, one build cycle to verify.

### 8. Virtualise or paginate the expenses page

- **Evidence**: 665 inputs, 375 buttons, 286 SVGs, 4,472 nodes, 10.3 ms worst
  relayout on desktop.
- **Win**: Cuts the largest relayout cost in the app and the largest decoded
  payload after `/mileage/business`.
- **Risk**: Medium. It is a UI restructure of a core screen, and forms with live
  state are the hardest thing to virtualise correctly.
- **Effort**: Two days or more. Lowest win per unit effort of the items listed,
  which is why it is last, not because the number is small.

### Deliberately not ranked: `mileage_broken_trips`

964 s of database time is the single largest server cost measured, but it is a
cron. Fixing it (an index-supported aggregate instead of a correlated
`count(distinct)` over a 26 MB table, or a materialised counter) is worth doing
for database load and cost. It will not make anything feel faster for a user.
Track it as infrastructure work, not as performance work.

## Not worth doing

Things that look like optimisations here but would not move the needle. Each one
has a reason, so nobody spends a day rediscovering it.

- **Removing the core-js polyfill chunk.** It is 113 KB raw and looks like an
  easy win. It is tagged `noModule` and modern browsers never fetch it.
  Verified in-browser: `polyfillFetched: false`.
- **Image optimisation, or migrating the 24 raw `<img>` tags to `next/image`.**
  All of `public/` is 1.0 MB. The two largest assets are 129 KB and 101 KB brand
  icons. There is nothing to win.
- **Adding loading states or skeletons for navigation.** `app/loading.tsx`
  already covers every client-side navigation with a branded screen. The gap is
  streaming within a page (item 6), not the absence of a loading state.
- **Lazy-loading the Capacitor plugins.** Already done. Every
  `@capacitor/*` and `@capgo/*` import in the codebase is a dynamic `import()`
  except two `registerPlugin` calls from `@capacitor/core`.
- **Working through the 350 Supabase advisor findings now.** Only three tables
  exceed 300 rows and `pg_stat_statements` shows no user-facing query above
  30 ms. Rewriting 105 RLS policies to use `(select auth.uid())` is correct
  eventually and pointless today. Set a trigger: revisit when any user-data
  table passes roughly 100k rows.
- **Adding the 75 missing foreign key indexes now.** Same reason. Indexes on
  sub-300-row tables cost writes and save nothing.
- **A `memo` / `useMemo` / `useCallback` sweep, or any React micro-optimisation.**
  Nothing measured points at reconciliation. The costs are bundle boot (129 ms),
  paint-property animations, and payload volume. A re-render sweep would consume
  days and change none of those numbers.
- **Compressing or trimming the HTML payload for bandwidth reasons.** Brotli
  takes the 702 KB expenses page to 39 KB on the wire. Decoded size still costs
  CPU and is worth reducing for that reason, but "the pages are too big to
  download" is false everywhere except `/mileage/business`.
- **Splitting or purging the CSS.** One stylesheet, 22.5 KB gzip, for the whole
  application.
- **Optimising `HeaderScrollHider`.** It looks like per-frame scroll work. It is
  rAF-throttled with hysteresis and fires twice per scroll session.
- **Rewriting the mobile apps natively, or moving to a bundled local web build.**
  Every cost measured is web-side and fixable in the web app. A local bundle
  would remove the network from cold launch but would give up the "ship a fix
  without an app review" property the whole architecture is built around. Not a
  performance decision.
- **Chasing server response time as the primary lever.** Median authenticated
  TTFB is 154 ms to 269 ms with a 150 ms network floor. There is roughly 100 ms
  of addressable server time across the whole app, and items 4 and 5 capture most
  of it.

## The honest answer on 120fps

**No, 120 fps is not currently reachable, and there is no setting that turns it
on.**

Three things govern refresh rate here, and only one of them is under the app's
control.

1. **The device panel and its current mode.** Android phones with 120 Hz panels
   run adaptive refresh. The OS decides the rate from what is on screen and the
   power state. An app cannot request 120 Hz from inside a WebView.

2. **The iOS opt-in.** On ProMotion iPhones, an app is capped at 60 Hz unless its
   `Info.plist` contains `CADisableMinimumFrameDurationOnPhone`. Taxottic's does
   not. So on iPhone 13 Pro and later, the app is hard-capped at 60 Hz today,
   regardless of anything in the web code. Adding the key lifts the cap. It does
   not produce 120 fps on its own and it costs battery.

3. **Whether each frame is compositor-only.** This is the part that matters, and
   it is entirely within the web app's control. A frame that only moves an
   existing layer (`transform`, `opacity`) can be produced in well under the
   8.3 ms that 120 fps allows. A frame that must re-paint cannot reliably. Today
   the app repaints continuously on every authenticated screen: a
   `background-position` shimmer on the header, an always-on `backdrop-filter`
   blur on that same sticky header, a spinning conic-gradient FAB, and, on any
   page showing reward tiles, a four-layer `background-position` drift blended
   over an `feTurbulence` noise texture.

And the ceiling that is already measurable: a full-document relayout costs
**7.4 ms median on `/dashboard` and 10.3 ms on the expenses page, on an M-series
Mac**. The 120 fps budget is 8.3 ms and the 60 fps budget is 16.7 ms. Mid-range
Android phones are commonly 4x to 6x slower on single-threaded work. Any
interaction that invalidates layout on those pages cannot hold 60 fps on a
phone, let alone 120.

**The realistic target is 60 fps with no dropped frames.** That is what users
actually perceive as smooth, it is achievable on every device the app ships to,
and it is not achieved today. The right framing is not "what frame rate should we
run at" but "which interactions currently drop frames, and why". Concretely:

- Ship items 3 and 5, then re-measure. Compositor-friendly frames plus fewer
  nodes is what buys headroom; the frame rate number follows.
- Reserve 120 fps as a stretch goal for pure `transform` and `opacity`
  transitions only: menu open, sheet slide, the edge-swipe back gesture. Those
  can plausibly hit 120 fps on a device already in high-refresh mode, once the
  header stops repainting behind them.
- Do not target 120 fps on content-heavy screens like expenses or
  `/mileage/business`. It is not reachable, and nobody would notice it if the
  60 fps floor were solid.
- Add `CADisableMinimumFrameDurationOnPhone` **after** item 3, not before.
  Uncapping the frame rate while frames are still repaint-bound spends battery
  to render the same dropped frames faster.

**Required next measurement**: none of the frame-rate claims above were verified
on a device, because both browser contexts in this environment ran with a hidden
viewport, which suppresses paint timing and throttles `requestAnimationFrame`.
Before acting on item 3, profile a real Android device over Chrome remote
debugging and a real iPhone over Safari Web Inspector, scrolling the dashboard
and the expenses page. That will turn "these animations are repaint-bound" from
a mechanism-level claim into a number.

## Found while measuring, not a performance item

Recording this here because it surfaced during the service worker review and
should not be lost.

`public/sw.js:929` caches HTML and RSC responses into `RUNTIME_CACHE` for any
navigation, including authenticated pages, on success. `lib/supabase/middleware.ts:358`
deliberately sets `Cache-Control: private, no-store, must-revalidate` on
authenticated responses, with a comment explaining that this is to stop one
user's rendered HTML being served to another after a login cycle. The service
worker's `cache.put` does not honour that header.

Today this is latent: the cached copy is only served when the network throws.
But it means **any future move to stale-while-revalidate on navigations, which is
otherwise the obvious perceived-speed win, would surface one account's data to
another on a shared device**. Fix the caching predicate first (skip `cache.put`
when the response carries `no-store`, or key the cache by user), then consider
the strategy change. Do not do them in the other order.
