# Google OAuth verification — exact submission values + copy

Companion to `GOOGLE_OAUTH_VERIFICATION.md` (the click-through walkthrough).
This file is the copy-paste sheet: the precise strings to enter, plus ready
justification text. Everything here reflects the app's ACTUAL config as of
2026-07 (verified against the code).

## The good news: non-sensitive scopes only

The app requests only **`openid`, `email`, `profile`** from Google
(`app/login/page.tsx` passes no explicit Google scopes, so it gets the OIDC
basics; Azure/Apple similarly request only `openid email profile` / `name
email`). None of these are Google "sensitive" or "restricted" scopes, so:

- Verification is the **brand review** (logo, domain, homepage, privacy/terms),
  not the security assessment / annual pentest that Drive/Gmail scopes trigger.
- Turnaround is typically days, not the 1-4 weeks a sensitive-scope app waits.
- No YouTube demo video or CASA assessment is required.

## Exact values to enter (current Supabase-hosted flow)

Sign-in currently routes through Supabase's hosted OAuth (`supabase.auth
.signInWithOAuth`), so Google talks to Supabase and Supabase talks to the app.
That means the **Google OAuth client** only needs the Supabase callback:

**OAuth client → Authorized redirect URIs** (exactly one):
```
https://enisnjjbxqaliydepacc.supabase.co/auth/v1/callback
```

**OAuth client → Authorized JavaScript origins:**
```
https://enisnjjbxqaliydepacc.supabase.co
```

**OAuth consent screen → App domain / Authorized domains:**
```
taxottic.com
```
(Homepage `https://taxottic.com`, Privacy `https://taxottic.com/legal/privacy`,
Terms `https://taxottic.com/legal/terms` — all live.)

**OAuth consent screen → App logo:** `public/brand/icon-mark-512.png`
(now navy, square, 512x512 — meets the 120px minimum).

**Supabase → Auth → URL Configuration → Redirect URLs** must already include
(these are the app's own post-auth targets, not Google's concern, but required
for sign-in to complete):
```
https://taxottic.com/auth/callback
https://hq.taxottic.com/auth/callback
https://enterprise.taxottic.com/auth/callback
com.taxottic.app://auth-callback
```

## About the "to continue to …supabase.co" wording

Clearing the *unverified* warning (above) is separate from the consent screen
saying **"to continue to enisnjjbxqaliydepacc.supabase.co"** instead of
"Taxottic". That happens because the OAuth redirect lands on a domain you don't
own (supabase.co), so Google can't show it as taxottic.com. Two ways to fix the
branding (optional, do after verification clears the warning):

1. **Supabase Custom Auth Domain** (simplest): set `auth.taxottic.com` as a
   Supabase custom domain (Pro feature, CNAME). The callback becomes
   `https://auth.taxottic.com/auth/v1/callback`; swap that into the Google
   client's redirect URI and add `auth.taxottic.com` as an authorized domain.
   The consent screen then reads "to continue to taxottic.com".
2. **On-our-own-domain OAuth**: the dormant `/api/auth/google/start` path was
   built for this but needs `GOOGLE_OAUTH_CLIENT_ID` + the client secret in
   Vercel env. More moving parts; only worth it if you skip Supabase's flow.

## Ready-to-paste copy for the verification form

**App name:** Taxottic

**App description (user-facing, on the consent screen / verification):**
> Taxottic is tax-forecasting software for freelancers, independent
> contractors, and small businesses in the United States. It keeps a running
> estimate of what you will owe, surfaces IRS-cited deductions, and helps you
> set money aside for quarterly taxes. Google sign-in is offered only as a
> convenient, passwordless way to create and access your Taxottic account.

**Why do you need each scope? (scope justification):**
> We request only the basic OpenID Connect scopes (openid, email, profile).
> We use the email address as the account identifier and to send transactional
> notifications (sign-in links, tax-deadline reminders); we use the name and
> profile picture to personalize the account. We do not request access to
> Gmail, Drive, Contacts, Calendar, or any other Google user data, and we do
> not use this data for advertising or share it with third parties. Sign-in is
> one of several optional methods (email code and passkeys are also offered).

**How will the app use Google user data? (data-usage):**
> The email, name, and profile picture returned at sign-in are stored on the
> user's Taxottic profile solely to authenticate them and personalize their
> account. Data handling is described in our Privacy Policy at
> https://taxottic.com/legal/privacy. Users can delete their account and all
> associated data at any time.

## Where I could NOT help

The submit-and-wait itself is inside your Google Cloud Console (your account +
domain ownership) and cannot be done from the codebase. Everything above is
staged so it's a copy-paste job. Interim: new users can proceed via "Advanced
→ Continue", or use the email 6-digit code / passkey, which never touch Google.
