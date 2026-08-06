# Remember the last workspace mode (personal vs business)

Date: 2026-08-06
Status: implemented on `feat/remember-last-mode`

## The request

> "please have an agent make it that the app remembers which mode the user
> clicked last, business mode or personal and sticks to it so they do not have
> to keep changing."

## How mode works today

Mode is **not stored anywhere**. It is derived from the URL, once, in
`components/LeftRail.tsx`:

```
onBusiness = urlPublicId != null
          || pathname.startsWith("/c/")
          || pathname.startsWith("/mileage")
```

The Personal / Business segmented control at the top of the rail is two
`<Link>`s. Personal points at `/personal/forecast` (or `/personal/upgrade` when
the account is `personalLocked`), Business points at
`/c/{effectivePublicId}/forecast` (or `/companies/new` when the user has no
company). Clicking a segment is just a navigation; nothing is persisted, and on
the next render the mode is re-derived from wherever the user happens to be.

`LeftRail` is the only definition of mode in the codebase. It is rendered both
as the desktop rail and, through `LeftRailMobile`, as the mobile sheet, so there
is a single place to change.

### What resets it, and is the reset intentional

`/dashboard` resets it, every time. `/dashboard` matches neither `/c/` nor
`/mileage`, so `onBusiness` is false and the rail snaps back to Personal.

That matters because `/dashboard` is where users land constantly:

- `app/auth/callback/route.ts` falls back to `/dashboard` after sign-in
- `AppHeader`'s `homeHref` defaults to `/dashboard`, so the wordmark goes there
- it is the effective home screen when the phone app is opened

The reset is **not** intentional. `LeftRail`'s own comment says that for a user
with companies, `/dashboard` is the owner hub and is business content, which is
why the Dashboard link is hidden on the Personal side. So today the rail shows
"Personal" as selected while rendering a business hub. The complaint in the
request is this reset.

### Existing per-user preference patterns

Three precedents, all on `profiles`:

| Column | Written by | Notes |
| --- | --- | --- |
| `active_company_id` | `lib/tax/company-context.ts`, fire-and-forget on every `/c/*` render | "last company you looked at", read by the watch snapshot and `AppHeader` |
| `active_platform` | `setActivePlatform` server action in `app/settings/actions.ts` | CHECK-constrained text |
| `combine_personal_business` | Settings toggle | nullable = "not explicitly chosen", resolved to a smart default |

There is also a client-side precedent: `LeftRail` keeps
`taxottic.last_company_public_id` in `localStorage`.

`profiles.mileage_schedule` is a JSONB bag but it is mileage-specific
(`autoApplyBusiness`), not a general settings bag, so it is the wrong home for
this.

## Decisions

### 1. Storage: a nullable `profiles.workspace_mode` column

Rejected `localStorage` (does not follow the user from the phone app to the web
portal, and forces a hydration gate + visible flash before the rail can settle)
and a cookie (server-readable, but still per-device).

Chosen: a CHECK-constrained nullable text column on `profiles`, mirroring
`active_platform` exactly. It follows the user across devices, which is right
because the phone app and the web portal are the same person; it is readable on
the server, so the landing decision is a redirect with no client flash; and it
reuses the `combine_personal_business` convention where NULL means "never
chosen" rather than overloading a real value as a sentinel.

### 2. Default for a user who has never chosen: no change at all

NULL means **behave exactly as today** and land on `/dashboard`. No redirect.

The request is to remember what the user clicked. A user who has never clicked
has nothing to remember, and guessing a landing page for them is a behaviour
change they did not ask for. A business owner and a personal-only filer do want
different landing places, but the app already expresses that: `/dashboard`
renders `PersonalDashboard` for `tax_filer_type === "w2"`, the owner hub
otherwise, and `personalLocked` employees are already redirected to `/mileage`.
Every existing user therefore sees zero behaviour change until the first time
they tap a segment.

### 3. Only "business" ever redirects

The restore is asymmetric on purpose.

`/dashboard` already *is* the personal hub, so a user whose remembered mode is
personal is already in the right place when they land there. Storing "personal"
therefore does not need to move anyone; it only needs to stop the business
redirect from firing and let the toggle reflect reality.

So the stored value has exactly one active effect: `business` on `/dashboard`
redirects to the active company's forecast. This keeps the blast radius as small
as the feature allows and makes it structurally impossible for this change to
render a personal surface for someone who was not already being sent there,
which protects the personal/business separation.

### 4. Deep links win, and they update the remembered mode

Restoration is scoped to `/dashboard` alone, because that is the only
mode-ambiguous route. Every other route declares its own mode in the URL, so a
deep link into `/c/{id}/expenses` or `/personal/playbook` renders exactly what
was linked and is never redirected.

