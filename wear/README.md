# Taxottic Wear OS app (scaffold + integration runbook)

The Android-watch twin of `ios/TaxotticWatch/`. Same midnight-navy
(`#192539`) + gold "jewelry" design, same data contract
(`lib/watch/types.ts`), so the phone, the Apple Watch app and this
Wear OS app can never drift.

Like the watchOS scaffold, this is **complete, idiomatic source that
is intentionally NOT wired into the Android build** — `wear/` is not
in `android/settings.gradle`, so the working `android-release.yml`
pipeline is completely untouched until this is deliberately adopted.

## Features (parity with the Apple Watch app)

Vertical-paged Wear Compose glance on the gemstone backdrop:

- **Hero dial** — gold tax-readiness gauge, YTD-deduction figure,
  "≈ saved", streak chip.
- **Live forecast** — projected owed/refund, effective rate, YTD
  income (elegant "updates on your phone" state until fed).
- **Confirm deck** — swipe a card **left = Business/Deduct, right =
  Personal/Skip**; commits via the same `/api/push/action` core as
  the notification and the iOS watch.
- **Mileage** — auto-track + auto-apply toggles, today's miles +
  deduction.
- **Goals** — gold progress bars.
- **Medal celebration** — one-shot overlay when a new badge lands.
- **Tile** — `TaxotticTileService`, the glanceable surface
  equivalent of the iOS WidgetKit complication.

## Files

| File | Role |
|---|---|
| `Model.kt` | `WatchSnapshot` (mirror of `lib/watch/types.ts`) + money formatters |
| `Theme.kt` | Navy+gold design system (`Brand`, `jewelCard`, gemstone bg) |
| `Screens.kt` | The paged UI + the swipe-confirm deck |
| `DataLayer.kt` | Wearable Data Layer client (decode snapshot, send actions) |
| `MainActivity.kt` | Compose entry; streams snapshot → UI |
| `TaxotticTileService.kt` | Wear OS Tile |
| `AndroidManifest.xml` / `build.gradle.kts` | Module manifest + deps |
| `phone-bridge/TaxotticWatchBridgePlugin.kt` | **Phone-side** Capacitor plugin (add to `android/app`) — the Android twin of the iOS bridge plugin |

## Wire it up (when adopted — needs a Wear OS emulator/device)

1. Add the module to `android/settings.gradle`:
   `include ':wear'` and `project(':wear').projectDir = file('../wear')`
   (or move `wear/` under `android/`).
2. Ensure the root `android/build.gradle` has the Kotlin
   `serialization` + `compose` plugin classpaths (the app already uses
   Kotlin/AGP 8).
3. Add `phone-bridge/TaxotticWatchBridgePlugin.kt` to `android/app`
   under package `com.taxottic.app` and register it in
   `MainActivity` (`registerPlugin(TaxotticWatchBridgePlugin::class.java)`).
   The JS half (`lib/watch/bridge.ts`, `/api/watch/snapshot`) already
   ships and targets the `TaxotticWatchBridge` plugin name, so data
   flows the moment this compiles in — no web change.
4. Build/run: create a **Wear OS** AVD (Android Studio → Device
   Manager → Wear OS Large Round, API 34) and
   `:wear:installDebug`. Pair it with the phone emulator/app via the
   Wear OS companion so the Data Layer connects.

Until wired, the JS bridge cleanly no-ops on Android (plugin not
available) exactly as on the web — nothing breaks.

## Why scaffold (same call as watchOS)

A Wear module changes the Gradle build graph; hand-adding it to
`settings.gradle` before it's verified on a Wear emulator risks the
release that ships the real fixes. The data/JS half is live and
CI-tested; only this native module + the phone plugin need the
device-bound wiring above.

## Pairing & bidirectional sync — status

Audited end-to-end and **the contract has zero drift**: the
`WatchSnapshot` shape is field-for-field identical across
`lib/watch/types.ts` (TS), `Models.swift`, and `Model.kt`; the
Data-Layer paths/keys match on both ends (`/watch/snapshot` key
`"snapshot"`; actions on `/watch/action`); and every action message
shape (`confirm` / `mileage` / `autoApply` / `open`) the watch sends
is exactly what `lib/watch/bridge.ts` consumes. So once wired, sync
is correct — there is no protocol bug.

**Live, not just one-shot:** `lib/watch/bridge.ts` now re-pushes the
snapshot (a) on launch/resume, (b) on `@capacitor/app` resume /
app-active, and (c) immediately after every inbound watch action —
so phone-side changes reach the watch continuously and the watch
reflects server truth right after a swipe/tap.

**What's still required for real pairing (device-bound, can't be
done/verified headless):**
1. Register the phone-side `TaxotticWatchBridge` plugin in the
   Android app: add `phone-bridge/TaxotticWatchBridgePlugin.kt` under
   `android/app` (`com.taxottic.app`), `registerPlugin(...)` in
   `MainActivity`, and add
   `com.google.android.gms:play-services-wearable` to
   `android/app/build.gradle`.
2. Adopt the `:wear` module (see "Wire it up" above) and install it.
3. Pair the Wear OS emulator/watch with the phone via the Wear OS
   companion app so the Data Layer link is established (same package
   name `com.taxottic.app` enables auto-association).
