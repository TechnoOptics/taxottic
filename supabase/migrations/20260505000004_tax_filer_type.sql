-- W-2 / personal-only product mode.
--
-- profiles.tax_filer_type = 'w2' for users who only want personal
-- (wage-earner) tax forecasting and don't have a Schedule C side. The
-- dashboard, onboarding flow, and feature gates branch off this flag.
--
-- 'business' is the legacy default — anyone with the company wizard
-- in their flow lands here. NULL means the onboarding fork hasn't been
-- shown yet (older accounts before this migration), and they're
-- treated as 'business' until they explicitly pick.

alter table public.profiles
  add column if not exists tax_filer_type text
    check (tax_filer_type in ('w2', 'business'));

create index if not exists profiles_tax_filer_type_idx
  on public.profiles (tax_filer_type);

comment on column public.profiles.tax_filer_type is
  'W-2 wage-earner mode (no company) vs business mode (Schedule C). NULL = pre-fork users; treated as business.';
