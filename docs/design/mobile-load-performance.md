# Mobile load performance: cold start, resume, first paint

Status: **measured, two fixes shipped in this PR, the larger items are
options that need a decision.** The two changes made here are the ones
that were both clearly safe and clearly measured. Everything with a user
experience trade-off is written up below as an option and deliberately
not implemented.

Measured 2026-08-17 against `origin/main` at `b49c4ff5`, in an isolated
worktree, on a production build (`next build` plus `next start -p 3456`)
and against production `https://taxottic.com`.

This document does not reuse any number from `docs/performance-baseline.md`.
Those numbers are from `b6faa71` (1.3.6, 2026-08-01) and a redesign, four
new typefaces and a fortnight of client changes have landed since. Every
figure below was taken fresh.

## Contents

- [The fact that governs everything else](#the-fact-that-governs-everything-else)
- [How things were measured](#how-things-were-measured)
- [What could not be measured](#what-could-not-be-measured)
- [1. The cold-start entry path](#1-the-cold-start-entry-path)
- [2. What a cold start actually downloads](#2-what-a-cold-start-actually-downloads)
- [3. Fonts](#3-fonts)
- [4. The native splash is a timer, not a readiness signal](#4-the-native-splash-is-a-timer-not-a-readiness-signal)
- [5. The service worker on a repeat launch](#5-the-service-worker-on-a-repeat-launch)
- [6. The six components in the root layout](#6-the-six-components-in-the-root-layout)
- [7. What the devices themselves report](#7-what-the-devices-themselves-report)
- [Ranked causes](#ranked-causes)
- [What changed in this PR](#what-changed-in-this-pr)
- [Options that need a decision](#options-that-need-a-decision)
- [Not worth doing](#not-worth-doing)

---

## The fact that governs everything else

Confirmed in `capacitor.config.ts`, not assumed:

```
server: { url: "https://taxottic.com", ... }
```

`webDir` is `public`, which holds no application HTML. There is no local
bundle to fall back on. **Every cold start of the Android and iOS app is
a full network page load of the production site plus Next.js hydration.**

Three consequences follow, and they decide which optimisations are even
worth considering:

- Code splitting matters much less than it would in a bundled app. The
  chunks are already content-hashed and HTTP-cached, and the app is not
  competing with a slow local disk.
- Time to first byte and the cacheability of the entry URL matter
  enormously, because they are paid in full on every launch.
- The service worker is the only thing standing between the user and a
  blank WebView when the network is slow, and today it is not standing
  there. See section 5.

## How things were measured

| Source | What it gave |
| --- | --- |
| `next build` in the worktree, then `.next/prerender-manifest.json` | which routes are prerendered and which are dynamic |
| `next start -p 3456` plus the in-app Browser pane at a 375x812 mobile viewport | per-resource `encodedBodySize`, resolved font families per element, `document.fonts` state |
| Parsing `@font-face` blocks out of the emitted CSS against `.next/static/media` | per-family, per-subset font bytes |
| `curl -w` against `https://taxottic.com`, 7 samples per path | production TTFB and CDN cache status |
| `curl -D -` against production | `Cache-Control`, `x-vercel-cache`, `content-encoding` |
| Supabase MCP, read only, `mileage_device_heartbeats` over 10 days | real device probe cost, foreground/background split, client build staleness |
| Source reading | entry redirect chain, splash handover, service worker strategy, root layout effects |

Environment caveat that applies to every timing number: the client is an
M-series Mac on a wired connection, and Vercel resolved to `iad1` in the
same region. A phone on LTE is slower on network and several times slower
on single-threaded CPU. **Every latency number below is a floor, not a
user experience.** The byte counts, by contrast, are exact and transfer
identically to a phone.

## What could not be measured

Stated plainly rather than guessed around.

- **Native cold launch time on real hardware. Not measured. There is no
  physical device in this environment and nothing here was run on a
  phone.** Doing it properly needs a device build plus Chrome remote
  debugging or Safari Web Inspector.
- **The authenticated cold start.** The Chrome MCP that holds the owner's
  logged-in session failed to start in this session (`No group with id`),
  so every production measurement below is anonymous. The authenticated
  path is described from source with line references, and its extra cost
  is reasoned rather than timed. It is labelled as such where it appears.
- **Real first-contentful-paint and largest-contentful-paint.** The
  Browser pane reported an empty `paint` entry buffer and a null LCP on
  every navigation, which is the same suppression the previous baseline
  hit. Payload and request-count numbers are solid; paint timing is not
  available.
- **Whether the 1.5 s splash actually expires before first paint on a
  phone.** Mechanism is proven from config and source. The comparison
  against real-world load time is a hypothesis, because of the two points
  above.

---

## 1. The cold-start entry path

`server.url` is the bare origin, so the WebView opens `/`.

`/` is not a static route. `app/page.tsx:304` calls
`supabase.auth.getUser()`, which makes the route dynamic, and
`app/page.tsx:305` then redirects a signed-in user to `/dashboard`.

Production headers confirm what that costs at the CDN:

| path | `x-vercel-cache` | `Cache-Control` | prerendered | TTFB median |
| --- | --- | --- | --- | --- |
| `/` | **MISS** | `private, no-cache, no-store, max-age=0, must-revalidate` | no | 0.238 s |
| `/example` | **MISS** | `private, no-cache, no-store, max-age=0, must-revalidate` | no | 0.232 s |
| `/login` | HIT | `public, max-age=0, must-revalidate` | yes | 0.252 s |
| `/pricing` | HIT | `public, max-age=0, must-revalidate` | yes | 0.204 s |

Anonymous, 7 samples each, from a wired Mac in the same region as the
edge. The build prerenders 111 routes, and `/` is not one of them.

**The honest reading of this table is that the HIT/MISS split is not
visible in my numbers.** A MISS on `/` costs 238 ms and a HIT on `/login`
costs 252 ms. From this vantage point the origin and the edge are both
in `iad1` and the difference is inside the noise. I am not going to claim
a CDN win I did not measure. What the table does prove is structural: the
app's entry URL can never be served from the CDN, from the browser HTTP
cache, or from the service worker, because `no-store` forbids all three.
On a phone in a distant region, on LTE, that structural fact is where the
cost would show up, and I could not measure that case.

For a signed-in user the entry path is also two navigations, not one:

1. `GET /`, middleware `updateSession` runs `supabase.auth.getUser()`
   (`lib/supabase/middleware.ts:322`), the page runs
   `supabase.auth.getUser()` again (`app/page.tsx:304`), then redirects.
2. `GET /dashboard`, middleware runs `getUser()` a third time, then the
   dashboard renders.

`getUser()` validates the JWT against the Supabase auth server rather
than reading the cookie locally, so each of those is a network round trip
taken before any HTML is produced. The redirect fires at line 305, well
before the marketing JSX, so a signed-in user does **not** pay for the
162 KB marketing page. They pay for one extra HTTP round trip and one
extra auth round trip. That is a claim from source, not a measurement.

## 2. What a cold start actually downloads

Measured on the built app shell at `/example`, a public sample dashboard
that renders the same header, rail and card chrome as the signed-in app,
at a 375x812 mobile viewport. `encodedBodySize`, so compressed
over-the-wire bytes.

| resource | files | bytes |
| --- | --- | --- |
| JS | 13 | 183,562 |
| **woff2** | **5** | **126,276** |
| CSS | 2 | 24,202 |
| brand mark (SVG) | 1 | 29,507 |
| other | 1 | 6,590 |
| **total** | **22** | **370,137** |

Two things stand out, and neither is the JavaScript.

**Fonts were 34 % of the entire cold-start payload.** More than the CSS
and the brand mark and everything else put together, and second only to
all thirteen JS chunks combined.

**The brand mark was 29,507 bytes to paint a 96 pixel logo.**
`app/loading.tsx` opened with a comment calling it "a tiny SVG". It is
not a vector at all. `/brand/icon-mark-cream.svg` is a 512x512 PNG
base64-embedded inside an SVG wrapper: 39,754 bytes on disk, 29,699 on
the wire after brotli in production. Because `app/loading.tsx` is the
root Suspense fallback, React emits it as
`<link rel="preload" as="image">` as the **first link in the head of
every route**, which makes it the single highest-priority fetch of the
entire cold start.

## 3. Fonts

Four families are declared in `app/layout.tsx`: Fraunces, Hanken
Grotesk, Archivo and IBM Plex Mono. A fifth, Conquera, is a local
`@font-face` in `globals.css` for the wordmark.

The families are unicode-range subset, so a US English user does not
download all 648 KB in `.next/static/media`. Parsing the emitted CSS for
the latin subsets gives:

| family | latin bytes | weights declared |
| --- | --- | --- |
| Fraunces | 35.7 KB | 400, 500, 600, 700 |
| Archivo | 34.1 KB | 500, 600, 700 |
| Hanken Grotesk | 33.9 KB | variable 100 to 900 |
| IBM Plex Mono | 19.6 KB | 400, 500 |
| **total** | **123.3 KB** | |

**Fonts do not block first paint.** All 36 real `@font-face` rules carry
`font-display: swap` (the 4 rules without it are Next's metric-adjusted
fallback faces, which have no `src`). So the cost is bandwidth on the
critical path and a swap flash, never a blank screen.

The interesting finding is which of them the mobile app actually draws.
`app/globals.css` sets `--font-display` to Archivo under
`[data-skin="instrument"]`, and `app/layout.tsx` puts
`data-skin="instrument"` on `<body>` for every surface except `/firm` and
`/admin`, which opt back out to `[data-skin="classic"]` and Fraunces.

Scanning every text-bearing element on the built `/example` for its
resolved first font family:

| resolved family | elements |
| --- | --- |
| Hanken Grotesk | 70 |
| Archivo | 11 |
| Fraunces | **0** |
| IBM Plex Mono | **0** |

`document.fonts` agreed: only `Hanken Grotesk`, its fallback, and
`Archivo 500` reached `status === "loaded"`.

All five woff2 files were fetched anyway, simultaneously, at 131 ms.
That is preload behaviour, not CSS-match behaviour, and the mechanism is
visible in the markup: on `/login` the head carries five literal
`<link rel="preload" as="font">` tags, and on `/` and `/example` the same
five arrive as React Flight `:HL[...,"font"]` hints. **Every route
preloads all four families regardless of which it renders.**

Fraunces is the clear-cut case. It is the display face for `/firm` and
`/admin` only. No screen the mobile app shows renders it, and 36,860
bytes of highest-priority bandwidth were being spent on it on every
launch. That is fixed in this PR.

IBM Plex Mono is not clear-cut. `/example` does not render it, but it
backs `.figure` and `.tabular` under the instrument skin, which is how
money columns get tabular numerals, and 62 files reference those classes.
Deferring it would be correct mechanically and would show a swap flash on
figures on money screens. That is a judgement call about how the product
feels, so it is an option below, not a change here.

## 4. The native splash is a timer, not a readiness signal

`capacitor.config.ts` sets `launchShowDuration: 1500` and
`showSpinner: false`. There is **no `launchAutoHide: false` in the
config and no `SplashScreen.hide()` call anywhere in the web codebase**
(grepped across `app`, `components`, `lib`).

The Capacitor SplashScreen plugin defaults `launchAutoHide` to true, so
the splash dismisses on a fixed 1.5 second timer that has no relationship
to whether the remote page has loaded.

What the user sees is therefore:

1. Branded splash, 1.5 s, fixed.
2. Then the WebView, painted `#121a2a` navy by
   `ios.backgroundColor` / `android.backgroundColor`, with **nothing on
   it and no spinner**, for however long the network takes.
3. Then the app.

This answers the question in the brief directly: **there is a native
splash, and it masks exactly 1.5 seconds of load, after which the user
gets a blank navy screen rather than a blank white one.** Whether step 2
is usually visible depends on whether a real cold start exceeds 1.5 s,
which I could not measure without a device. Given that the entry URL is
uncacheable and the shell is 370 KB before this PR, exceeding 1.5 s on a
mobile network is likely, but likely is not measured.

## 5. The service worker on a repeat launch

`public/sw.js` was at `v194` on main. Two rules in the fetch handler
decide what a second launch can reuse:

- **`/_next/*` is skipped entirely** (`sw.js`, the `startsWith("/_next/")`
  early return). Deliberate, and correct: Next content-hashes those URLs,
  and caching them in the SW was the root cause of a persistent React
  #418 hydration error after deploys. The browser HTTP cache handles them.
- **Authenticated HTML is never stored.** `isStorable()` refuses any
  response carrying `no-store` or `private`, which
  `lib/supabase/middleware.ts:387` sets on every response to a signed-in
  user.

Both rules are right. The consequence, which is what matters for load
performance, is that **there is no app shell.** Navigations are
network-first, the entry URL is `no-store` so it never enters the runtime
cache, and the only cached copy of `/` is whatever `PRECACHE` grabbed at
install time. That copy is only ever served when the network fails.

So a repeat launch is not meaningfully cheaper than a first launch. It
re-fetches the HTML over the network every time. It saves only the
static assets that survive: fonts and images under the cache-first
branch, and the `/_next/*` chunks via the browser's own HTTP cache.

And those font and image savings are more fragile than they look.
`activate` deletes every cache whose key is not the current
`CACHE_VERSION`, and the repo rule is to bump `CACHE_VERSION` on every
client JS or markup change. At v195 after 194 previous bumps, that
happens often, and each bump makes the next launch re-download every
font and every image including the brand mark. **That is the specific
reason the brand mark's size was worth fixing rather than dismissing as
a once-per-install cost.**

### Can this be given a stale-while-revalidate app shell safely?

Not without re-opening the outage recorded in
`service-worker-reload-disarms-tracker`. The relevant history: PR #484
adopted a waiting worker whenever `document.visibilityState === "hidden"`.
Adopting posts `SKIP_WAITING`, which fires `controllerchange`, which
reloads the page. `lib/mileage/native-tracker.ts` arms with
stop-then-start, so a page booting in a backgrounded iOS WebView stopped
the live location service and was then suspended at the `await` before
`start()` ran. Grace's iPhone went from 284 background heartbeats to one,
then four days of silence.

The guard is in place today and is correct: `shouldAdoptWaitingWorker()`
in `lib/pwa/adopt-policy.ts` allowlists `"visible"` so unknown states
fail closed, and `PWASetup` defers the `controllerchange` reload until
the page is visible. **Nothing in this PR touches it.**

The reason an app shell is dangerous here is more general than that one
guard. The mileage tracker's liveness is a property of the *page life*.
Any caching strategy that lets a launch paint from cache and then swap in
fresh content is one step away from wanting a reload to apply the fresh
content, and a reload is what kills the tracker. A safe design has to
paint the shell from cache and hydrate the real content into the same
page life, never reload. That is a real project, not a tweak, and it is
written up as an option rather than attempted here.

## 6. The six components in the root layout

`app/layout.tsx` mounts `PWASetup`, `CapacitorAuth`, `CapacitorNativeInit`,
`OutdatedAppBanner`, `MileageTrackingReminder` and `EdgeSwipeBack`.

All six are `"use client"` components whose entire body is a
`useEffect`, and all six return `null` or render nothing until an effect
resolves. **None of them can block first paint**, because effects run
after paint. They cost hydration and post-paint main-thread work, not
first paint.

`CapacitorNativeInit` was specifically called out in the brief for plugin
probing, permission checks and push registration. It does do all of that,
and it does it as one long sequential `await` chain: StatusBar, then the
SafeArea probe, then `App.getInfo()`, then the push permission check and
`register()`, then `resumeMileageTrackingIfEnabled()`, then the battery
exemption, then the watch bridge, then the widget bridge.

The device evidence says the individual native calls are cheap. Every
one of them crosses the same Capacitor bridge that `device_probe_ms`
measures, and on iOS that is a median of 3 ms:

| platform | beats | probe p50 | probe p95 | probe max |
| --- | --- | --- | --- | --- |
| iOS | 515 | **3 ms** | 22 ms | 3,003 ms |
| Android | 73 | 18 ms | 3,484 ms | 12,720,365 ms |

`mileage_device_heartbeats`, 10 days to 2026-08-17. The Android p95 and
max are not credible as bridge latency: the same rows carry
`timer_lag_ms` up to 54,455,326 ms, which is a WebView frozen in the
background, so those tails measure OS suspension rather than the bridge.
The iOS p50 of 3 ms is the trustworthy figure and it is small.

**So the hypothesis that `CapacitorNativeInit` is an expensive
cold-start cost is not supported.** It is a sequential chain of cheap
calls that runs after paint. I found nothing here worth changing, and
changing it would risk the mileage re-arm path for no measured gain.

## 7. What the devices themselves report

Two real devices report into `mileage_device_heartbeats`.

**iOS is almost never in the foreground.** Of 515 iOS beats in the
10-day window, 479 were background and 36 foreground. Cold start is
therefore not the dominant iOS experience; resume is.

**The iOS client bundle is stale by a day and a half.** The iOS device
has reported `web_build = 3f0533b6c3fd` continuously from 2026-08-16
04:39 to 2026-08-17 17:09, across 230+ beats, while `server_build` moved
through `a7ea28ae`, `fffbfa7d`, `48dc7426`, `b4e96803` and `b49c4ff5`.
`3f0533b6` is dated 2026-08-15 23:29. The Android device, by contrast,
reported `web_build == server_build == 48dc74269e0c` at 16:17 on 08-17.

The load-path reading is that the iOS WebView page life is extremely
long. It is backgrounded rather than closed, so it does not cold start,
so it does not pick up a new bundle. That is consistent with the
foreground/background split above. It is an inference from two fields,
not a proof, and it deserves its own investigation. It matters here for
one reason: **client-side load improvements reach iOS slowly**, so the
before/after numbers in this PR will show up on Android first.

---

## Ranked causes

Ranked by confidence multiplied by size, with the evidence for each.

1. **The entry URL is structurally uncacheable, and for a signed-in user
   it is two navigations.** `/` is dynamic because of the `getUser()` at
   `app/page.tsx:304`, so it is `no-store` and can never be served by the
   CDN, the HTTP cache or the service worker. Signed-in users then pay a
   second navigation to `/dashboard` plus three Supabase auth round trips
   across the chain. Proven structurally from headers and source. **The
   latency cost was not measurable from my location**, where MISS and HIT
   differ by less than the noise.
2. **There is no app shell, so every launch is a full network load.**
   Proven from `sw.js`: `/_next/*` skipped, `no-store` HTML unstorable,
   navigations network-first. Repeat launches are not cheaper than first
   launches except for fonts and images, and a `CACHE_VERSION` bump wipes
   even those.
3. **The splash is a 1.5 s timer with no readiness signal, and there is
   no spinner behind it.** Proven from config and an exhaustive grep for
   `SplashScreen.hide()`. Whether the gap is visible in practice is a
   hypothesis, because no device was available.
4. **123 KB of fonts on every route, of which the mobile app renders
   two families.** Measured exactly. 36,860 bytes of it was Fraunces,
   which the app never draws. Fixed here.
5. **A 29,699 byte brand mark as the highest-priority fetch of every
   cold start, to paint a 96 px logo.** Measured exactly. Fixed here.
6. **`CapacitorNativeInit` and the other five root-layout components.**
   Investigated and **cleared**. They run after paint, and the bridge
   they use costs a median of 3 ms on iOS.

## What changed in this PR

Only the two items that were both clearly safe and clearly measured.
Before and after are from the identical method: the built app shell at
`/example`, mobile viewport, `encodedBodySize`.

### Right-size the loading-screen brand mark

`app/loading.tsx` now points at `/brand/icon-mark-cream-288.png`, a
288 px render of the same artwork from `icon-mark-cream-1024.png`. 288 px
is 3x the 96 px box the component paints, which is the highest pixel
density any shipping phone requests.

| | before | after |
| --- | --- | --- |
| asset | `icon-mark-cream.svg` | `icon-mark-cream-288.png` |
| on disk | 39,754 B | 16,313 B |
| on the wire | 29,507 B | 16,313 B |

**13,194 bytes off the highest-priority fetch of every cold start.** The
wire figure for the SVG is after brotli, which recovers the base64
overhead, so the saving is genuinely from the resize and not from
dropping the wrapper.

### Stop preloading Fraunces

`app/layout.tsx` declares `preload: false` on the Fraunces call. The
`@font-face` is untouched, so `/firm` and `/admin` still get Fraunces,
fetched when the CSS matches, under the `display: "swap"` already set.

| | before | after |
| --- | --- | --- |
| woff2 files fetched | 5 | 4 |
| woff2 bytes | 126,276 | 89,716 |

**36,560 bytes off every route in the app.**

### Combined, and the proof it changed nothing visually

| | before | after | delta |
| --- | --- | --- | --- |
| total cold-start payload | 370,137 B | 320,384 B | **-49,753 B (-13.4 %)** |
| requests | 22 | 21 | -1 |
| resolved families: Hanken / Archivo | 70 / 11 | 70 / 11 | unchanged |
| `document.fonts` loaded | Hanken, Hanken Fallback, Archivo 500 | identical | unchanged |

The last two rows are the safety argument. The set of fonts the page
actually renders, and the number of elements resolving to each, is
byte-identical before and after. Nothing that was drawn before is drawn
differently now.

`CACHE_VERSION` bumped `v194` to `v195`, with the changelog entry the
repo requires. Checked against `origin/main` (v194) and all three open
PRs (#598, #599, #601), none of which touch it, so v195 is unused.

### Guards

`lib/perf/load-path-budget.test.ts` holds both properties, because both
regress silently: an asset gets bigger or a font goes back to being
preloaded and nothing breaks, nothing errors, the page is just slower.

Both assertions run on comment-stripped source, and that is load-bearing
rather than ceremonial. `app/loading.tsx` and `app/layout.tsx` both carry
long comments naming the very strings being asserted on, and this repo
has shipped five guards that matched a doc comment and reported it as
the code. Mutation-tested four ways, each killing exactly the intended
test and leaving the other green:

| mutation | result |
| --- | --- |
| point `loading.tsx` back at the fat SVG | mark budget test fails |
| delete `preload: false` | Fraunces test fails |
| leave `preload: false` present **only inside a comment** | Fraunces test fails |
| name the 288 px asset **only in a comment**, real `src` still fat | mark budget test fails |

## Options that need a decision

Each of these is larger than a tweak, or trades user experience for
speed. None is implemented.

### A. Point the native shell at a cheaper entry URL

Change `server.url` so the WebView does not open the dynamic marketing
route. Removes one navigation and one auth round trip for signed-in
users on every cold start.

Trade-offs: needs a native rebuild and store submission, so it reaches
users on the slowest possible path and cannot be rolled back over the
air. An anonymous user would land on a 307 to `/login`, which is
arguably better than the marketing page but is a real behaviour change
for anyone who opens the app to read the marketing site. It also splits
"what the website does at `/`" from "what the app does at launch", which
is a thing to maintain forever.

### B. Make `/` static and move the signed-in redirect

The `getUser()` at `app/page.tsx:304` is what makes the app's entry URL
dynamic and uncacheable. Moving that decision into middleware, which
already calls `getUser()` anyway at `lib/supabase/middleware.ts:322`,
would let `/` prerender and be served from the edge, and would remove one
of the three auth round trips.

Trade-offs: this is a change to the auth redirect topology, which is
exactly the area the `PUBLIC_PATHS` history says is easy to get wrong. It
also lands in the other agent's territory (server render), so it should
not be done twice. And I could not demonstrate the win: at my vantage
point the CDN HIT and MISS medians differ by less than the sampling
noise. It should not be done on my evidence alone.

### C. Give the splash a readiness signal

Set `launchAutoHide: false` and call `SplashScreen.hide()` from the web
app once the shell has painted. Turns the fixed 1.5 s into "brand until
the app is actually there" and removes the blank navy gap entirely.

Trade-offs: this is the one with a real hazard. With `launchAutoHide`
false, the splash hides only when JS asks it to, so any failure that
stops the web app from booting, offline, a JS error, an auth loop, leaves
the user on a permanent splash with no way forward. A JS-side timeout
does not help, because JS failing is the case being guarded. Doing this
safely needs a native-side maximum as well, and a device to test it on.

A smaller version with none of that risk: set `showSpinner: true` so the
gap after the splash is not blank. Still needs a native rebuild.

### D. Defer IBM Plex Mono

`preload: false` on Plex Mono, symmetrically with Fraunces, would take
another 19.6 KB off every route.

Trade-off: unlike Fraunces, Plex Mono is genuinely used, by `.figure`
and `.tabular` for money columns. Deferring it means the figures paint
once in the fallback and once in Plex Mono. On a screen whose entire job
is comparing numbers down a column, a reflow of the numbers is the worst
place to put a swap flash. This is a "how should it feel" decision, so it
belongs to whoever owns that.

### E. A real app shell

The genuine fix for cold start on a remote-URL shell. Cache a skeleton
that paints instantly, then fill it in the same page life.

Trade-off: the hard constraint is that it must never reload. See
section 5. Any design that applies fresh content by reloading re-opens
the outage in `service-worker-reload-disarms-tracker`. This is a project
with a design doc of its own, not an increment.

## Not worth doing

- **Code splitting the 183 KB of JS.** It is the largest single category,
  but the chunks are content-hashed and served from the browser's HTTP
  cache, which the service worker correctly leaves alone. On a remote-URL
  shell the repeat cost is already near zero, and the first-load cost is
  hydration, not download. The gain does not justify the churn.
- **Touching the six root-layout components.** Cleared in section 6.
  They run after paint and the bridge costs 3 ms.
- **Caching `/_next/*` in the service worker.** Already tried, already
  reverted. It was the root cause of the React #418 hydration errors
  after deploys. The comment in `sw.js` is correct and should stay.
- **Subsetting the fonts further.** They are already unicode-range
  subset by `next/font`, and the latin subsets are 34 KB and under. The
  win was in not fetching a family at all, not in shrinking one.
