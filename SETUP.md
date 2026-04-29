# Taxottic - Setup status

## Done

- Supabase project provisioned: `taxottic` (ref `enisnjjbxqaliydepacc`, us-east-1).
- 3 migrations applied: tenancy schema, RLS policies, invitation RPCs.
- `super_admins` table seeded with `contact@taxottic.com` and `contact@technooptics.com`.
- `.env.local` populated with project URL + publishable anon key.

## What you still need to do

### 1. Service role key (required for any server-side privileged code)

1. Open https://supabase.com/dashboard/project/enisnjjbxqaliydepacc/settings/api
2. Reveal the **service_role** secret key.
3. Paste into `.env.local` as `SUPABASE_SERVICE_ROLE_KEY=...`.
4. Never commit it. Never expose it to the browser.

Phase 1 does not require it for sign-in or for the admin dashboard, but
several Phase 2+ jobs (back-fills, webhook handlers, batch imports) will.

### 2. Auth redirect URLs (required before any sign-in works)

Open https://supabase.com/dashboard/project/enisnjjbxqaliydepacc/auth/url-configuration

- **Site URL**: `http://localhost:3000` (and `https://taxottic.com` once deployed).
- **Redirect URLs (allowlist)**:
  - `http://localhost:3000/auth/callback`
  - `https://taxottic.com/auth/callback`

### 3. SSO providers

In https://supabase.com/dashboard/project/enisnjjbxqaliydepacc/auth/providers,
enable each.

**Important**: Taxottic runs the OAuth handshake on its own domain so
Google / Microsoft show "to continue to taxottic.com" on the consent
screen instead of the Supabase project URL. Each provider therefore needs
TWO redirect URIs (the Supabase one as fallback AND ours), and the same
client_id + secret get pasted into both Supabase and `.env.local`.

**Google**
1. Google Cloud Console -> APIs & Services -> Credentials -> Create OAuth client ID -> Web application.
2. Authorized redirect URIs (add ALL of these):
   - `https://enisnjjbxqaliydepacc.supabase.co/auth/v1/callback` (Supabase fallback)
   - `https://taxottic.com/api/auth/google/callback` (production, our domain)
   - `http://localhost:3000/api/auth/google/callback` (dev)
3. Copy Client ID + secret into:
   - Supabase Google provider (dashboard)
   - `.env.local` and Vercel env: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`

**Microsoft (Azure AD)**
1. portal.azure.com -> Microsoft Entra ID -> App registrations -> New.
2. Supported account types: "any organizational directory and personal Microsoft accounts".
3. Redirect URIs (Web platform, add ALL of these):
   - `https://enisnjjbxqaliydepacc.supabase.co/auth/v1/callback` (Supabase fallback)
   - `https://taxottic.com/api/auth/azure/callback` (production, our domain)
   - `http://localhost:3000/api/auth/azure/callback` (dev)
4. Certificates & secrets -> New client secret. Copy the value.
5. Copy Application (client) ID + secret into:
   - Supabase Azure provider (dashboard)
   - `.env.local` and Vercel env: `AZURE_OAUTH_CLIENT_ID`, `AZURE_OAUTH_CLIENT_SECRET`

**Apple** (requires Apple Developer membership)
1. developer.apple.com -> Identifiers -> create a Services ID. Enable "Sign in with Apple".
2. Configure the Supabase callback as the return URL.
3. Generate a "Sign In with Apple" key, download the `.p8`.
4. Paste Services ID, Team ID, Key ID, and the `.p8` contents into Supabase Apple provider.

### 4. Domain (taxottic.com on GoDaddy)

When ready to deploy:
- Push code to GitHub, import to Vercel.
- Add `taxottic.com` and `www.taxottic.com` to the Vercel project.
- In GoDaddy DNS, set A/CNAME records as Vercel instructs.
- Add `https://taxottic.com` to the Site URL and Redirect URLs in Supabase auth config.
- Set `NEXT_PUBLIC_SITE_URL=https://taxottic.com` in Vercel env.

### 5. Email for `contact@taxottic.com` (super-admin email forwarding)

In GoDaddy: set up email forwarding (free) or Google Workspace so
`contact@taxottic.com` actually receives the magic-link sign-in email.
Without inbound email, you cannot sign in as super admin via magic link.
Once at least one OAuth provider is configured, you can sign in via that
instead, but only if the provider account uses the exact same email.

## Run locally

```bash
cd "C:\Users\abelm\Documents\Techno Optics LLc\taxottic"
npm run dev
```

Visit http://localhost:3000.

## Phase 2 (next)

- Onboarding wizard (entity-type-specific tax profile)
- 2025 federal bracket + standard deduction tables
- Forecast engine
- Bella + IRS Pub RAG

## Stripe billing setup (Pro tier)

The app gates premium features behind a `pro` subscription. Free users get:
- 10 Bella questions / month
- 1 CSV bank import / month
- 1 company
- No team invites

Pro users get unlimited everything. Pricing: $9.99/mo or $99/yr.

To turn on billing in production, do this once:

1. Sign up at https://dashboard.stripe.com (free; no charge until customers buy).
2. **Test mode** dashboard, top-right toggle. Stay in test mode while developing.
3. **Products & Prices**: create one product called "Taxottic Pro" with two prices:
   - Recurring: $9.99 / month
   - Recurring: $99.00 / year
   Copy each price's `price_xxx` ID into `.env.local`:
   - `STRIPE_PRICE_PRO_MONTHLY=price_xxx`
   - `STRIPE_PRICE_PRO_YEARLY=price_xxx`
4. **API keys**: Developers -> API keys. Copy:
   - Secret key into `STRIPE_SECRET_KEY`
   - Publishable key into `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
5. **Webhook**: Developers -> Webhooks -> Add endpoint.
   - URL: `https://taxottic.com/api/stripe/webhook` (or your dev tunnel URL)
   - Events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `checkout.session.completed`
   - Reveal the signing secret, copy into `STRIPE_WEBHOOK_SECRET`
6. **Customer Portal**: Settings -> Billing -> Customer Portal -> activate. Configure cancel + update-payment + view-invoices. This is what `/api/stripe/portal` opens.

Local testing of webhooks: install the Stripe CLI and run
`stripe listen --forward-to localhost:3000/api/stripe/webhook` to forward live test events to your dev server.

## Bella (Anthropic) setup

Bella runs on Claude Sonnet via the Anthropic API. Pay-per-use (~1-2 cents per question), $0 if nobody asks.

1. Sign up at https://console.anthropic.com (gets you $5 in free credits to start).
2. API Keys -> Create Key -> copy the value.
3. Paste into `.env.local` as `ANTHROPIC_API_KEY=sk-ant-...`.
4. Restart `npm run dev`. Bella will start answering.

If the key is missing, Bella's API returns a 503 with a friendly message and the rest of the app keeps working.
