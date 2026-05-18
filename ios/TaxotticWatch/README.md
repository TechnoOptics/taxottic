# Taxottic Watch — Phase-4 watchOS app (scaffold + integration runbook)

This folder is a **complete, idiomatic watchOS app source** that is
**not yet wired into the Xcode project**. Adding a watch target edits
`ios/App/App.xcodeproj/project.pbxproj`; that file is deliberately
**not hand-edited** because a malformed pbxproj would break the
working iOS release pipeline (the one currently shipping the header /
status-bar / iOS-scroll / mileage fixes). Adding the target is a
~10-minute Xcode action on a Mac; once done these files build and
ship unchanged.

## Why this is "Phase 4 / optional"

Per `docs/WATCH_AND_NOTIFICATIONS_SPEC.md`, ~90% of the requested
wrist experience (post-trip Business/Personal, expense-applied,
goal/badge/message) is delivered by **actionable push notifications**
that a paired watch mirrors automatically — **no watch app needed**.
That path is built; it only needs the credentials in
`docs/MANUAL_KEYS_RUNBOOK.md → Push notifications`.

This native app is the *additive* richer layer: a watch-face
**complication** (glanceable YTD deduction) and an in-app glanceable
card with the one-tap trip classification.

## Files

| File | Role |
|---|---|
| `TaxotticWatchApp.swift` | `@main` SwiftUI app entry |
| `ContentView.swift` | Glanceable cards + one-tap Business/Personal |
| `WatchConnectivityManager.swift` | Receives snapshots, sends classification back |
| `TaxotticComplication.swift` | WidgetKit watch-face complication (YTD $) |
| `Info.plist` | watchOS app plist (`WKApplication`) |

## Add the target in Xcode (the part that needs a Mac)

1. Open `ios/App/App.xcodeproj` in Xcode.
2. **File → New → Target… → watchOS → App.**
   - Product name: `TaxotticWatch`
   - Bundle id: **`com.taxottic.app.watchkitapp`** (must be the phone
     id + `.watchkitapp`)
   - Interface: **SwiftUI**, Language: **Swift**
   - "Embed in companion app": **App**
3. Delete the auto-generated `ContentView.swift` /
   `<name>App.swift` Xcode created; **add the files in this folder**
   to the new target instead (drag them in, target membership =
   TaxotticWatch).
4. **File → New → Target… → watchOS → Widget Extension** named
   `TaxotticComplication` (for the watch-face complication). Add
   `TaxotticComplication.swift` to it; remove its template file.
5. **Signing & Capabilities** (both new targets): same Team as the
   App target; automatic signing. Add the **App Groups** capability
   `group.com.taxottic.app` to the App target, the watch app, and the
   complication (the complication reads `ytdDeductionCents` from this
   shared `UserDefaults` suite).
6. The iOS App target also needs **App Groups** `group.com.taxottic.app`
   so the phone bridge (below) can hand data across.
7. Archive with the existing scheme — `ios-release.yml` runs on a
   macOS runner and will include the embedded watch app automatically
   once the targets exist. Apple requires the watch app to be
   submitted with the iOS app (same App Store record).

## The phone-side bridge (follow-up, ~half a day)

The phone app is a Capacitor remote-WebView shell, so the website JS
must hand data to native `WCSession`. Two small pieces:

1. **A tiny Capacitor plugin** (`TaxotticWatchBridge`) exposing
   `sync({ snapshot })` that calls
   `WCSession.default.updateApplicationContext(["snapshot": data])`
   and writes `ytdDeductionCents` into the
   `group.com.taxottic.app` UserDefaults, then
   `WidgetCenter.shared.reloadAllTimelines()`.
2. **JS caller**: where the dashboard already computes YTD mileage
   deduction and the next quarterly reminder, also call
   `TaxotticWatchBridge.sync({ snapshot })`. Reuse the existing
   `lib/push/payloads.ts` shape so watch + push stay consistent.
   Inbound `sendMessage` (trip classification) is handed to the
   existing `POST /api/push/action` — identical server path to the
   notification action, so no new tax/mileage logic.

Until the bridge ships, the watch app builds and runs but shows the
"Open Taxottic on your iPhone to sync" empty state. The complication
shows `$0` until the first sync. This is intentional: the target +
signing (Mac) and the bridge (JS/native, CI-testable) are independent
and can land in either order.
