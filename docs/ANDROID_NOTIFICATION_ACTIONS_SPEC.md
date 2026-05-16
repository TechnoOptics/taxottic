# Android notification action buttons — single-pass spec

## Goal

Parity with iOS (PR #85): show **Business / Personal** buttons on
the Android notification (and Wear OS mirror) for the
`TRIP_CLASSIFY` / `CLARIFY` push kinds, tapping straight through to
the existing, already-tested `/api/push/action` handler.

## Why this is a spec, not a blind PR

`@capacitor/push-notifications` gives no JS API for Android action
buttons. The robust path is native and carries the exact risk that
broke the iOS build once (background-geolocation): done wrong it
**silently regresses the working push pipeline**, and the button
behaviour is only verifiable on a device with FCM credentials. The
cheap JS alternative was evaluated and rejected:

- **Rejected: `@capacitor/local-notifications` re-presentation.**
  Re-emitting an incoming push as a local notification with actions
  only runs when the app's JS is alive (foreground / not-killed).
  The headline case — "your drive just ended" with the app closed —
  is exactly the killed/background state where JS never runs. It
  would add a dependency for a feature that misses its main case.

So the value path is native, and native here must be done carefully
and **device-verified**, not blind-built.

## The crux risk

`@capacitor/push-notifications` registers its OWN
`FirebaseMessagingService` in its merged manifest. Adding a second
service with the FCM `MESSAGING_EVENT` intent-filter is undefined —
manifest-merge order decides which one wins, and the loser's
`onMessageReceived` never runs. Naively adding a service **breaks
Capacitor push entirely**.

**Mitigation (the only safe shape):** *subclass* Capacitor's service
rather than replace it.

```
class TaxotticMessagingService :
    com.capacitorjs.plugins.pushnotifications.MessagingService() {
  override fun onMessageReceived(msg: RemoteMessage) {
    val cat = msg.data["category"]            // "TRIP_CLASSIFY"/"CLARIFY"
    if (cat == "TRIP_CLASSIFY" || cat == "CLARIFY") {
      buildActionableNotification(msg)        // our NotificationCompat
      return                                  // do NOT call super here
    }
    super.onMessageReceived(msg)              // every other push:
                                              // unchanged Capacitor path
  }
}
```

Manifest: declare `TaxotticMessagingService` with the
`MESSAGING_EVENT` intent-filter and **remove the plugin's service
node** via the manifest merger so exactly one service is registered:

```
<service android:name="...pushnotifications.MessagingService"
         tools:node="remove" />
<service android:name=".TaxotticMessagingService"
         android:exported="false">
  <intent-filter>
    <action android:name="com.google.firebase.MESSAGING_EVENT" />
  </intent-filter>
</service>
```

This preserves Capacitor's exact behaviour for every non-actionable
push and only diverges for the two interactive categories.

## Server change (couples with the native work — ship together)

FCM `notification` messages are drawn by the system tray and
`onMessageReceived` is **not** called when the app is backgrounded —
so actionable kinds MUST be sent **data-only**.

`lib/push/providers.ts` `FcmProvider.send`: when `payload.category`
is set, send `{ data: {...stringified payload incl. category} }`
with **no `notification` block**; otherwise keep the current
`notification` + `data` (so plain FYIs still tray-render via
Capacitor with zero native code). Pure change, unit-testable. Do NOT
land this alone — without the native consumer an actionable push
would render nothing (a half-feature). It ships in the same PR as
the service.

iOS is unaffected: APNs + the PR-#85 `UNNotificationCategory`
already deliver buttons; `ApnsProvider` keeps its `alert` payload.

## Action wiring

`buildActionableNotification` builds a `NotificationCompat` with two
`addAction(...)` PendingIntents → a small `BroadcastReceiver` that
calls `POST /api/push/action` with `{ data, actionId }` (the body
shape the **already-built, already-tested** `resolvePushAction` +
route expect — no new server logic). Auth: the receiver has no
session cookie, so it opens the WebView deep-link
`taxottic.com/...` which carries the session and posts the action
(or posts with a short-lived token minted server-side at send time —
decide during impl; the deep-link route is simpler and reuses
existing auth). Notification channel: reuse the POST_NOTIFICATIONS
channel already declared.

## Verification matrix

| Layer | How |
|---|---|
| Native compiles | Android release workflow (`gradlew bundleRelease`) — CI-dispatchable, like the iOS-categories archive check |
| Capacitor push still works (non-actionable) | Device, FCM creds — send a plain `expense_applied`, confirm it still trays via Capacitor |
| Buttons render + route (foreground/background/killed) | Device, FCM creds — the only true test; foreground vs killed must both be checked |
| Server data-only switch | Unit test `FcmProvider` payload shape per kind |

## Phase plan

1. **Server**: `FcmProvider` data-only for actionable kinds + unit
   tests. (In the same PR as 2 — not standalone.)
2. **Native**: subclassed `TaxotticMessagingService` + manifest
   service-swap + `buildActionableNotification` + the action
   `BroadcastReceiver`/deep-link.
3. **Verify**: dispatch the Android build (compile gate), then
   on-device with FCM creds across foreground/background/killed.

Blocked on the same operator step as the rest of notifications: an
FCM service account (`FCM_SERVICE_ACCOUNT_JSON`). Until that exists
the runtime can't be verified at all, which is the second reason
this is staged behind a spec rather than merged blind.

## Lessons carried in

- The background-geolocation SPM break: a native change that can't
  be CI-verified gets a compile gate (dispatch the build) **and**
  device verification before it's relied on — never assumed good.
- Subclass/extend the platform plugin; never run a competing service
  next to it.
- Don't land the server half without the native half (no
  half-features).
