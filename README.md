# Taxottic

Tax-forecasting SaaS for self-employed pros and small businesses. Sister
product to Advottic; lives at https://taxottic.com. Built on Next.js
App Router + Supabase + Stripe + Anthropic Claude.

The repo is cross-platform; everything below works the same on macOS,
Linux, and Windows. Line endings are normalized via `.gitattributes`
so a fresh clone never produces noisy diffs.

## Quickstart

### macOS

```sh
# 1. Clone
git clone https://github.com/TechnoOptics/taxottic.git
cd taxottic

# 2. Use the pinned Node version (.nvmrc reads as Node 22 LTS)
#    If you don't have nvm: `brew install nvm` once, then:
nvm install
nvm use

# 3. Install + run
npm install
cp .env.local.example .env.local   # fill in the keys per SETUP.md
npm run dev
```

Open http://localhost:3000.

### Windows (PowerShell)

```powershell
git clone https://github.com/TechnoOptics/taxottic.git
cd taxottic

# Match the pinned Node version. With nvm-windows installed:
nvm install 22
nvm use 22

npm install
copy .env.local.example .env.local
npm run dev
```

### Linux

```sh
git clone https://github.com/TechnoOptics/taxottic.git
cd taxottic
nvm install            # picks up .nvmrc
npm install
cp .env.local.example .env.local
npm run dev
```

## Required setup before sign-in works

`SETUP.md` is the source of truth, but the short version:

1. Paste your Supabase project URL + anon key + service role key into
   `.env.local`.
2. Add OAuth credentials (Google, Microsoft) and Stripe keys per the
   relevant sections of `SETUP.md`.
3. The Supabase migrations under `supabase/migrations/` have already
   been applied to the production project. For a fresh project, run
   them with the Supabase CLI in numerical order.

## Useful scripts

```sh
npm run dev         # local dev server
npm run build       # production build
npm run start       # serve the production build
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit, no JS emitted
```

## Deploying

`main` auto-deploys to https://taxottic.com via Vercel. The DNS for
`taxottic.com` lives on GoDaddy; A record points the apex at Vercel
and a `www` CNAME does the same for the subdomain.

## Tech stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4
- Supabase (Postgres + Auth + Storage + Realtime)
- Stripe (subscriptions)
- Anthropic Claude (Bella, the in-app tax guide)
- WebAuthn passkeys via `@simplewebauthn`
