# Native (Capacitor) auth runbook

Why this exists: native Google/Apple sign-in in the Taxottic app depends on
config that lives **outside the repo** (the Supabase dashboard) plus a plugin
in the installed binary. When any piece is missing the flow fails *silently* —
the in-app browser opens, you authenticate, and you're never returned to the
app. In July 2026 a missing Supabase redirect-URL entry cost hours of on-device
log forensics. This runbook + the watchdog below exist so it can't recur quietly.

## How native OAuth works here

The app is a Capacitor WebView over `https://taxottic.com` (`server.url` in
`capacitor.config.ts`). Google blocks OAuth inside an embedded WebView, so the
login page uses a native bridge (`lib/capacitor/auth-bridge.ts`):

1. `signInWithOAuth({ redirectTo: "com.taxottic.app://auth-callback", skipBrowserRedirect: true })`
2. Opens the returned URL in an in-app Chrome Custom Tab / SFSafariViewController
   (`@capacitor/browser`).
3. After auth, Supabase redirects to `com.taxottic.app://auth-callback`.
4. The OS routes that deep link into the app; `appUrlOpen` fires; the WebView
   runs `exchangeCodeForSession` and navigates to the destination.

If **any** of steps 2–4 is misconfigured, the user is stranded in the browser.

## Required config checklist

- [ ] **Supabase → Authentication → URL Configuration → Redirect URLs** must
      include ALL of:
  - `com.taxottic.app://auth-callback`  ← the native deep link (the one that
        was missing; without it Supabase falls back to the Site URL and never
        returns to the app)
  - `https://taxottic.com/auth/callback`  ← the web callback
  - any preview/enterprise origins you sign in from
- [ ] **`@capacitor/browser`** is in `package.json` AND compiled into the
      installed binary. Verify after a build: `android/app/src/main/assets/capacitor.plugins.json`
      lists `@capacitor/browser`. An old binary without it silently degrades to
      the web flow.
- [ ] **Custom scheme registered natively** (already in repo — verify if you
      regenerate the native projects):
  - iOS: `ios/App/App/Info.plist` → `CFBundleURLTypes` includes `com.taxottic.app`
  - Android: `AndroidManifest.xml` → intent-filter with
    `VIEW` + `DEFAULT` + `BROWSABLE`, `scheme="com.taxottic.app"` `host="auth-callback"`
- [ ] **Google Cloud / Apple provider** redirect URIs point at Supabase's
      callback (`https://<ref>.supabase.co/auth/v1/callback`), configured in the
      Supabase provider settings.

## The safety net (in code)

`lib/capacitor/auth-bridge.ts` now arms a watchdog when it opens the OAuth
browser and disarms it when the `com.taxottic.app://auth-callback` deep link
returns. If the app resumes with the watchdog still armed and no session, it
redirects to `/login?error=oauth_no_return`, which shows: *"Sign-in opened but
didn't return to the app… use the email code below."* So a future misconfig is
loud and gives the user a working path (email OTP), instead of a silent hang.

## When native OAuth breaks, in order

1. Reproduce on-device and read the log:
   `adb logcat -d | grep -iE "appUrlOpen|CustomTab|auth-callback"`.
   - `appUrlOpen` count = 0 and no `com.taxottic.app://` intent → the redirect
     never came back → **check the Supabase redirect allow-list first.**
   - `CustomTabActivity` present → the native bridge engaged (plugin OK).
2. Confirm the installed binary has `@capacitor/browser` (stale build?).
3. Confirm the four checklist items above.
4. Interim: the **email 6-digit code** always works (no redirect, stays in the
   WebView).

## Verifying redirect URLs without the dashboard (optional)

The allow-list can be read/set via the Supabase Management API
(`GET/PATCH /v1/projects/{ref}/config/auth`, field `uri_allow_list`) with a
management token. A CI check that asserts `com.taxottic.app://auth-callback` is
present would catch a regression before a release — worth adding when a token is
available to CI.
