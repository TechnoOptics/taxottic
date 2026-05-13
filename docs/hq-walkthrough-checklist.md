# Three-portal walkthrough checklist (HQ + Enterprise)

Use this when you (or an auditor) need to validate that
`hq.taxottic.com` AND `enterprise.taxottic.com` are in a known-good
state. The May 2026 third-party audit flagged P1-5: the audit
couldn't complete a live HQ walkthrough in their browser session, so
the HQ findings were inferred from header parity rather than
observed. This file is the test plan that closes that gap, updated
for the three-subdomain split.

Run end-to-end at least once per quarter, and any time the
`/admin/**` routes get a non-trivial change.

---

## How the three portals are wired

- **Consumer app** lives at `taxottic.com`. Anyone can sign up.
- **Enterprise** lives at the real subdomain `enterprise.taxottic.com`,
  with its own session cookie scoped to that host. Root URL renders
  the firms console.
- **HQ** lives at the real subdomain `hq.taxottic.com`, with its own
  session cookie scoped to that host. Root URL renders the
  super-admin overview.
- The middleware (`lib/supabase/middleware.ts`) recognises both admin
  hosts and rewrites paths into the shared `/admin/**` route tree.
  On `hq.taxottic.com` the root rewrites to `/admin`; on
  `enterprise.taxottic.com` the root rewrites to `/admin/firms`.
- Each route's own `requireSuperAdmin` (from `lib/auth.ts`) does the
  role check — middleware only confirms a session exists.
- Anyone whose email is in `public.super_admins` (seeded with
  `contact@taxottic.com` and `contact@technooptics.com`; SQL in
  `supabase/migrations/20260428000001_tenancy_schema.sql`) passes. Any
  other signed-in user is redirected to `/dashboard` on the customer
  origin.
- All three subdomains require their OWN sign-in. There is no shared
  parent-domain cookie.

---

## Pre-flight

Before starting the walkthrough:

- [ ] Production: confirm `hq.taxottic.com` resolves and serves a TLS
      certificate that isn't about to expire.
- [ ] Sign out everywhere first. Use the "Switch accounts" item in the
      profile menu so the next sign-in shows the Google / Microsoft
      account picker explicitly. Avoid relying on a previously
      authenticated browser tab — that's how the May 2026 audit lost
      visibility.
- [ ] Decide which super-admin email you'll be signing in with.
- [ ] Capture screenshots as you go; auditors will ask.

## Sign-in surface (`/login` on hq.taxottic.com)

- [ ] Wordmark renders, "Sign in to forecast your taxes." subtitle
      shows. (P3 follow-up: differentiate this string from the
      consumer login to make the audience clear — see TODO at the
      bottom.)
- [ ] All four sign-in methods visible (Google, Microsoft if
      `NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true`, passkey, magic link).
- [ ] CPA disclaimer renders below the auth card.
- [ ] Inspect response headers (DevTools or `curl -I`):
  - [ ] `Strict-Transport-Security` present
  - [ ] `X-Frame-Options: DENY`
  - [ ] `Content-Security-Policy` enforced (not report-only)
  - [ ] `Cross-Origin-Opener-Policy: same-origin-allow-popups`
  - [ ] `Permissions-Policy` denies ≥ 19 features
  - [ ] `Access-Control-Allow-Origin` ABSENT (was wildcard pre–
        May 2026 audit; the middleware now deletes it)
  - [ ] `X-Powered-By` ABSENT (we set `poweredByHeader: false`)
- [ ] Sign in with the chosen super-admin email.

## HQ home

After sign-in you should land on `hq.taxottic.com/` which internally
renders `/admin`.

- [ ] AppHeader shows the wordmark linking to `/` (admin home, not
      `/dashboard`).
- [ ] Profile dropdown shows the **Switch portal** section with three
      options: Consumer app, Enterprise, HQ — with HQ marked "Current".
- [ ] Clicking "Consumer app" sends you to `taxottic.com/dashboard`
      (cross-origin redirect, with `setActivePlatform` form action
      persisting `profile.active_platform = 'user'`).
- [ ] Clicking "Enterprise" sends you to `hq.taxottic.com/firms`.
- [ ] **Switch accounts** item is present and works (forces the OAuth
      account picker on the next sign-in).
- [ ] Bella FAB is NOT visible on HQ pages (admin pages set
      `homeHref="/"` which suppresses Bella).

## User inventory (`/users`)

- [ ] Page lists users without a "load all rows" obvious cost (search
      / pagination present).
- [ ] Each row links to `/admin/user/<id>` (or its internal equivalent
      `/user/<id>` on the HQ host).
- [ ] You can click into a user's detail page without an error.
- [ ] The detail page shows: email, plan tier, sign-up date,
      last-login, badge count, super-admin flag.
- [ ] Sensitive fields (e.g. `auth.users.encrypted_password`) are
      NOT shown. Sample a row to confirm.

## Company inventory (`/companies` or `/admin/companies`)

- [ ] Page lists every company across all tenants.
- [ ] Search by `public_id` works (paste `co_q5tejq7b7x` etc.).
- [ ] Clicking a row shows the company's members, plan tier of the
      owner, and recent activity.
