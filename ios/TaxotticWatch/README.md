# Taxottic Watch — premium watchOS app (scaffold + integration runbook)

A jewelry-grade watch companion: midnight-navy (`#192539`) surfaces,
hairline-gold rims, a brushed-gold tax-readiness dial, and one-gesture
trip classification. This folder is **complete, idiomatic watchOS
source** that is **not yet wired into the Xcode project** — adding a
watch target edits `ios/App/App.xcodeproj/project.pbxproj`, which is
deliberately **not hand-edited** (a malformed pbxproj would break the
working iOS release pipeline). Adding the target is a ~10-minute Xcode
action on a Mac; once done these files build and ship as-is.

## Why this is "Phase 4 / optional"

Per `docs/WATCH_AND_NOTIFICATIONS_SPEC.md`, ~90% of the wrist
experience is delivered by **actionable push notifications** that a
paired watch mirrors automatically — no watch app needed (that path
is built; it only needs the credentials in
`docs/MANUAL_KEYS_RUNBOOK.md → Push notifications`). This native app
is the *additive, premium* layer.

## What it does (features)

Vertical Digital-Crown pages, midnight-and-gold throughout:

- **Hero dial** — animated brushed-gold tax-readiness gauge (spring
  settle + travelling catch-light), rolling YTD-deduction figure,
  "≈ $X saved", streak chip.
- **Live forecast window** — projected owed/refund counting up,
  effective rate + YTD income; elegant "updates on your iPhone"
  state until the forecast field is fed (no fabricated tax numbers).
- **Confirm deck** — the signature interaction. A card stack of
  trips / expenses / income the system isn't sure about. **Swipe
  left = Business/Deduct, swipe right = Personal/Skip**: live colour,
  glow, rotation, a commit-threshold haptic, fly-off + spring, a
  running count, and a shimmering "all caught up" finish. Each commit
  hits the same `POST /api/push/action` core as the notification.
- **Mileage** — auto-track toggle (arms/stops the phone GPS tracker
  from the wrist), auto-apply-business toggle, a pulsing live
  indicator, today's miles + deduction.
- **Available deductions** — captured/uncaptured list with values
  (readiness-ring summary until the per-deduction feed lands).
- **Goals** — gold progress bars, saved / target.
- **Achievements + medal celebration** — latest medal; when a NEW
  medal lands, a full-screen gold-ray + struck-medal celebration
  fires once with a success haptic. Plus a "Log an expense" hand-off.
- **Complications** — circular gold gauge, rectangular, inline,
  corner; App-Group backed, WidgetKit-refreshed.

## Files

| File | Role |
|---|---|
| `TaxotticWatchApp.swift` | `@main` SwiftUI app entry |
| `Models.swift` | `WatchSnapshot` struct (mirror of `lib/watch/types.ts`) + money formatters |
| `Theme.swift` | Design system: navy+gold palette, gold-sheen, `jewelCard`/`goldRim`, shimmer, pulse, counting money, haptics |
| `GoldGauge.swift` | Animated brushed-gold ring + `PillButton` |
| `ConfirmDeck.swift` | Swipe-left/right confirm-deck (the signature interaction) |
| `MedalCelebration.swift` | One-shot medal reward overlay |
| `ContentView.swift` | Vertical-paged glance: Hero · Forecast · Confirm · Mileage · Deductions · Goals · Achievements |
| `WatchConnectivityManager.swift` | WCSession: receives snapshot, sends swipe / mileage / auto-apply actions, fires the medal one-shot |
| `TaxotticComplication.swift` | WidgetKit complications (4 families) |
| `Info.plist` | watchOS app plist (`WKApplication`) |

Inbound watch → phone messages handled by `lib/watch/bridge.ts`:
`{type:"confirm",kind,id,decision:"left|right"}` → `/api/push/action`;
`{type:"mileage",action:"start|stop"}` → native mileage tracker;
`{type:"autoApply",value:"on|off"}`; `{type:"open",route}`.

## Add the targets in Xcode (needs a Mac)

1. Open `ios/App/App.xcodeproj`.
2. **File → New → Target… → watchOS → App.** Product name
   `TaxotticWatch`; bundle id **`com.taxottic.app.watchkitapp`**;
   SwiftUI / Swift; embed in companion **App**.
3. Delete Xcode's generated `ContentView.swift` / `<name>App.swift`;
   add **all `.swift` files in this folder** to the `TaxotticWatch`
   target (and `Info.plist` as its Info.plist).
4. **File → New → Target… → watchOS → Widget Extension** named
   `TaxotticComplication`; add `TaxotticComplication.swift` +
   `Theme.swift` to it (it uses `Color(hex:)`); remove its template.
5. **Signing & Capabilities** on the App target, watch app, and
   complication: same Team, automatic signing, **App Groups
   `group.com.taxottic.app`** on all three (the complication reads
   `ytdDeductionCents` / `taxReadinessPct` from this shared suite).
6. Archive with the existing scheme — `ios-release.yml` runs on a
   macOS runner and includes the embedded watch app automatically
   once the targets exist. Apple requires the watch app to ship with
   the iOS app (same App Store record).

## The phone-side bridge

**The JS/API half already ships** (merged, CI-tested, deploys live):

- `lib/watch/types.ts` — the `WatchSnapshot` contract (mirror of the
  Swift `struct WatchSnapshot`).
- `lib/watch/snapshot.ts` (+ `.test.ts`) — pure builder, unit-tested.
- `app/api/watch/snapshot/route.ts` — auth + assembles the snapshot
  from the existing readiness / mileage-deduction cores (best-effort
  per field; never errors).
- `lib/watch/bridge.ts` — guarded `syncWatch()` (fetch → native
  `TaxotticWatchBridge.sync`) and `startWatchBridge()` (inbound watch
  actions → existing `POST /api/push/action`, the same path the
  notification action uses). Mounted in `CapacitorNativeInit`.

**The remaining native half is one Swift file**, scaffolded here:

- `TaxotticWatchBridgePlugin.swift` — add it to the iOS **App**
  target in Xcode (NOT the watch target): the Capacitor plugin that
  does `updateApplicationContext`, writes the App Group, reloads the
  complication, and forwards inbound watch messages to JS. Because
  the JS half already ships, **data flows the moment this file is
  compiled into a build** — no further web work.

Until that file is in the App target, `syncWatch()` cleanly no-ops
(plugin not available), so the watch shows the "Open Taxottic on
iPhone to sync" state and the complication shows `$0 / 0%`. The
target+signing (Mac) and this plugin file are independent of the web
half and can land in any order.

> **Wired now** (endpoint → watch, no app change needed): readiness
> dial, YTD deduction + est. saved, the confirm deck from unclassified
> trips (swipe → reclassify), today's mileage, goals, latest badge +
> the new-medal one-shot celebration, and the mileage / auto-apply
> toggles (round-tripped through `lib/watch/bridge.ts`).
>
> **Endpoint-only follow-up** (no app/Swift change — the UI already
> renders them the moment the endpoint supplies them): the `forecast`
> object (deliberately omitted until reused from the real forecast
> engine — no fabricated tax figure on the wrist), per-deduction
> dollar values, and the `expense`/`income` confirm cards. The deck,
> forecast page, and deductions page show elegant placeholder states
> until then.
