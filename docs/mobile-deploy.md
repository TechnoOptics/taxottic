# Mobile deployment — Taxottic for iOS + Android

Two binaries, one web app behind them. Capacitor wraps the live
`https://taxottic.com` site with a native shell that adds camera,
push notifications, biometric login, and haptics. Stripe billing is
handled on the web (no Apple IAP cut).

---

## One-time account setup (done by you, outside this repo)

| Action | Where | Note |
|---|---|---|
| Apple Developer Program enrollment | developer.apple.com/programs/enroll | $99/yr, requires DUNS for "Taxottic LLC" |
| Google Play Developer | play.google.com/console | $25 one-time, identity verified |
| Apple Bundle ID `com.taxottic.app` | developer.apple.com → Identifiers | Match `capacitor.config.ts` |
| Apple App Store Connect — new app | appstoreconnect.apple.com | Bundle = `com.taxottic.app`, primary lang = English (US) |
| Google Play Console — new app | play.google.com/console | Package = `com.taxottic.app`, app category = Finance |

---

## Required GitHub repo secrets

Set these under **Settings → Secrets and variables → Actions** before
running the workflows.

### iOS (5 secrets)

| Secret | What it is | How to get it |
|---|---|---|
| `IOS_TEAM_ID` | 10-char Apple team ID | developer.apple.com → Membership |
| `ASC_KEY_ID` | App Store Connect API key ID | App Store Connect → Users + Access → Keys → "+" → Admin role → save Key ID |
| `ASC_ISSUER_ID` | Issuer UUID on the same page | App Store Connect → Users + Access → Keys (top of page) |
| `ASC_PRIVATE_KEY` | Contents of `AuthKey_<KEY_ID>.p8` | Download once when you create the key (cannot redownload) |
| `IOS_DIST_CERT_P12` | Base64'd `.p12` of "Apple Distribution: Taxottic LLC" | Apple Developer → Certificates → "+" → Apple Distribution → CSR from Keychain → install → export as `.p12` with password → `base64 -i Cert.p12 \| pbcopy` |
| `IOS_DIST_CERT_PWD` | Password protecting the `.p12` | The one you set when exporting |
| `IOS_PROV_PROFILE` | Base64'd `.mobileprovision` | Apple Developer → Profiles → "+" → App Store → bundle id `com.taxottic.app` → download → `base64 -i *.mobileprovision \| pbcopy` |

### Android (5 secrets)

| Secret | What it is | How to get it |
|---|---|---|
| `ANDROID_KEYSTORE` | Base64'd `.jks` file | `keytool -genkey -v -keystore taxottic.jks -keyalg RSA -keysize 4096 -validity 25000 -alias taxottic-upload` then `base64 -i taxottic.jks \| pbcopy` |
| `ANDROID_KEYSTORE_PWD` | Keystore password | Set during `keytool` |
| `ANDROID_KEY_ALIAS` | `taxottic-upload` (or your alias) | Same as above |
| `ANDROID_KEY_PWD` | Key password | Set during `keytool` |
| `PLAY_SERVICE_ACCOUNT` | Full JSON | console.cloud.google.com → IAM → Service Accounts → "+" → grant "Service Account User" → Keys → JSON. Then Play Console → Users → invite the service-account email with "Release manager" role |

> **Lose your keystore = locked out of Play forever.** Save the .jks +
> the passwords to a password manager. Google's "Play App Signing"
> feature (offered on first upload) reduces this risk by holding the
> release key for you — accept the offer.

---

## How to ship a build

### iOS → TestFlight

1. **Push to main** (or any branch — workflow is `workflow_dispatch`)
2. **Run workflow:** `Actions → iOS — TestFlight → Run workflow`
3. **Wait ~15-20 min** for the macOS runner to provision, sign, archive, and upload
4. **App Store Connect → TestFlight → Builds:** the new build appears under "Processing" for ~10 min, then becomes available
5. **Add internal testers:** TestFlight → Internal Group → invite your email. They install via the TestFlight app on their iPhone

