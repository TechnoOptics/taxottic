# Three-portal runbook

Taxottic ships on three real subdomains:

| Portal | Host | Lands on | Who it's for |
|---|---|---|---|
| Consumer | `taxottic.com` | `/dashboard` (signed in) or `/` (anon) | Customers, freelancers, business owners |
| Enterprise | `enterprise.taxottic.com` | `/admin/firms` (firms console) | Firm operators (CPAs, tax-prep firms) |
| HQ | `hq.taxottic.com` | `/admin` (super-admin overview) | Super-admins on the allowlist |

The application code already routes all three. This file is the
**one-time infrastructure setup** for `enterprise.taxottic.com` —
the third subdomain — that lives outside the repo. (HQ was wired
months ago; consumer is the apex.) Do these in order; takes about
15 minutes.

---

## 1. DNS — point `enterprise.taxottic.com` at Vercel

Where: your DNS provider (GoDaddy, given `SETUP.md`).

Add **one** record. Vercel supports both apex-style and a vanity
CNAME — use CNAME because this is a subdomain:

| Type | Host | Value | TTL |
|---|---|---|---|
| `CNAME` | `enterprise` | `cname.vercel-dns.com.` | 600 (10 min) |

Verify when DNS has propagated:

```bash
dig +short CNAME enterprise.taxottic.com
# should print: cname.vercel-dns.com.

curl -I https://enterprise.taxottic.com 2>&1 | head -5
# expect HTTP/2 200 OK once Vercel has issued a cert (step 2 below)
```

Propagation usually completes within 5 minutes. If `dig` still
returns empty after 30 minutes, GoDaddy has a propagation delay
specific to subdomains — check the record was saved with no typo.

---

## 2. Vercel — add the domain to the project

Where: the Vercel dashboard for the Taxottic project.

1. Settings → **Domains** → **Add**.
2. Enter `enterprise.taxottic.com`.
3. Vercel will detect the CNAME from step 1 and issue a TLS
   certificate via Let's Encrypt. This usually takes 30–90 seconds.
4. Once the green check appears next to the domain, the production
   deploy automatically serves traffic for it.

When verifying:

```bash
curl -I https://enterprise.taxottic.com 2>&1 | grep -E "^(HTTP|server|strict)"
# expect:
#   HTTP/2 200
#   server: Vercel
#   strict-transport-security: max-age=63072000; includeSubDomains; preload
```

---

## 3. Supabase — register the OAuth redirect URL

Where: Supabase dashboard → Authentication → URL Configuration.

The OAuth callback URL must be registered with Supabase before
Google/Microsoft will hand back tokens for that origin. Without
this step, a sign-in attempt from `enterprise.taxottic.com` will
fail with `oauth_state_mismatch`.

Add to **Redirect URLs**:

```
https://enterprise.taxottic.com/auth/callback
https://enterprise.taxottic.com/auth/callback?*
```

(The wildcard variant lets the `next=` query param survive.)

Confirm the existing entries are still there:

```
https://taxottic.com/auth/callback
https://taxottic.com/auth/callback?*
https://hq.taxottic.com/auth/callback
https://hq.taxottic.com/auth/callback?*
```

If any are missing, add them too — the May 2026 audit can re-flag
us if HQ's callbacks are not on the list.

---

## 4. Google OAuth — add the new authorized redirect URI

Where: <https://console.cloud.google.com> → APIs & Services → Credentials → the OAuth 2.0 client used by Supabase.

Authorized redirect URIs should already contain the Supabase callback (`https://<project-ref>.supabase.co/auth/v1/callback`); that's the only URL Google needs because Supabase brokers the rest. **No change here** unless you're using the on-our-domain OAuth path (which we deferred — see comment in `app/login/page.tsx`).

If you ever flip the on-our-domain path back on, you'll need
`https://enterprise.taxottic.com/auth/callback` here too.

---

## 5. Microsoft (Azure) OAuth — same check

Where: <https://portal.azure.com> → Microsoft Entra ID → App registrations → the app used by Supabase.

Same logic as Google: the only redirect Azure cares about is the
Supabase callback. No change needed unless we re-enable the
on-our-domain path.

---

## 6. Set the env vars in Vercel

Where: Vercel → Settings → Environment Variables for the Taxottic project.

