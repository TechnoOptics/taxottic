-- Preview-plan override for super-admins (QA plan switcher).
--
-- Super-admins resolve to the top 'practice' tier in getActivePlan()
-- (lib/plans/usage.ts), so they can't see how the FREE / Filer / Solo /
-- Studio / Scale experiences actually gate. This column lets a super-
-- admin pin their EFFECTIVE plan to any tier from the profile menu, so
-- they can walk each plan's gated experience and confirm the gating
-- matches the plan. When null, the super-admin keeps the default
-- 'practice' experience.
--
-- Safety: this is only ever consulted inside the super-admin branch of
-- getActivePlan(), so a non-super-admin setting it (they can't — the
-- setter is super-admin-guarded, and RLS lets a user only write their
-- own profile row) could never use it to bypass a paywall.
--
-- Stored as a CHECK-constrained text column (mirrors profiles.active_platform)
-- rather than the sub_plan enum, to keep it decoupled from billing state.
alter table public.profiles
  add column if not exists preview_plan text
    check (preview_plan in ('free', 'filer', 'solo', 'studio', 'scale', 'practice'));

comment on column public.profiles.preview_plan is
  'Super-admin QA override: pins the effective plan in getActivePlan() so an admin can preview each tier''s gated experience. Null = default (practice for super-admins). Ignored for non-super-admins.';