### Android → Play Internal Track

1. **Run workflow:** `Actions → Android — Play Internal Track → Run workflow`
2. **Wait ~5 min** for the Linux runner to build and upload
3. **Play Console → Testing → Internal testing → Releases:** the new release shows as "In review" for ~10 min, then live
4. **Add internal testers:** Internal testing → Testers → "+" → add tester email. They get a Play Store opt-in link

---

## App Store / Play store listings

These are filled in **once** in each console, not from CI.

### Required text

| Field | Value |
|---|---|
| App name | Taxottic |
| Subtitle (App Store, ≤30 chars) | Tax forecasting + AI |
| Short description (Play, ≤80 chars) | Forecast taxes, capture deductions, never miss a quarterly. |
| Full description | (see `docs/mobile-listing.md` — drafted) |
| Category | Finance |
| Content rating | 4+ (App Store) / Everyone (Play) |
| Support URL | https://taxottic.com/help |
| Privacy policy URL | https://taxottic.com/legal/privacy |
| Marketing URL | https://taxottic.com |

### Privacy disclosures

See `docs/mobile-privacy-disclosure.md` for the exact answers to
Apple's App Privacy and Google's Data Safety questionnaires —
mapped from our actual stack (Plaid, Stripe, Anthropic, Supabase,
Vercel).

---

## What lives where

```
capacitor.config.ts          Bundle id, server URL, plugin config
ios/                         Generated Xcode project — open via npx cap open ios
android/                     Generated Gradle project — open via npx cap open android
assets/                      Source icon + splash; regenerate with npx capacitor-assets generate
.github/workflows/
  ios-release.yml            macOS runner → TestFlight
  android-release.yml        Ubuntu runner → Play internal track
docs/
  mobile-deploy.md           This file
  mobile-listing.md          App-store description copy
  mobile-privacy-disclosure.md  Privacy nutrition labels + Data Safety
```

---

## Local development (optional)

You don't need to build native locally — CI does it — but for
testing native plugins on a simulator:

```bash
# Sync latest config + plugin native code to ios/ + android/
npx cap sync

# Open Xcode (Mac only)
npx cap open ios

# Open Android Studio
npx cap open android
```

The WebView always loads `https://taxottic.com` per `server.url`. To
test against `localhost:3000`, comment out `server.url` in
`capacitor.config.ts` and rebuild.

---

## Common rejection reasons (and how we mitigated)

| Reason | Mitigation |
|---|---|
| Apple 4.2 — "minimum functionality" / pure webview | We add real native plugins: camera, push, biometric, haptics. Apple's review needs to see at least one native feature in use. Our receipt-OCR uses the device camera through `@capacitor/camera`. |
| Apple 3.1.1 — IAP required for digital goods | The native app does NOT show buy buttons. The billing page links out to https://taxottic.com/billing. Stripe handles the purchase on web; the user comes back. |
| Apple 5.1.1 — privacy disclosure | All third-party data flows are listed in `docs/mobile-privacy-disclosure.md` and entered in App Privacy. |
| Play "Sensitive permissions" review | We declare the camera permission (receipt OCR) and push (reminders). No SMS, no contacts, no location. |
| Sign-in required without explanation | Login page has a clear "What is Taxottic?" panel for users hitting it cold from the App Store. |

---

## Going from "Internal" → public release

1. **iOS:** App Store Connect → App Store → fill out screenshots (6.7" + 6.5" + 5.5" iPhone, plus iPad Pro), description, age rating questionnaire, App Privacy → submit for review. Approval typically 24-48hr.
2. **Android:** Play Console → Production → Create new release → promote your tested build → fill out screenshots + Data Safety → submit. Approval typically 1-3 days.

After approval, both stores have a "rolling release" toggle — start at 5% of users, promote to 100% once you see no crash spike.
