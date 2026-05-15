# Operator checklist — the irreducible human work

Everything Claude can automate IS automated (CI builds + uploads
for both stores). What's left can't be done by anyone but you,
because it requires your account passwords, your private signing
keys, and your legal attestations. This is the exact sequence.

Estimated time: **~60–90 min total**, split as:
- Android path: ~30 min, ship today (builds on Windows via CI)
- iOS path: ~30 min, no Mac needed (CI uses a macOS runner)
- Both gated only on dashboard setup + the payment decision

Work top to bottom. Each step is a dashboard click or a command
**you** run. Claude never touches a credential or key.

---

## STEP 0 — The one decision to make first (blocks both stores)

**Payment compliance.** Subscriptions are sold on the web via
Stripe (`/billing`). Both stores have rules about this.

Pick one and write it down:

- **A — External link (keep Stripe, ~3% fees):** Apply for
  Apple's "External Link Account Entitlement" and Google's
  equivalent. App links out to the browser for purchase. Apple
  still takes 27% on purchases within 7 days of the link.
- **B — In-App Purchase (30% Apple / 15–30% Google):** Wire
  `@revenuecat/purchases-capacitor`. More work, zero rejection
  risk on payment grounds.
- **C — Submit as "view + use only" (highest rejection risk):**
  No purchase path in-app at all; users subscribe on the web
  separately before logging in. Some finance apps pass this;
  many get a 3.1.1 rejection.

Recommendation for v1: **A**. It preserves your margin and the
runbook documents the exact disclosure-modal requirement. Decide
now — the App Review notes and the build must match the choice.

---

## ANDROID PATH (can finish today, from Windows)

### 1. Generate the upload keystore (you hold it)
```powershell
./scripts/generate-android-keystore.ps1
```
Follow its prompts; it copies the base64 to your clipboard and
prints the exact `gh secret set` commands. Run those commands
yourself. Back up the `.jks` in a password manager.

### 2. Play Console — create the app
- console.play.google.com → **Create app**
- App name: `Taxottic` · Default language: English (US)
- App or game: **App** · Free or paid: **Free**
- Accept the declarations
- App content → fill from `PRIVACY_DATA_MAP.md` + `CONTENT_PACK.md`:
  - Privacy policy: `https://taxottic.com/legal/privacy`
  - Data safety: copy the Play table from `PRIVACY_DATA_MAP.md`
  - Content rating: run the IARC questionnaire → answers all
    "None" → Everyone
  - Target audience: 18+
  - Financial features declaration: see `CONTENT_PACK.md`
  - Government apps: N/A

### 3. Enable Play App Signing
On first release Play offers "Use Play App Signing" — **accept
it**. Google then holds the real release key; your `.jks` is just
the upload key (recoverable if lost). This is the single most
important "don't skip" in the whole process.

### 4. Play service account (for CI upload)
- console.cloud.google.com → same org → IAM → Service Accounts →
  Create → role "Service Account User"
- Create a JSON key → download as `play-service-account.json`
- Play Console → Users and permissions → Invite the service
  account email → grant **Release manager** on the Taxottic app
- `gh secret set PLAY_SERVICE_ACCOUNT --body (Get-Content play-service-account.json -Raw)`
- Delete `play-service-account.json` locally afterward

### 5. Fire the build
GitHub → Actions → **Android — Play Internal Track** → Run
workflow (track: `internal`). It builds the signed AAB and pushes
to the Internal Testing track in ~10 min.

### 6. Smoke test → promote
- Play Console → Testing → Internal → add your email as a tester
- Install via the opt-in link, click through the app
- When happy: Play Console → promote the release to **Production**
  (or Closed/Open testing first if you want a wider beta)
- First production review: 1–3 days

---

## iOS PATH (no Mac needed — CI runs the macOS build)

### 1. Get the 4 App Store Connect secrets (browser only, ~5 min)
All from appstoreconnect.apple.com / developer.apple.com:

