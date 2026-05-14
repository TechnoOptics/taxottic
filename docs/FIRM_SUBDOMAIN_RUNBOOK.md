# Firm subdomain runbook

Operational steps for `*.taxottic.com` wildcard subdomains powering the enterprise portal. Phase 2 of the firm build-out (commit history starts at `9a4578e`).

## Prerequisites

- Wildcard DNS on `taxottic.com`
- Vercel project with wildcard domain attached
- Supabase auth-redirect allowlist updated to accept the wildcard

Without these three pieces wired, a firm approved on `/admin/firms` gets a working `firms.slug` column but the URL `smithcpa.taxottic.com` returns `DNS_PROBE_FINISHED_NXDOMAIN`.

## DNS

Add a wildcard CNAME (or ALIAS / A record at apex if using Vercel nameservers) pointing at Vercel.

### If `taxottic.com` is on Vercel nameservers
1. Vercel project → Domains → Add → `*.taxottic.com`
2. Vercel auto-creates the wildcard record + the SSL certificate
3. Verify with `dig +short smithcpa.taxottic.com` (any slug works for the test)

### If `taxottic.com` is on a third-party DNS provider (Cloudflare / Route 53 / Namecheap)
1. Add a CNAME record:
   - Name: `*`
   - Value: `cname.vercel-dns.com`
   - TTL: 300 (5 min) so changes propagate fast
2. Vercel project → Domains → Add → `*.taxottic.com`
3. Vercel issues a wildcard SSL certificate. Status appears as "Valid Configuration" once propagation completes.
4. Verify with `dig +short test123.taxottic.com` — should return `cname.vercel-dns.com.`

**Cloudflare-specific:** turn off the orange-cloud proxy on the wildcard record. Vercel needs to terminate TLS itself to use the wildcard certificate.

## Vercel

Wildcard domain MUST be attached to the production environment of the same project that serves `taxottic.com`. Single deployment, single codebase — the middleware routes by host.

- Project → Settings → Domains → `*.taxottic.com` → Production
- Disable "automatic redirect to canonical domain" (it would force `*.taxottic.com` → `taxottic.com`, defeating the wildcard)

## Supabase auth-redirect allowlist

Without this, OAuth + magic-link sign-ins from firm subdomains will fail with `redirect_to is not allowed`.

- Supabase Dashboard → Authentication → URL Configuration → Redirect URLs → Add:
  - `https://*.taxottic.com/auth/callback`
  - `https://*.taxottic.com/invite/*`
  - `https://*.taxottic.com/firm`

Supabase supports wildcards in the redirect allowlist; one entry covers every approved firm.

## Reserved subdomains

The middleware (`lib/supabase/middleware.ts`, `RESERVED_SUBDOMAINS` set) refuses to treat the following as firm subdomains:

```
www, hq, enterprise, dev, staging, preview, assets, cdn, api, mail, email, auth
```

The slug derivation helper (`lib/firm/slug.ts`, `RESERVED_SLUGS` set) blocks these from being claimed during approval. If a firm requests one of these names, the operator-side `/admin/firms` slug input lets the super-admin pick a different slug at approval time.

## Approval flow (what `/admin/firms` does)

When the super-admin clicks "Approve & invite owner" on a row in `/admin/firms`:

1. **Slug minting.** If the operator typed a slug, it's validated against the format check + reserved list. Otherwise `pickAvailableSlug(firm_name)` derives one (e.g., "Smith & Allen CPA" → `smith-allen-cpa`), then probes the `firms` table for collisions and appends `-2`, `-3`, ... until free.
2. **Firm insert.** A row goes into `firms` with `status='active'`, `tier='starter'`, and the chosen `slug`.
3. **Owner invitation.** A token lands in `firm_invitations` for the contact email with `role='owner'`. A magic-link email goes out via Supabase OTP infrastructure to the enterprise callback URL.
4. **Activity log.** A `firm.member_invited` event with `actor_side='system'` records the provisioning in `firm_activity_log` for the firm's audit trail.
5. **Request marked approved.** The `firm_access_requests` row flips to `status='approved'` with the reviewer + timestamp recorded.

## End-to-end verification

After provisioning, sanity-check the new subdomain:

```bash
# DNS resolves
dig +short smithcpa.taxottic.com
# → cname.vercel-dns.com.

# TLS is live
curl -I https://smithcpa.taxottic.com/
# → HTTP/2 200 (or 307 to /firm or /login depending on auth)

# Owner can accept the invitation
# (open the magic-link email; should land on
#  https://smithcpa.taxottic.com/invite/{token} → /firm)
```

If the verification fails:
- **DNS doesn't resolve** — wildcard CNAME missing or still propagating (TTL).
- **SSL fails** — Vercel hasn't issued the cert yet; check Vercel project → Domains → status.
- **307 to consumer host** — middleware reserved-words list or slug format mismatch; check `lib/supabase/middleware.ts` for the slug pattern.
- **Magic link redirect rejected** — Supabase redirect allowlist missing the wildcard entry.

## Common operations

### Rename a firm subdomain

Two-step. Slugs are stable but not immutable.

1. Apply a manual DB migration:
   ```sql
   update public.firms set slug = 'newname' where id = '<firm_id>';
   ```
   The unique constraint blocks collisions automatically.
2. The old subdomain stops resolving (DNS still does, but the middleware can't find a firm with that slug → user is redirected to `/firms/request-account`). Tell the firm to use the new URL.

### Suspend a firm subdomain

Set `firms.status = 'suspended'`. The `requireFirmContext()` helper redirects suspended members to `/firm/suspended` (page TBD in Phase 4). Their data stays intact; reactivating with `status = 'active'` restores access.

### Decommission a firm

If a firm fully offboards:
1. `update firms set status = 'suspended', slug = null where id = '<id>';` — frees the slug for re-use.
2. After the 30-day retention window, hard-delete via `delete from firms where id = '<id>'`. Cascades clean up `firm_members`, `firm_engagements`, `firm_invitations`, `firm_client_outreach`, `firm_activity_log`.

## What's deliberately NOT here yet

- **Bring-your-own-domain** (`smithcpa-secure.com` → firm portal). Phase 2.5 follow-up; same Vercel domains API + a CNAME verification UI on the firm settings page.
- **Custom firm branding** (logo, accent color in the firm-portal chrome). Schema fields already exist (`firms.logo_url`, `firms.accent_color`); UI lands in Phase 4 alongside the activity-feed inbox.
- **Firm-specific OAuth client IDs** (Google / Microsoft sign-in branded with the firm's logo). Out of scope for Phase 2; firms use Supabase's shared OAuth clients.