Following a deep link into the other mode also updates the remembered value, so
"sticks to it" stays honest: if a push notification drops the user into a
business surface and they keep working there, the next app open lands business.
This is done from `LeftRail`, which already computes the mode for every route,
and only fires when the derived mode disagrees with the stored one. Steady-state
cost is zero requests; crossing modes costs exactly one.

Two routes are deliberately excluded from that sync:

- `/dashboard`, because it is the ambiguous route. Syncing there would
  immediately overwrite a remembered "business" with "personal" and destroy the
  value on the very screen the feature exists to fix.
- Shared routes that belong to neither side (`/goals`, `/settings`, `/billing`).
  Only `onBusiness` routes and `/personal/*` are treated as mode-declaring.

### 5. A user with no business cannot be stranded

Three layers:

1. The redirect only fires when the stored mode is `business`.
2. The target company is resolved from **validated memberships**:
   `active_company_id` if the user is still a member of it, otherwise their first
   membership. With no memberships there is no target, so the function returns no
   redirect. Stranding is structurally impossible rather than guarded against.
3. Self-heal: when the stored mode is `business` and the user has no company
   (they left, were removed, or deleted it), the stored value is cleared back to
   NULL so the app stops trying on subsequent loads.

## Architecture

One pure module holds the decision, so it is testable without Next or Supabase.

`lib/workspace/mode.ts`
- `type WorkspaceMode = "personal" | "business"`
- `parseWorkspaceMode(raw: unknown): WorkspaceMode | null` tolerates a null,
  absent, or unrecognised column value
- `resolveDashboardLanding(input): { redirectTo: string | null; clearStoredMode: boolean }`
  is the whole restore decision, given the stored mode, the memberships, and
  `activeCompanyId`

Wiring:
- `supabase/migrations/…_profiles_workspace_mode.sql`: additive nullable column
- `app/actions/workspace-mode.ts`: `setWorkspaceMode` server action, validates
  the value, writes the column, no revalidation (nothing on the current page
  depends on it)
- `app/dashboard/page.tsx`: reads the column in the existing profile select (no
  extra round trip) and applies `resolveDashboardLanding`
- `components/AppHeader.tsx`: reads the column in its existing profile select
  and passes it to the rail
- `components/LeftRail.tsx`: receives `storedMode`, syncs on mode-declaring
  routes

## Testing

`lib/workspace/mode.test.ts` covers `resolveDashboardLanding`:

- stored mode NULL or unrecognised gives no redirect (today's behaviour)
- stored `personal` gives no redirect
- stored `business` with **no companies at all** gives no redirect and requests
  a clear, the no-business-at-all case
- stored `business` with a valid `active_company_id` redirects to that company
- stored `business` with an `active_company_id` the user is no longer a member
  of falls back to the first membership rather than trusting the stale id
- stored `business` with a NULL `active_company_id` uses the first membership

`components/LeftRailMode.ct.spec.tsx` renders the real rail in the Playwright
component harness (no backend) and covers:

- both segments clear 44px and stay inside a 344px viewport
- the personal workspace shows no Companies / Mileage / Chat / Team / Dashboard
- a personal-only user's Business segment points at `/companies/new`
- a business route records `business` when `personal` was stored
- a route that already matches the stored mode writes nothing
- `/dashboard` and `/goals` never overwrite a remembered `business`

The harness needed a stub for the `"use server"` action
(`playwright/next-stubs/workspace-mode-action.ts`, aliased in
`playwright-ct.config.ts`), the same treatment `next/navigation` and `next/link`
already get. Without it `LeftRail` cannot be mounted under Vite at all.

## Deploy ordering (important)

The migration must be applied **before** the code is deployed. Once the code
ships, `AppHeader` and `/dashboard` both request `workspace_mode` in their
existing profile `select`. PostgREST rejects a select naming an unknown column,
so on a database without the migration `profile` comes back null. `/dashboard`
degrades (it still renders, via the `profile &&` guards) but `AppHeader` would
read `needsConsent` as true and show the GDPR banner to everyone.

This is the same ordering every previous profile column required
(`preview_plan`, `combine_personal_business`); it is called out here only
because the column and the code land in one commit.

## Constraints honoured

- Migration is additive (`add column if not exists`, nullable). **Not applied to
  production.**
- `public/sw.js` `CACHE_VERSION` bumped to v152 (origin/main was at v151).
- The segmented toggle gets `min-h-[44px]`, matching the 44px control height the
  design system already fixes for `.btn` and `.input`, since it is the control
  this feature is about and it was ~30px.
