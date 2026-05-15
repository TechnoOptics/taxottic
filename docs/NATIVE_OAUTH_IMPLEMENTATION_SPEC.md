# Native OAuth — single-pass implementation spec

**Goal:** the iOS "Sign in with Apple" system sheet and the native
Google account sheet, **no browser**, returning an ID token handed
straight to Supabase via `signInWithIdToken()` so the session is
created directly in the Capacitor WebView.

**Why this doc exists:** native sign-in cannot be verified by web
deploys or by writing code blind — it only proves out with an
Xcode/Android build on a real device. This spec exists so the
build happens **once, correctly**, instead of iterating. Whoever
runs the native build+device loop (a developer, or an AI agent
*with* a real build/test feedback loop) executes this top to
bottom.

**Hard prerequisite reality:** the build currently on TestFlight
(v8) has none of this native code. Every web redeploy "doesn't fix
it" because the capability isn't in the installed binary. Only a
new build that compiles in the plugin + the provider config below
will work.

---

## 0. Decisions

- **Plugin:** `@capgo/capacitor-social-login` — actively maintained,
  does native Apple **and** Google, tracks current Capacitor.
  Validate the peer range against Capacitor 8 at install
  (`npm i @capgo/capacitor-social-login` — if it refuses Cap 8,
  use the **fallback** in §6).
- **Flow:** native sheet → ID token → `supabase.auth.signInWithIdToken`.
  No `@capacitor/browser`, no custom scheme, no `/auth/callback`
  for the native path.
- **Providers:** Apple + Google native. **Microsoft (azure) stays
  on the existing web flow** — no clean native SDK; acceptable.
- **Graceful degradation is mandatory** (lesson from regression
  #69): every native entry point must check
  `Capacitor.isPluginAvailable(...)` and return `{handled:false}`
  on a binary without the plugin so the caller falls back instead
  of hard-erroring.

---

## 1. Dependency

```
npm install @capgo/capacitor-social-login
npx cap sync
```
Commit the updated `package.json` **and** `package-lock.json`
together (CI runs `npm ci` — an out-of-sync lockfile fails the
build; this bit us with Playwright + jsonwebtoken already).

---

## 2. Web bridge — `lib/capacitor/native-auth.ts` (new)

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type NativeSignInResult = { handled: boolean; error?: string };

async function pluginReady(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform()
      && Capacitor.isPluginAvailable("SocialLogin");
  } catch { return false; }
}

async function nonce() {
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  const raw = [...b].map(x => x.toString(16).padStart(2,"0")).join("");
  const d = await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(raw));
  const hashed = [...new Uint8Array(d)]
    .map(x => x.toString(16).padStart(2,"0")).join("");
  return { raw, hashed };
}

export async function nativeSignIn(
  supabase: SupabaseClient,
  provider: "apple" | "google" | "azure",
): Promise<NativeSignInResult> {
  if (provider === "azure") return { handled: false };
  if (!(await pluginReady())) return { handled: false };
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  try {
    if (provider === "apple") {
      const { raw, hashed } = await nonce();
      const r = await SocialLogin.login({
        provider: "apple",
        options: { scopes: ["email","name"], nonce: hashed },
      });
      const token = (r.result as any)?.idToken;
      if (!token) return { handled: true, error: "No Apple identity token." };
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "apple", token, nonce: raw,
      });
      return error ? { handled: true, error: error.message }
                   : { handled: true };
    }
    // google
    const r = await SocialLogin.login({
      provider: "google", options: { scopes: ["email","profile"] },
    });
    const token = (r.result as any)?.idToken;
    if (!token) return { handled: true, error: "No Google ID token." };
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google", token,
    });
    return error ? { handled: true, error: error.message }
                 : { handled: true };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/cancel|closed|12501/i.test(m)) return { handled: true }; // user bailed
    return { handled: true, error: m };
  }
}
```
(API shape: confirm `SocialLogin.login` / result field names against
the installed plugin's README — they shift between majors. The
*structure* — provider sheet → idToken → signInWithIdToken — does
not.)

---

## 3. Wire into `app/login/page.tsx`

Inside `oauth(provider)`, **before** the existing
`if (await isNativeApp())` browser-bridge block:

```ts
if (await isNativeApp()) {
  const nz = await nativeSignIn(supabase, provider);
  if (nz.handled) {
    if (nz.error) setError(/* reuse existing friendly mapping */);
    else window.location.assign(next);
    return;
  }
  // handled:false → fall through to the existing nativeOAuthSignIn
  // browser bridge, then web. No hard error on old binaries.
}
```

`SocialLogin` is initialized once at app start (root client
component, mirror of `<CapacitorAuth/>`):
```ts
SocialLogin.initialize({
  google: { iOSClientId: "<IOS_CLIENT_ID>",
            webClientId: "<WEB_CLIENT_ID>" },
  apple: { clientId: "com.taxottic.app" },
});
```

---

## 4. iOS native config

**Sign in with Apple**
1. Create `ios/App/App/App.entitlements`:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
     "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>com.apple.developer.applesignin</key>
     <array><string>Default</string></array>
   </dict></plist>
   ```
