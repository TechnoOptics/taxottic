-- Remember the last workspace the user chose (personal vs business).
--
-- Mode was previously derived from the URL alone (components/LeftRail.tsx) and
-- never stored, so every landing on /dashboard (where sign-in, the wordmark,
-- and opening the phone app all put you) reset the rail to Personal and
-- business owners had to re-pick Business constantly.
--
-- Stored on the profile rather than in localStorage or a cookie because the
-- same person uses the phone app and the web portal, and the preference should
-- follow them. Also lets /dashboard make the decision server-side, so there is
-- no client flash while the rail settles.
--
-- Additive + nullable. NULL means "never explicitly chosen" and the app treats
-- it as today's behavior (land on /dashboard, no redirect), so every existing
-- row is unaffected until the user taps the Personal/Business toggle. See
-- docs/superpowers/specs/2026-08-06-remember-workspace-mode-design.md.
--
-- CHECK-constrained text mirrors profiles.active_platform / preview_plan rather
-- than introducing an enum, keeping it cheap to extend later.
alter table public.profiles
  add column if not exists workspace_mode text
    check (workspace_mode in ('personal', 'business'));

comment on column public.profiles.workspace_mode is
  'Last workspace the user chose: personal (individual 1040 hub) or business '
  '(a company under /c/[publicId]). NULL = never chosen, which keeps the '
  'pre-existing behavior of landing on /dashboard. Only ''business'' causes a '
  'redirect, and only when the user still belongs to a company.';