| Name | Production | Preview | Development |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_ORIGIN` | `https://taxottic.com` | leave unset (Vercel preview URLs) | `http://localhost:3000` |
| `NEXT_PUBLIC_HQ_HOST_LIVE` | `true` (or unset — default is true) | unset | unset |
| `NEXT_PUBLIC_ENTERPRISE_HOST_LIVE` | **leave unset until you've finished steps 1–4 above**, then set to `true` | unset | unset |

`NEXT_PUBLIC_SITE_ORIGIN`: anchors all cross-subdomain redirects. Default is correct for production, but setting it explicitly future-proofs against a custom-domain change.

`NEXT_PUBLIC_HQ_HOST_LIVE` / `NEXT_PUBLIC_ENTERPRISE_HOST_LIVE`: feature flags for the portal switcher. They tell the server action `setActivePlatform` (in `app/settings/actions.ts`) and the dashboard auto-router (in `app/dashboard/page.tsx`) whether to redirect to the subdomain or fall back to the path-based admin shell on the consumer host.

**Why the fallback matters**: if a super-admin clicks Enterprise in the profile menu and `enterprise.taxottic.com` isn't live yet, without the fallback they hit `DNS_PROBE_FINISHED_NXDOMAIN` and have no obvious recovery. With `NEXT_PUBLIC_ENTERPRISE_HOST_LIVE` unset (the default), the same click sends them to `https://taxottic.com/admin/firms` — same content, no DNS dependency. **Only flip the env var to `true` after steps 1–4 above are all green.**

Local development with `localhost` automatically degrades to
path-only redirects (no subdomain), so you don't need to set up a
local `enterprise.localhost` for dev work.

---

## 7. Verify end-to-end

Once steps 1–4 are green, do the smoke test:

```bash
# 1. Three hosts all respond with 200 and the security headers we expect.
for host in taxottic.com hq.taxottic.com enterprise.taxottic.com; do
  echo "== $host =="
  curl -sI "https://$host/" | head -1
  curl -sI "https://$host/" | grep -iE "^(strict-transport|content-security|x-frame|access-control-allow-origin)"
  echo
done
```

Expected:
- `HTTP/2 200` (or 303/307 for the consumer apex when no session,
  redirecting to /login).
- `strict-transport-security` present.
- `content-security-policy` present.
- `x-frame-options: DENY`.
- `access-control-allow-origin` **absent** (we strip it in
  middleware after the May 2026 audit).

Then exercise the portal switcher from `taxottic.com/dashboard`
signed in as `contact@taxottic.com`:

1. Profile menu → **Switch portal** → **Enterprise**.
2. You should arrive on `enterprise.taxottic.com` showing the firms
   console.
3. From there, profile menu → **Switch portal** → **HQ**.
4. You should arrive on `hq.taxottic.com` showing the super-admin
   overview.
5. From there, profile menu → **Switch portal** → **Consumer app**.
6. You should arrive back on `taxottic.com/dashboard`.

If step 2 lands you on `enterprise.taxottic.com/login` instead, the
session cookie didn't carry — that's expected the first time
because session cookies are per-host. Sign in once on each
subdomain (the OAuth flow will detect the same Google / Microsoft
identity automatically) and from then on the switcher is one click.

---

## What to do if a step breaks

- **`enterprise.taxottic.com` returns 404** → either DNS hasn't
  propagated (wait, re-run `dig`), or Vercel hasn't been told about
  the domain yet (re-check step 2). Vercel returns 404 from
  `vercel-dns.com` for unregistered hosts.
- **TLS handshake fails** → Vercel hasn't issued the cert yet.
  Wait 90 seconds and retry; if it still fails, click "Refresh"
  next to the domain in Vercel's dashboard.
- **OAuth redirect rejected on enterprise host** → Supabase URL
  config (step 3) is the most likely culprit. The error code in
  the URL when you land back on `/login` tells you which redirect
  was rejected (`oauth_state_mismatch` = host mismatch).
- **Portal switcher dumps you on `/login` every time** → the
  destination subdomain doesn't have a session yet. Expected first
  time on each host; sign in once per subdomain.

---

## Decommissioning

If we ever roll back the three-portal split (e.g., consolidating
Enterprise back under HQ):

1. Remove the CNAME at the DNS provider.
2. Remove the domain from Vercel.
3. Remove the Supabase redirect URLs for that host.
4. Revert the middleware + `setActivePlatform` + `UserMenu` to the
   pre–May 2026 state (the commit that introduced this file makes
   that diff easy to find).
