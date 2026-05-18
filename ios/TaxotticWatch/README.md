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

- **Hero tax-readiness dial** — animated brushed-gold gauge (spring
  settle, travelling catch-light), YTD deduction figure, "≈ $X saved
  in tax", and a streak chip.
- **One-gesture trip classify** — Digital-Crown page to a jewel card:
  Business / Personal pill buttons with haptics; the same
  `POST /api/push/action` server path as the notification action.
- **Quarterly countdown** — next estimated-tax amount + days-left
  with urgency styling, or a calm "no estimate due" state.
- **Achievement + quick action** — latest badge medal and a "Log an
  expense" hand-off to the phone capture flow.
- **Complications** — circular gold gauge, rectangular (gauge +
  figure), inline, and corner. Reads the App Group the app mirrors
  on every sync; refreshes via WidgetKit.

## Files

| File | Role |
|---|---|
| `TaxotticWatchApp.swift` | `@main` SwiftUI app entry |
| `Theme.swift` | Design system: navy+gold palette, gold-sheen gradients, `jewelCard`/`goldRim` modifiers, figure font, haptics |
| `GoldGauge.swift` | The animated brushed-gold ring + `PillButton` |
| `ContentView.swift` | Vertical-paged glance (Hero / Trip / Quarterly / Achievement) |
| `WatchConnectivityManager.swift` | `WatchSnapshot` model, receives snapshots, sends one-tap actions |
| `TaxotticComplication.swift` | WidgetKit complications (4 families) |
| `Info.plist` | watchOS app plist (`WKApplication`) |

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

## The phone-side bridge (follow-up, ~half a day)

The phone app is a Capacitor remote-WebView shell, so website JS must
hand data to native `WCSession`:

1. **Tiny Capacitor plugin** `TaxotticWatchBridge.sync({ snapshot })`
   → `WCSession.default.updateApplicationContext(["snapshot": data])`
   where `data` is JSON-encoded **`WatchSnapshot`**:

   ```ts
   {
     taxReadinessPct: number,            // 0–100
     ytdDeductionCents: number,
     estimatedTaxSavedCents: number,
     streakDays: number,
     nextQuarterly?: { label, dueISO, amountCents },
     pendingTrip?:   { id, summary, estDeductionCents },
     latestBadge?:   { title, symbol }   // SF Symbol name
   }
   ```
2. **JS caller** where the dashboard already computes readiness / YTD
   mileage deduction / next quarterly reminder / latest badge — reuse
   the existing `lib/push/payloads.ts` numbers so watch + push stay
   consistent. Inbound `sendMessage` (trip classify, expense capture)
   routes to the existing `POST /api/push/action` — no new
   tax/mileage logic.

Until the bridge ships the app builds and runs, showing the "Open
Taxottic on iPhone to sync" state; the complication shows `$0 / 0%`.
The target+signing (Mac) and the bridge (JS/native, CI-testable) are
independent and can land in either order.