- `IOS_TEAM_ID` — developer.apple.com → Membership → Team ID
- `ASC_KEY_ID` — App Store Connect → Users and Access → **Integrations / Keys** → "+" → role **Admin** → download the `.p8` ONCE → the Key ID shows in the list
- `ASC_ISSUER_ID` — top of that same Keys page
- `ASC_PRIVATE_KEY` — open the downloaded `AuthKey_XXX.p8` in a
  text editor; copy the entire contents including the
  `-----BEGIN PRIVATE KEY-----` header

Set them (run yourself):
```powershell
gh secret set IOS_TEAM_ID     --body '<team id>'
gh secret set ASC_KEY_ID      --body '<key id>'
gh secret set ASC_ISSUER_ID   --body '<issuer id>'
gh secret set ASC_PRIVATE_KEY --body (Get-Content AuthKey_XXXX.p8 -Raw)
```
Then delete the `.p8` locally (it's downloadable only once, so
also stash a copy in your password manager first).

### 2. App Store Connect — create the app record
- appstoreconnect.apple.com → Apps → "+" → New App
- Platform iOS · Name `Taxottic` · Primary language English (US)
- Bundle ID: `com.taxottic.app` (register it under
  developer.apple.com → Identifiers first if it isn't listed)
- SKU: `taxottic-ios-001` (any unique string)

### 3. Fill the listing
From `CONTENT_PACK.md`: subtitle, promo text, description,
keywords, support/marketing URLs, age rating (4+), and the App
Review notes block — **paste a real temp password into the demo
account line before submitting**.

From `PRIVACY_DATA_MAP.md`: the App Privacy section. "Used to
track you" = None. Export compliance = exempt (already matches
Info.plist).

### 4. Create the demo account
Sign up at taxottic.com with `review@taxottic.com`, set a temp
password, and make sure it has seeded sample books so every
screen is populated (use an existing demo company if you have
one). Put that password in the App Review notes.

### 5. Fire the build
GitHub → Actions → **iOS — TestFlight** → Run workflow. The
macOS runner archives with automatic signing via your ASC key
and uploads to TestFlight in ~20–30 min. No Mac on your side.

### 6. TestFlight → submit for review
- App Store Connect → TestFlight → the build appears after
  processing (~15 min) → add yourself as an internal tester →
  install via the TestFlight app → smoke test
- When happy: App Store → the version → add the build → **Submit
  for Review**
- Apple review SLA: typically 24–72h

---

## Screenshots (one-time, manual — both stores)

See `CONTENT_PACK.md` "Screenshots" for the exact flows + sizes.
Capture from the demo account. Android: Windows emulator. iOS:
Simulator on any Mac or the CI box. There's no automated
screenshot step — this is the only genuinely manual asset work.

---

## What "done" looks like

- [ ] STEP 0 payment decision recorded
- [ ] Android: keystore generated, 5 secrets set, app created,
      Play App Signing on, build run, promoted to production
- [ ] iOS: 4 secrets set, app record created, listing + privacy
      filled, demo account live, build run, submitted for review
- [ ] Screenshots uploaded to both
- [ ] Both apps "In Review" / "Pending"

After approval, every future web change is live on mobile with
**zero resubmission** (Capacitor loads taxottic.com). You only
re-run a workflow + resubmit when native config or plugins
change.

---

## Why Claude can't do these for you (not a cop-out — the actual reasons)

1. **Passwords:** logging into your Apple/Google accounts means
   handling your credentials. That's the textbook way accounts
   get compromised. You log in; never share the password.
2. **Signing keys:** the `.jks` and `.p8` are private keys that
   *are* your publishing identity. If anyone else generates or
   holds them, they can ship malware as you. You generate; you
   hold.
3. **Legal attestations:** privacy labels, export compliance,
   content ratings, and the developer agreements are *your*
   legal representations to Apple/Google. Only you can make them.

Everything outside those three categories is automated.
