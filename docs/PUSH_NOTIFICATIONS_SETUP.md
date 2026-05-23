# Push Notifications — One-Time Setup Runbook

**Audience:** project owner (Abel). Every step happens in a browser
or a one-line shell command — no code changes required after this.
**Time:** ~30 min if you have your Apple Developer + Firebase logins
handy. ~45 min if you need to set up the Apple account first.

## What this unlocks

Once the steps below are done, the pipeline that's already built
(producer in `app/api/mileage/ingest/route.ts` → `lib/push/*` →
APNs/FCM) starts actually delivering. Today, every call to
`notify(...)` resolves to the `NoopProvider` because the env vars
aren't set; after this runbook, real banner notifications hit the
phone.

What fires today (no extra producer wiring needed):

- **`trip_classify`** — a logged drive lands as `unclassified` (the
  segmenter couldn't auto-classify it). Fires from `/api/mileage/ingest`.
- **Watch & banner already work** — this runbook only adds the
  *native phone push*. Watch buzz + auto-scroll, and the amber
  banner on `/mileage`, all work today.

The `charge_clarify` producer (task #68) ships separately; once
this setup is in place, *its* notifications will deliver too.

---

## Prerequisites — gather these first

| | |
|---|---|
| Apple Developer Program | $99/yr. Required for iOS push at all. https://developer.apple.com |
| App Store Connect access | Same login. Required for build uploads (already in use). |
| Google account | Firebase is free. https://console.firebase.google.com |
| Vercel team access | To add server env vars. https://vercel.com |
| The Taxottic GitHub repo | To drop `google-services.json` into the build (sideload only — never committed). |

---

## Step 1 — Firebase project (for Android FCM)

1. https://console.firebase.google.com → **Add project**
   - Name: `Taxottic`
   - Disable Google Analytics (not needed and adds setup friction)
   - Wait for project creation (~30s)

2. In the Firebase console for the new project, click **Add app → Android (robot icon)**
   - **Android package name**: `com.taxottic.app`
   - **App nickname**: `Taxottic Android` (optional)
   - **Debug signing certificate SHA-1**: leave blank (FCM doesn't require it)
   - Click **Register app**

3. **Download `google-services.json`**.
   - Place it at `android/app/google-services.json` in your local repo.
   - **DO NOT COMMIT** — it's already in `.gitignore`. Place a copy in your password manager too; you'll need it on every machine that builds the APK.

4. Skip the "Add Firebase SDK" step (Capacitor's `@capacitor/push-notifications` already does what's needed via the Firebase Android SDK that gradle resolves transitively).

5. Skip the "Run your app to verify installation" step. The verification happens at the end of this runbook.

### Server-side FCM credentials

The server needs a *service account* to mint OAuth tokens for the FCM v1 API.

1. Firebase Console → **gear icon → Project settings → Service accounts** tab.

2. Click **Generate new private key** → **Generate key**. A JSON file downloads. Open it in a text editor; you'll need the entire JSON blob in the next step.

3. In Vercel (next section) you'll paste the full JSON blob into `FCM_SERVICE_ACCOUNT_JSON`.

---

## Step 2 — Apple Developer (for iOS APNs)

1. https://developer.apple.com/account → **Identifiers**
   - Find `com.taxottic.app` (it's already registered — that's how TestFlight uploads work).
   - Click it → scroll down to **Capabilities**.
   - Enable **Push Notifications** (toggle it on, click Save).
   - This adds an APNs SSL service to the App ID; the cert is auto-managed by Apple.

2. Still in developer.apple.com → **Keys → +**
   - **Key Name**: `Taxottic APNs`
   - Enable **Apple Push Notifications service (APNs)**
   - Click **Continue → Register → Download**. You get `AuthKey_<KEYID>.p8`.
   - **You can only download this ONCE.** Store it in your password manager IMMEDIATELY.
   - Note the **Key ID** (10-char alphanumeric, e.g. `ABC123DEF4`) — shown next to the key name. You'll need it for `APNS_KEY_ID`.

3. Get your **Team ID**.
   - developer.apple.com → **Membership** (top-right account menu).
   - 10-char ID at the top of the page. You'll need it for `APNS_TEAM_ID`.

> **Don't add anything to the iOS Xcode project manually.** The `ios-release.yml` GitHub Actions workflow uses *automatic signing* — once Push Notifications is enabled on the App ID, the next archive auto-generates the right entitlements + provisioning profile. No Xcode editing needed.

---

## Step 3 — Vercel environment variables

https://vercel.com → Taxottic project → **Settings → Environment Variables**

Add the following (set **Environment: Production** + Preview + Development for all):

### Android push (FCM)

| Name | Value | Source |
|---|---|---|
| `FCM_SERVICE_ACCOUNT_JSON` | Full JSON contents of the service-account file from Step 1.5 | Firebase → Service accounts |

### iOS push (APNs)

| Name | Value | Source |
|---|---|---|
| `APNS_KEY_ID` | 10-char key ID | Apple Developer → Keys |
| `APNS_TEAM_ID` | 10-char team ID | Apple Developer → Membership |
| `APNS_PRIVATE_KEY` | Full contents of `AuthKey_<KEYID>.p8` (paste the entire file including the `-----BEGIN PRIVATE KEY-----` header and the `-----END PRIVATE KEY-----` footer) | Apple Developer → Keys |
| `APNS_BUNDLE_ID` | `com.taxottic.app` | Hardcoded |
| `APNS_PRODUCTION` | `1` once you've moved to production builds. **Leave UNSET for TestFlight builds** — they require the sandbox host. | — |

### Gate flag (both platforms)

| Name | Value |
|---|---|
| `NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED` | `1` |

> **Important — the gate flag is `NEXT_PUBLIC_*`, which means it's baked into the client JS at build time. Vercel needs to *redeploy* after you set it.** Click "Redeploy" on the latest production deployment.

After saving, Vercel will redeploy the site. The new build serves a JS bundle where `CapacitorNativeInit.tsx` will actually call `PushNotifications.register()`.

---

## Step 4 — Rebuild Android (one-time, picks up `google-services.json`)

The `google-services.json` you dropped in `android/app/` is a build-time asset. Existing APKs / Play Store builds don't have it yet.

1. From your repo on your dev machine:
   ```bash
   npm run build
   npx cap sync android
   cd android
   ./gradlew assembleRelease
   ```
2. The signed APK lands at `android/app/build/outputs/apk/release/`.
3. Sideload via `adb install -r <apk>` or upload to Play Console.

> If you've already provisioned the **android-release.yml** workflow with `google-services.json` as a CI secret, you can just trigger that workflow instead and the AAB will be pushed to Play Console for the next testing track.

---

## Step 5 — Rebuild iOS (one-time, picks up Push capability)

1. Trigger the **ios-release.yml** workflow on GitHub Actions:
   ```bash
   gh workflow run ios-release.yml --ref main \
     -f build-notes="Enable native push notifications"
   ```
2. Wait ~15 min for the archive + Apple processing.
3. Trigger **ios-testflight-internal.yml** to push the new build to your Techno Testers group:
   ```bash
   gh workflow run ios-testflight-internal.yml --ref main
   ```
4. Install the new TestFlight build on your iPhone.

---

## Step 6 — Verify on device

### On your phone (Android or iOS)

1. Open the freshly-installed Taxottic.
2. Sign in (if not already).
3. iOS only: you'll see the system **"Taxottic would like to send you notifications"** prompt — tap **Allow**.
4. Within ~10 seconds of allow, the device registers with APNs/FCM and `POST /api/push/register` fires. **Verify in Supabase**:
   ```sql
   select platform, left(token, 16) as token_prefix, created_at
   from device_tokens
   where user_id = '<your_user_id>' and revoked_at is null
   order by created_at desc;
   ```
   You should see one row per device.

### Send a test push

The easiest way: seed an unclassified mileage trip (same pattern we've been using for demo testing), which fires the producer:

```sql
insert into public.mileage_trips
  (company_id, driver_user_id, started_at, ended_at,
   distance_miles, classification, tax_year, deduction_cents)
values
  ('<your_company_id>', '<your_user_id>',
   now() - interval '15 minutes',
   now() - interval '3 minutes',
   4.2, 'unclassified', 2026, 0);
```

But the producer is in `/api/mileage/ingest`, not in raw inserts. To actually fire `notify()` from a SQL insert, you'd need a Postgres trigger we haven't built yet. **The cleanest test is to take a real drive** and let the ingest endpoint fire the producer naturally.

For an immediate smoke test, you can hit the existing helper from a server-side route or temporarily add a debug endpoint. (Ask Claude to add one if you want — I left it out so we don't ship a backdoor.)

### Read the logs

Vercel logs (production runtime) will show one line per `notify()` call:

```
[push] trip_classify user=<uid> sent=true delivered=1 revoked=0
```

- `sent=true` → dedupe claim won; the producer actually fanned out (vs. `sent=false` = already sent this event before, by design).
- `delivered=N` → how many device tokens APNs/FCM accepted. With NoopProvider (no creds), this is always 0 even when `sent=true` — the answer to "did my producer fire?" decoupled from "did the network deliver?".
- `revoked=N` → tokens APNs/FCM said are dead. The `device_tokens` row gets marked revoked automatically; user re-registers on next launch.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| App crashes on launch (Android) | `google-services.json` missing from the APK | Step 4 — make sure it's at `android/app/google-services.json` before `./gradlew assembleRelease` |
| `device_tokens` stays empty after sign-in | `NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED=1` not set, or Vercel hasn't redeployed since you set it | Set the env var in Vercel → Settings → Environment Variables, then click Redeploy on the latest deployment |
| iOS device doesn't show the permission prompt | Push Notifications capability not enabled on the App ID | developer.apple.com → Identifiers → `com.taxottic.app` → Capabilities → enable Push Notifications, then rebuild iOS |
| Push delivered=0 in logs but token is registered | Wrong `APNS_PRODUCTION` setting | TestFlight = unset (sandbox). Play Store / App Store production = `1` |
| APNs returns 403 BadDeviceToken | `APNS_BUNDLE_ID` doesn't match the binary's bundle id | Should be `com.taxottic.app` exactly |
| FCM returns 404 UNREGISTERED | Token revoked (user uninstalled). `revokeToken` runs automatically | No fix needed; will register again on next launch |

---

## What's NOT in this runbook

- **Web push.** Out of scope for Phase 1. Requires VAPID keys + a service-worker handler. The browser-side notification surface today is the in-app amber banner on `/mileage` — sufficient for PWA usage.
- **Interactive action buttons** ("Business" / "Personal" right on the notification). The plumbing is there (`category: "TRIP_CLASSIFY"`); we still need to register the iOS `UNNotificationCategory` + Android `NotificationChannel` with action buttons. Follow-up PR.
- **Rich notifications** (thumbnails, expanded views). Same — follow-up.

---

## Once it's working — what to test

1. Real drive → stop → wait 5 min → drive ends. Should get a phone push: **"New drive logged — Was this trip for business?"**
2. Tap notification → opens Taxottic at `/mileage/classify` swipe deck.
3. Swipe → classifies, totals update everywhere (money-out, my-deductions, forecast).
4. Same trip should NOT push a second time (notification_log dedupe).
5. Watch (if paired) still buzzes + jumps to Confirm tab in parallel.