- [ ] Confirm the company's `created_at` and last-bank-sync timestamp.

## Firms list (`/firms`)

- [ ] Lists all firms (firm-tier subscribers), each with their seat
      count and active engagements.
- [ ] Clicking a firm shows its client roster, subscription state,
      and engagement history.

## Plan / subscription roll-ups

- [ ] A "subscriptions" or "billing" section shows aggregate counts
      by tier (free / filer / solo / studio / scale / practice).
- [ ] Trial-fraud guardrails: the count of users whose
      `profiles.trial_validated_at` is null should be small and
      decreasing — confirm the trial-guard cron is firing.
- [ ] Spot-check a paid subscription: open it, then open Stripe and
      confirm the `stripe_subscription_id` matches.

## Daily probes

- [ ] A probes or monitoring tile shows yesterday's smoke-test
      results: dashboard render, forecast compute, Plaid sync,
      Bella round-trip. Each should be green.
- [ ] If any are red, the failure details surface here — not just
      "red".

## Crash reports

- [ ] If there's a crash-report panel, walk through the most recent
      10 entries. Each should have a stack trace and the request URL.

## Impersonation tooling

If HQ exposes a "sign in as <user>" feature:

- [ ] Activating it prompts for a typed reason.
- [ ] The reason is logged to an audit table (or at minimum to
      structured logs).
- [ ] The impersonated session has an expiry (an hour, by default).
- [ ] The customer-facing UI shows a coloured banner while
      impersonation is active ("Acting as Riley Chen — End session").
- [ ] Ending the session reliably restores the original super-admin
      session.

If impersonation is NOT yet wired, add it as a follow-up before HQ is
opened to operators beyond the founding super-admins.

## Enterprise subdomain (`enterprise.taxottic.com`)

The enterprise portal is the firms console served at a separate
subdomain so firm operators don't see the HQ super-admin overview
on root.

- [ ] `enterprise.taxottic.com` resolves (DNS CNAME → Vercel) and
      serves a valid TLS cert.
- [ ] Visiting the root unauthenticated lands on `/login` with the
      HQ-style "Sign in to the Taxottic cockpit." subtitle (the
      login page detects either admin host).
- [ ] Sign in as super-admin. You should be rewritten into
      `/admin/firms` (the firms console) automatically — the middleware
      handles this without a visible redirect.
- [ ] Profile menu → Switch portal lists three options:
      Consumer app · Enterprise (Current) · HQ.
- [ ] Clicking "HQ" issues a cross-origin redirect to
      `hq.taxottic.com/`. The destination loads cleanly with its own
      sign-in (or a re-use of the already-active super-admin session
      via OAuth — verify the consent step doesn't surprise you).
- [ ] Header probe (DevTools or `curl -I`) on
      `enterprise.taxottic.com`:
  - [ ] Same security headers as HQ (CSP, COOP, X-Frame-Options,
        HSTS, Permissions-Policy)
  - [ ] `Access-Control-Allow-Origin` ABSENT
  - [ ] `X-Powered-By` ABSENT

## Cross-origin checks (all three portals)

- [ ] On a fresh browser, sign in to the consumer app at
      `taxottic.com`. Verify that navigating to `hq.taxottic.com`
      AND `enterprise.taxottic.com` each require their OWN sign-in
      (no shared session). The cookie scope is host-only by design;
      this confirms it in production.
- [ ] On a second browser profile that's NOT in `super_admins`, sign
      in to `taxottic.com`, then navigate to `hq.taxottic.com` and
      `enterprise.taxottic.com`. You should hit `/login` on each,
      sign in, then be redirected to `/dashboard` on the consumer
      origin. Confirm super-admin protection works on BOTH admin
      subdomains.

## Tear-down

- [ ] Sign out from HQ using the profile menu's "Sign out".
- [ ] Confirm the `sb-*-auth-token` cookies are gone for both hosts.
- [ ] Open `taxottic.com/dashboard` and confirm you're prompted to
      sign in (defense against the May 2026 cross-tenant leak that
      was fixed in `app/auth/signout/route.ts`).

## Notes for the next auditor

- The May 2026 cross-product Google identity observation is explained
  in `/legal/security` &raquo; "Single sign-on across Techno Optics
  products". The TL;DR is: each product has its own Supabase project;
  what reuses is the Google account, not the session cookie. If you
  see one Google identity granting access to both Advottic and
  Taxottic, that's expected — but each product still required its own
  OAuth consent and the sessions are independent.
- If the page renders OK but a header is missing, the most likely
  cause is a Vercel project-config drift (someone added a header
  override at the platform level). Compare against
  `next.config.ts` `securityHeaders` and reconcile.

## Open follow-ups

- [ ] Differentiate the HQ `/login` subtitle from the consumer one
      so the audience is unambiguous. Today both say "Sign in to
      forecast your taxes." HQ should read something like "Sign in
      to the Taxottic cockpit." Tracked as a P3 from the May 2026
      audit.
- [ ] If impersonation isn't wired yet, scope and ship it before HQ
      access expands beyond the founding super-admins.