2. In Xcode (or pbxproj) set `CODE_SIGN_ENTITLEMENTS =
   App/App.entitlements` for **both** Debug and Release.
3. **developer.apple.com → Identifiers → `com.taxottic.app` →
   enable "Sign In with Apple".** (User-gated. Without this the
   CI automatic-signing build won't provision the capability.)

**Google**
4. Google Cloud Console → Credentials → Create OAuth client →
   **iOS**, bundle id `com.taxottic.app`. Note the **iOS client
   ID** and its **reversed client ID**.
5. Add the reversed client ID to `Info.plist` `CFBundleURLTypes`
   (a second URL type alongside the existing one):
   ```xml
   <dict>
     <key>CFBundleURLSchemes</key>
     <array><string>com.googleusercontent.apps.XXXX</string></array>
   </dict>
   ```

---

## 5. Android native config

1. Google Cloud → Create OAuth client → **Android**, package
   `com.taxottic.app`, signing-cert SHA-1 from the upload
   keystore:
   `keytool -list -v -keystore taxottic-upload.jks` → copy SHA1.
2. Create the **Web** OAuth client too (this is the
   `serverClientId` / `webClientId`).
3. Drop `google-services.json` into `android/app/` (git-ignored;
   inject in CI like the keystore, or commit if acceptable).
4. Apple on Android = no native SDK → `nativeSignIn` returns
   `{handled:false}` for apple on Android and the web flow is
   used. Acceptable.

---

## 6. Fallback if `@capgo/capacitor-social-login` won't take Cap 8

Ship **Apple-native only** (highest value on iOS, fewest external
deps) via `@capacitor-community/apple-sign-in` (more likely Cap-8
compatible), keep **Google + Microsoft on the existing web/in-app-
browser bridge** (auth-bridge.ts, already merged) which is at
least non-erroring after #69. Apple-native alone makes iOS "feel
native" for the primary path and unblocks App Store (Apple
mandates Sign in with Apple when other socials are offered).

---

## 7. Supabase dashboard (user-gated — REQUIRED or tokens reject)

- **Auth → Providers → Google:** enable. In **"Authorized Client
  IDs"** add **both** the **iOS client ID** and the **Web client
  ID**. The native sheet's ID token has the iOS client as
  audience; without it listed, `signInWithIdToken` rejects.
- **Auth → Providers → Apple:** enable. For native, add bundle id
  `com.taxottic.app` to the allowed client IDs (plus the
  Services ID/key if you also keep a web Apple path).

---

## 8. Build + verify loop (the part that needs a device)

1. `npx cap sync`
2. Dispatch **iOS — TestFlight** + **Android — Play Internal**
   workflows (existing, working).
3. Dispatch **iOS — Distribute build to TestFlight internal
   testers** (`group_name=Techno Testers`) to push the new build
   to the group.
4. Install on a real device via TestFlight / Play internal.
5. Tap Apple, then Google: confirm the **native sheet** appears
   (no Safari/Chrome chrome) and you land signed-in in the app.
6. Only when device-verified: promote / widen testers.

---

## Ordered execution checklist

- [ ] §1 install plugin + sync lockfile
- [ ] §7 Google Cloud: iOS + Android + Web OAuth clients
- [ ] §3 §4.1-2 §4.5 code + iOS entitlements + URL scheme
- [ ] §4.3 enable Sign In with Apple on the App ID (user)
- [ ] §5 Android google-services.json + SHA-1 (user)
- [ ] §7 Supabase: Google Authorized Client IDs + Apple provider (user)
- [ ] §8 build → distribute → **device test** → confirm native sheets
- [ ] only then: widen rollout

---

## Appendix A — Apple Developer Support: entity-name correction

If `developer.apple.com → Account → Membership → Entity Name`
reads anything other than **Techno Optics LLC**, file this at
App Store Connect → Contact Us → "Membership, Account &
Organization Structure":

> **Subject:** Legal entity name correction — Team ID [10-char Team ID]
>
> Our Apple Developer Program organization is enrolled under a
> legal entity name that needs correcting to our current
> registered company name. Please update the organization/entity
> name from its current value to **"Techno Optics LLC"**, the
> legal name under which the company is registered (D-U-N-S on
> file). This is a name correction for the **same legal entity**
> — no change of ownership and no account transfer. As Account
> Holder I can provide the Certificate of Formation / amended
> Articles of Organization and the D-U-N-S record showing
> "Techno Optics LLC". Please advise the documentation required
> so our App Store developer name displays correctly before our
> first public release.

This framing (same-entity correction, docs pre-offered, pre-launch
urgency) is the fast path; an "account transfer" framing is slow.
